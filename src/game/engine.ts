import { BOARD_SIZE, getPremium, START_CELL } from "./config";
import type {
  Board,
  BoardPosition,
  BoardTile,
  FormedWord,
  MoveEvaluation,
} from "./types";

type Direction = "horizontal" | "vertical";

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((tile) => (tile ? { ...tile } : null)));
}

export function getPendingPositions(board: Board): BoardPosition[] {
  const positions: BoardPosition[] = [];

  board.forEach((row, rowIndex) => {
    row.forEach((tile, colIndex) => {
      if (tile && !tile.committed) {
        positions.push({ row: rowIndex, col: colIndex });
      }
    });
  });

  return positions;
}

export function hasCommittedTiles(board: Board): boolean {
  return board.some((row) => row.some((tile) => tile?.committed));
}

function isInside(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function hasCommittedNeighbour(board: Board, position: BoardPosition): boolean {
  return [
    [position.row - 1, position.col],
    [position.row + 1, position.col],
    [position.row, position.col - 1],
    [position.row, position.col + 1],
  ].some(
    ([row, col]) => isInside(row, col) && Boolean(board[row][col]?.committed),
  );
}

function inferDirection(board: Board, position: BoardPosition): Direction {
  const horizontal =
    (isInside(position.row, position.col - 1) &&
      Boolean(board[position.row][position.col - 1])) ||
    (isInside(position.row, position.col + 1) &&
      Boolean(board[position.row][position.col + 1]));

  return horizontal ? "horizontal" : "vertical";
}

function collectWord(
  board: Board,
  position: BoardPosition,
  direction: Direction,
): BoardPosition[] {
  const rowStep = direction === "vertical" ? 1 : 0;
  const colStep = direction === "horizontal" ? 1 : 0;
  let row = position.row;
  let col = position.col;

  while (
    isInside(row - rowStep, col - colStep) &&
    board[row - rowStep][col - colStep]
  ) {
    row -= rowStep;
    col -= colStep;
  }

  const positions: BoardPosition[] = [];
  while (isInside(row, col) && board[row][col]) {
    positions.push({ row, col });
    row += rowStep;
    col += colStep;
  }

  return positions;
}

function scoreWord(board: Board, positions: BoardPosition[]): FormedWord {
  let letterScore = 0;
  let wordMultiplier = 1;

  for (const { row, col } of positions) {
    const tile = board[row][col] as BoardTile;
    const premium = tile.committed ? null : getPremium(row, col);
    const letterMultiplier =
      premium === "letter2" ? 2 : premium === "letter3" ? 3 : 1;

    if (premium === "word2") wordMultiplier *= 2;
    if (premium === "word3") wordMultiplier *= 3;
    letterScore += tile.value * letterMultiplier;
  }

  return {
    word: positions
      .map(({ row, col }) => (board[row][col] as BoardTile).letter)
      .join(""),
    score: letterScore * wordMultiplier,
    positions,
  };
}

function validateLine(board: Board, pending: BoardPosition[]): string | null {
  const sameRow = pending.every(({ row }) => row === pending[0].row);
  const sameCol = pending.every(({ col }) => col === pending[0].col);

  if (!sameRow && !sameCol) {
    return "Сва нова слова морају бити у истом реду или колони.";
  }

  const direction: Direction = sameRow ? "horizontal" : "vertical";
  const coordinates = pending.map((position) =>
    direction === "horizontal" ? position.col : position.row,
  );
  const start = Math.min(...coordinates);
  const end = Math.max(...coordinates);

  for (let coordinate = start; coordinate <= end; coordinate += 1) {
    const row = direction === "horizontal" ? pending[0].row : coordinate;
    const col = direction === "horizontal" ? coordinate : pending[0].col;
    if (!board[row][col]) return "Између постављених слова не сме бити празнина.";
  }

  return null;
}

export function evaluateMove(board: Board): MoveEvaluation {
  const pending = getPendingPositions(board);
  const invalid = (error: string): MoveEvaluation => ({
    valid: false,
    error,
    score: 0,
    words: [],
  });

  if (pending.length === 0) return invalid("Изабери слова и постави их на таблу.");

  const lineError = validateLine(board, pending);
  if (lineError) return invalid(lineError);

  if (!hasCommittedTiles(board)) {
    const coversStart = pending.some(
      ({ row, col }) => row === START_CELL.row && col === START_CELL.col,
    );
    if (!coversStart) return invalid("Прва реч мора да пређе преко звезде.");
  } else if (!pending.some((position) => hasCommittedNeighbour(board, position))) {
    return invalid("Нова реч мора да се повеже са словима на табли.");
  }

  const mainDirection: Direction =
    pending.length === 1
      ? inferDirection(board, pending[0])
      : pending.every(({ row }) => row === pending[0].row)
        ? "horizontal"
        : "vertical";

  const candidates: BoardPosition[][] = [
    collectWord(board, pending[0], mainDirection),
    ...pending.map((position) =>
      collectWord(
        board,
        position,
        mainDirection === "horizontal" ? "vertical" : "horizontal",
      ),
    ),
  ];

  const uniqueWords = new Map<string, BoardPosition[]>();
  for (const positions of candidates) {
    if (positions.length < 2) continue;
    const key = positions.map(({ row, col }) => `${row}-${col}`).join("|");
    uniqueWords.set(key, positions);
  }

  if (uniqueWords.size === 0) {
    return invalid("Потез мора да направи реч од најмање два слова.");
  }

  const words = [...uniqueWords.values()].map((positions) =>
    scoreWord(board, positions),
  );

  return {
    valid: true,
    error: null,
    score: words.reduce((total, word) => total + word.score, 0),
    words,
  };
}

export function commitMove(board: Board): Board {
  return board.map((row) =>
    row.map((tile) => (tile ? { ...tile, committed: true } : null)),
  );
}
