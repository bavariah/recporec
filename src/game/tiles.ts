import type { RackTile, SerbianLetter } from "./types";

interface TileDefinition {
  letter: SerbianLetter | null;
  count: number;
  value: number;
}

export const SERBIAN_VOWELS = new Set<SerbianLetter>(["А", "Е", "И", "О", "У"]);

export function isSerbianVowel(tile: RackTile) {
  return tile.letter !== null && SERBIAN_VOWELS.has(tile.letter);
}

// Published Serbian distribution. Its listed counts total 104 tiles, including
// two blanks; keep this configurable until the final game balance is approved.
export const TILE_DEFINITIONS: TileDefinition[] = [
  { letter: null, count: 2, value: 0 },
  { letter: "А", count: 11, value: 1 },
  { letter: "И", count: 9, value: 1 },
  { letter: "Е", count: 8, value: 1 },
  { letter: "О", count: 8, value: 1 },
  { letter: "Н", count: 6, value: 1 },
  { letter: "Р", count: 6, value: 1 },
  { letter: "С", count: 5, value: 1 },
  { letter: "Т", count: 5, value: 1 },
  { letter: "У", count: 4, value: 1 },
  { letter: "Д", count: 3, value: 1 },
  { letter: "В", count: 4, value: 2 },
  { letter: "К", count: 4, value: 2 },
  { letter: "М", count: 4, value: 2 },
  { letter: "Л", count: 3, value: 2 },
  { letter: "П", count: 3, value: 2 },
  { letter: "З", count: 2, value: 3 },
  { letter: "Ј", count: 2, value: 3 },
  { letter: "Б", count: 2, value: 4 },
  { letter: "Г", count: 2, value: 4 },
  { letter: "Њ", count: 1, value: 5 },
  { letter: "Ц", count: 1, value: 5 },
  { letter: "Ч", count: 1, value: 5 },
  { letter: "Ш", count: 1, value: 5 },
  { letter: "Ћ", count: 1, value: 7 },
  { letter: "Х", count: 1, value: 7 },
  { letter: "Ж", count: 1, value: 8 },
  { letter: "Љ", count: 1, value: 8 },
  { letter: "Ђ", count: 1, value: 10 },
  { letter: "Ф", count: 1, value: 10 },
  { letter: "Џ", count: 1, value: 10 },
];

export function createTileBag(): RackTile[] {
  return TILE_DEFINITIONS.flatMap(({ letter, count, value }) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${letter ?? "blank"}-${index + 1}`,
      letter,
      value,
    })),
  );
}

export function shuffleTiles(
  tiles: RackTile[],
  random: () => number = Math.random,
): RackTile[] {
  const shuffled = [...tiles];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }

  return shuffled;
}

export function drawTiles(
  bag: RackTile[],
  amount: number,
): { drawn: RackTile[]; bag: RackTile[] } {
  const count = Math.min(amount, bag.length);
  return {
    drawn: bag.slice(0, count),
    bag: bag.slice(count),
  };
}

export function drawTilesForRack(
  bag: RackTile[],
  amount: number,
  rack: RackTile[],
): { drawn: RackTile[]; bag: RackTile[] } {
  const count = Math.min(Math.max(0, amount), bag.length);
  const drawn = bag.slice(0, count);
  const existingVowels = rack.filter(isSerbianVowel).length;
  const minimumDrawVowels = Math.min(count, Math.max(0, 2 - existingVowels));
  const maximumDrawVowels = Math.max(0, 4 - existingVowels);
  let drawnVowels = drawn.filter(isSerbianVowel).length;

  if (drawnVowels < minimumDrawVowels) {
    const replacements = bag.slice(count).filter(isSerbianVowel);
    while (drawnVowels < minimumDrawVowels && replacements.length > 0) {
      const replaceIndex = drawn.findLastIndex((tile) => !isSerbianVowel(tile));
      if (replaceIndex < 0) break;
      drawn[replaceIndex] = replacements.shift()!;
      drawnVowels += 1;
    }
  } else if (drawnVowels > maximumDrawVowels) {
    const replacements = bag.slice(count).filter((tile) => !isSerbianVowel(tile));
    while (drawnVowels > maximumDrawVowels && replacements.length > 0) {
      const replaceIndex = drawn.findLastIndex(isSerbianVowel);
      if (replaceIndex < 0) break;
      drawn[replaceIndex] = replacements.shift()!;
      drawnVowels -= 1;
    }
  }

  const drawnIds = new Set(drawn.map((tile) => tile.id));
  return {
    drawn,
    bag: bag.filter((tile) => !drawnIds.has(tile.id)),
  };
}
