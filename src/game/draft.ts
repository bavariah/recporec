import { BOARD_SIZE, RACK_SIZE } from "./config";
import type { BoardPosition } from "./types";

export function sanitizeDraftPositions(value: unknown): BoardPosition[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const positions: BoardPosition[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = "row" in candidate ? candidate.row : null;
    const col = "col" in candidate ? candidate.col : null;
    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
    if ((row as number) < 0 || (row as number) >= BOARD_SIZE) continue;
    if ((col as number) < 0 || (col as number) >= BOARD_SIZE) continue;

    const key = `${row}-${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    positions.push({ row: row as number, col: col as number });
    if (positions.length === RACK_SIZE) break;
  }

  return positions;
}
