import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard, evaluateMove } from "./engine";
import { findBotMove } from "./bot";
import { BOARD_SIZE, getPremium, START_CELL } from "./config";

test("the board is 9x9 with a bonus-free star at its true centre", () => {
  const board = createEmptyBoard();
  assert.equal(board.length, BOARD_SIZE);
  assert.ok(board.every((row) => row.length === BOARD_SIZE));
  assert.deepEqual(START_CELL, { row: 4, col: 4 });
  assert.equal(getPremium(START_CELL.row, START_CELL.col), null);
  assert.equal(getPremium(3, 3), null);
  assert.equal(getPremium(3, 5), null);
  assert.equal(getPremium(5, 3), null);
  assert.equal(getPremium(5, 5), null);

  board[4][4] = { id: "n", letter: "Н", value: 1, isBlank: false, committed: false };
  board[4][5] = { id: "e", letter: "Е", value: 1, isBlank: false, committed: false };

  const result = evaluateMove(board);
  assert.equal(result.valid, true);
  assert.equal(result.score, 3);
});

test("a disconnected later move is rejected", () => {
  const board = createEmptyBoard();
  board[4][4] = { id: "n", letter: "Н", value: 1, isBlank: false, committed: true };
  board[0][0] = { id: "e", letter: "Е", value: 1, isBlank: false, committed: false };
  board[0][1] = { id: "s", letter: "С", value: 1, isBlank: false, committed: false };

  assert.equal(evaluateMove(board).valid, false);
});

test("one new letter can extend an existing word", () => {
  const board = createEmptyBoard();
  board[4][3] = { id: "r", letter: "Р", value: 1, isBlank: false, committed: true };
  board[4][4] = { id: "a", letter: "А", value: 1, isBlank: false, committed: true };
  board[4][5] = { id: "d", letter: "Д", value: 1, isBlank: false, committed: true };
  board[4][6] = { id: "i", letter: "И", value: 1, isBlank: false, committed: false };

  const result = evaluateMove(board);
  assert.equal(result.valid, true);
  assert.equal(result.words.length, 1);
  assert.equal(result.words[0].word, "РАДИ");
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
  assert.equal(move.score, 3);
});
