import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDraftPositions } from "./draft";

test("rival draft positions expose coordinates only and reject invalid cells", () => {
  assert.deepEqual(
    sanitizeDraftPositions([
      { row: 4, col: 4, letter: "А" },
      { row: 4, col: 4 },
      { row: -1, col: 0 },
      { row: 8, col: 8 },
      { row: 9, col: 0 },
      "4-5",
    ]),
    [
      { row: 4, col: 4 },
      { row: 8, col: 8 },
    ],
  );
});
