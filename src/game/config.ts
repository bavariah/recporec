import type { PremiumType, SerbianLetter } from "./types";

export const BOARD_SIZE = 9;
export const RACK_SIZE = 8;

// A 9x9 board has one true centre square. It marks where the opening word must
// pass, but deliberately carries no score multiplier.
export const START_CELL = { row: 4, col: 4 } as const;

export const PREMIUM_LABELS: Record<PremiumType, string> = {
  letter2: "2×\nслово",
  letter3: "3×\nслово",
  word2: "2×\nреч",
  word3: "3×\nреч",
};

const PREMIUM_ENTRIES: Array<[PremiumType, Array<[number, number]>]> = [
  [
    "word3",
    [
      [0, 0],
      [0, 8],
      [8, 0],
      [8, 8],
    ],
  ],
  [
    "word2",
    [
      [1, 1],
      [1, 7],
      [7, 1],
      [7, 7],
    ],
  ],
  [
    "letter3",
    [
      [1, 4],
      [2, 2],
      [2, 6],
      [4, 1],
      [4, 7],
      [6, 2],
      [6, 6],
      [7, 4],
    ],
  ],
  [
    "letter2",
    [
      [0, 3],
      [0, 5],
      [1, 2],
      [1, 6],
      [2, 1],
      [2, 7],
      [3, 0],
      [3, 4],
      [3, 8],
      [4, 3],
      [4, 5],
      [5, 0],
      [5, 4],
      [5, 8],
      [6, 1],
      [6, 7],
      [7, 2],
      [7, 6],
      [8, 3],
      [8, 5],
    ],
  ],
];

export const PREMIUM_SQUARES = new Map<string, PremiumType>(
  PREMIUM_ENTRIES.flatMap(([premium, positions]) =>
    positions.map(([row, col]) => [`${row}-${col}`, premium] as const),
  ),
);

export function getPremium(row: number, col: number) {
  return PREMIUM_SQUARES.get(`${row}-${col}`) ?? null;
}

export const SERBIAN_ALPHABET: SerbianLetter[] = [
  "А",
  "Б",
  "В",
  "Г",
  "Д",
  "Ђ",
  "Е",
  "Ж",
  "З",
  "И",
  "Ј",
  "К",
  "Л",
  "Љ",
  "М",
  "Н",
  "Њ",
  "О",
  "П",
  "Р",
  "С",
  "Т",
  "Ћ",
  "У",
  "Ф",
  "Х",
  "Ц",
  "Ч",
  "Џ",
  "Ш",
];
