import assert from "node:assert/strict";
import test from "node:test";
import type { RackTile, SerbianLetter } from "./types";
import { drawTilesForRack, isSerbianVowel } from "./tiles";

function tile(id: string, letter: SerbianLetter): RackTile {
  return { id, letter, value: 1 };
}

test("an initial rack is rebalanced to contain at least two vowels", () => {
  const bag = [
    tile("b", "Б"), tile("v", "В"), tile("g", "Г"), tile("d", "Д"),
    tile("z", "З"), tile("k", "К"), tile("l", "Л"), tile("m", "М"),
    tile("a", "А"), tile("e", "Е"), tile("i", "И"),
  ];

  const result = drawTilesForRack(bag, 8, []);
  assert.equal(result.drawn.filter(isSerbianVowel).length, 2);
  assert.equal(result.drawn.length, 8);
  assert.equal(result.bag.length, 3);
});

test("an initial rack is rebalanced to contain no more than four vowels", () => {
  const bag = [
    tile("a", "А"), tile("e", "Е"), tile("i", "И"), tile("o", "О"),
    tile("u", "У"), tile("a2", "А"), tile("b", "Б"), tile("v", "В"),
    tile("g", "Г"), tile("d", "Д"), tile("z", "З"),
  ];

  const result = drawTilesForRack(bag, 8, []);
  assert.equal(result.drawn.filter(isSerbianVowel).length, 4);
  assert.equal(result.drawn.length, 8);
});

test("a refill accounts for vowels already remaining on the rack", () => {
  const rack = [tile("a", "А")];
  const bag = [tile("b", "Б"), tile("v", "В"), tile("g", "Г"), tile("e", "Е")];

  const result = drawTilesForRack(bag, 3, rack);
  assert.equal([...rack, ...result.drawn].filter(isSerbianVowel).length, 2);
});

test("a refill does not add a fifth vowel", () => {
  const rack = [tile("a", "А"), tile("e", "Е"), tile("i", "И"), tile("o", "О")];
  const bag = [tile("u", "У"), tile("b", "Б"), tile("v", "В")];

  const result = drawTilesForRack(bag, 1, rack);
  assert.equal(result.drawn[0].letter, "Б");
  assert.equal([...rack, ...result.drawn].filter(isSerbianVowel).length, 4);
});
