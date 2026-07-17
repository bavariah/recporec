import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard, evaluateMove } from "./engine";
import { findBotMove } from "./bot";

test("the opening star applies exactly one double-word bonus", () => {
  const board = createEmptyBoard();
  board[3][3] = { id: "n", letter: "Н", value: 1, isBlank: false, committed: false };
  board[3][4] = { id: "e", letter: "Е", value: 1, isBlank: false, committed: false };

  const result = evaluateMove(board);
  assert.equal(result.valid, true);
  assert.equal(result.score, 4);
});

test("a disconnected later move is rejected", () => {
  const board = createEmptyBoard();
  board[3][3] = { id: "n", letter: "Н", value: 1, isBlank: false, committed: true };
  board[0][0] = { id: "e", letter: "Е", value: 1, isBlank: false, committed: false };
  board[0][1] = { id: "s", letter: "С", value: 1, isBlank: false, committed: false };

  assert.equal(evaluateMove(board).valid, false);
});

test("the solo bot builds a dictionary-approved opening from its rack", () => {
  const move = findBotMove(
    createEmptyBoard(),
    [
      { id: "n", letter: "Н", value: 1 },
      { id: "e", letter: "Е", value: 1 },
    ],
    new Set(["не"]),
  );

  assert.ok(move);
  assert.equal(move.words[0].word, "НЕ");
  assert.equal(move.score, 4);
});
