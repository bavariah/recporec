import type { PremiumType, SerbianLetter } from "./types";

export const BOARD_SIZE = 8;
export const RACK_SIZE = 7;

// An even board has four visual centre squares. We use the upper-left one as
// the start square so the opening rule remains deterministic.
export const START_CELL = { row: 3, col: 3 } as const;

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
      [0, 7],
      [7, 0],
      [7, 7],
    ],
  ],
  [
    "word2",
    [
      [1, 1],
      [1, 6],
      [3, 3],
      [3, 4],
      [4, 3],
      [4, 4],
      [6, 1],
      [6, 6],
    ],
  ],
  [
    "letter3",
    [
      [1, 4],
      [2, 2],
      [2, 5],
      [3, 0],
      [4, 7],
      [5, 2],
      [5, 5],
      [6, 3],
    ],
  ],
  [
    "letter2",
    [
      [0, 3],
      [0, 4],
      [1, 2],
      [1, 5],
      [2, 1],
      [2, 6],
      [3, 1],
      [3, 6],
      [4, 1],
      [4, 6],
      [5, 1],
      [5, 6],
      [6, 2],
      [6, 5],
      [7, 3],
      [7, 4],
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
