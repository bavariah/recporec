import { BOARD_SIZE, START_CELL } from "./config";
import { cloneBoard, evaluateMove, hasCommittedTiles } from "./engine";
import type { Board, RackTile } from "./types";

export interface BotMove {
  board: Board;
  score: number;
  tileIds: string[];
  usedTileIds: string[];
  words: Array<{ score: number; word: string }>;
}

function canBuildFromRack(word: string, rack: RackTile[], freeLetter: string | null = null) {
  const counts = new Map<string, number>();
  let blanks = 0;
  for (const tile of rack) {
    if (tile.letter) counts.set(tile.letter, (counts.get(tile.letter) ?? 0) + 1);
    else blanks += 1;
  }
  let freeUsed = false;
  for (const letter of Array.from(word.toLocaleUpperCase("sr-Cyrl"))) {
    if (!freeUsed && letter === freeLetter) {
      freeUsed = true;
      continue;
    }
    const count = counts.get(letter) ?? 0;
    if (count > 0) counts.set(letter, count - 1);
    else if (blanks > 0) blanks -= 1;
    else return false;
  }
  return true;
}

function tryWord(
  board: Board,
  rack: RackTile[],
  dictionary: Set<string>,
  word: string,
  row: number,
  col: number,
  vertical: boolean,
): BotMove | null {
  const letters = Array.from(word.toLocaleUpperCase("sr-Cyrl"));
  const endRow = row + (vertical ? letters.length - 1 : 0);
  const endCol = col + (vertical ? 0 : letters.length - 1);
  if (row < 0 || col < 0 || endRow >= BOARD_SIZE || endCol >= BOARD_SIZE) return null;

  const available = [...rack];
  const nextBoard = cloneBoard(board);
  const usedTileIds: string[] = [];

  for (let index = 0; index < letters.length; index += 1) {
    const targetRow = row + (vertical ? index : 0);
    const targetCol = col + (vertical ? 0 : index);
    const existing = nextBoard[targetRow][targetCol];
    if (existing) {
      if (existing.letter !== letters[index]) return null;
      continue;
    }

    let rackIndex = available.findIndex((tile) => tile.letter === letters[index]);
    if (rackIndex < 0) rackIndex = available.findIndex((tile) => tile.letter === null);
    if (rackIndex < 0) return null;
    const [tile] = available.splice(rackIndex, 1);
    usedTileIds.push(tile.id);
    nextBoard[targetRow][targetCol] = {
      id: tile.id,
      letter: letters[index] as NonNullable<RackTile["letter"]>,
      value: tile.value,
      isBlank: tile.letter === null,
      committed: false,
    };
  }

  if (usedTileIds.length === 0) return null;
  const evaluation = evaluateMove(nextBoard);
  if (!evaluation.valid) return null;
  if (evaluation.words.some(({ word: formed }) => !dictionary.has(formed.toLocaleLowerCase("sr-Cyrl")))) return null;
  return {
    board: nextBoard,
    score: evaluation.score,
    tileIds: usedTileIds,
    usedTileIds,
    words: evaluation.words.map(({ score, word: formed }) => ({ score, word: formed })),
  };
}

export function findBotMove(board: Board, rack: RackTile[], dictionary: Set<string>): BotMove | null {
  let best: BotMove | null = null;
  const words = [...dictionary];

  if (!hasCommittedTiles(board)) {
    for (const word of words) {
      const length = Array.from(word).length;
      if (length > rack.length || !canBuildFromRack(word, rack)) continue;
      for (let anchor = 0; anchor < length; anchor += 1) {
        for (const vertical of [false, true]) {
          const candidate = tryWord(
            board,
            rack,
            dictionary,
            word,
            START_CELL.row - (vertical ? anchor : 0),
            START_CELL.col - (vertical ? 0 : anchor),
            vertical,
          );
          if (candidate && (!best || candidate.score > best.score)) best = candidate;
        }
      }
    }
    return best;
  }

  for (let boardRow = 0; boardRow < BOARD_SIZE; boardRow += 1) {
    for (let boardCol = 0; boardCol < BOARD_SIZE; boardCol += 1) {
      const anchorTile = board[boardRow][boardCol];
      if (!anchorTile) continue;
      for (const word of words) {
        if (!canBuildFromRack(word, rack, anchorTile.letter)) continue;
        const letters = Array.from(word.toLocaleUpperCase("sr-Cyrl"));
        for (let anchor = 0; anchor < letters.length; anchor += 1) {
          if (letters[anchor] !== anchorTile.letter) continue;
          for (const vertical of [false, true]) {
            const candidate = tryWord(
              board,
              rack,
              dictionary,
              word,
              boardRow - (vertical ? anchor : 0),
              boardCol - (vertical ? 0 : anchor),
              vertical,
            );
            if (candidate && (!best || candidate.score > best.score)) best = candidate;
          }
        }
      }
    }
  }
  return best;
}
