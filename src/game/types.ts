export type PremiumType = "letter2" | "letter3" | "word2" | "word3";

export type SerbianLetter =
  | "А"
  | "Б"
  | "В"
  | "Г"
  | "Д"
  | "Ђ"
  | "Е"
  | "Ж"
  | "З"
  | "И"
  | "Ј"
  | "К"
  | "Л"
  | "Љ"
  | "М"
  | "Н"
  | "Њ"
  | "О"
  | "П"
  | "Р"
  | "С"
  | "Т"
  | "Ћ"
  | "У"
  | "Ф"
  | "Х"
  | "Ц"
  | "Ч"
  | "Џ"
  | "Ш";

export interface RackTile {
  id: string;
  letter: SerbianLetter | null;
  value: number;
}

export interface BoardTile {
  id: string;
  letter: SerbianLetter;
  value: number;
  isBlank: boolean;
  committed: boolean;
}

export type Board = Array<Array<BoardTile | null>>;

export interface BoardPosition {
  row: number;
  col: number;
}

export interface FormedWord {
  word: string;
  score: number;
  positions: BoardPosition[];
}

export interface MoveEvaluation {
  valid: boolean;
  error: string | null;
  score: number;
  words: FormedWord[];
}
