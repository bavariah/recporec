import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWordCandidates,
  normalizeSerbianWord,
  tileLength,
} from "./dictionary-lib.mjs";

test("normalizes Serbian Latin into one-character Cyrillic tiles", () => {
  assert.equal(normalizeSerbianWord("LJUBAV"), "љубав");
  assert.equal(normalizeSerbianWord("NJIVA"), "њива");
  assert.equal(normalizeSerbianWord("DŽEM"), "џем");
  assert.equal(tileLength(normalizeSerbianWord("DŽEM")), 3);
});

test("keeps Serbian Cyrillic and rejects unsupported alphabets", () => {
  assert.equal(normalizeSerbianWord("РЕЧ"), "реч");
  assert.equal(normalizeSerbianWord("quiz"), null);
});

test("extracts candidates from PDF-like text", () => {
  assert.deepEqual(extractWordCandidates("Реч, NJIVA; džem!"), [
    "реч",
    "њива",
    "џем",
  ]);
});
