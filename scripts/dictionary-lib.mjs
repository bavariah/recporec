const LATIN_DIGRAPHS = new Map([
  ["dž", "џ"],
  ["lj", "љ"],
  ["nj", "њ"],
]);

const LATIN_TO_CYRILLIC = new Map([
  ["a", "а"],
  ["b", "б"],
  ["c", "ц"],
  ["č", "ч"],
  ["ć", "ћ"],
  ["d", "д"],
  ["đ", "ђ"],
  ["e", "е"],
  ["f", "ф"],
  ["g", "г"],
  ["h", "х"],
  ["i", "и"],
  ["j", "ј"],
  ["k", "к"],
  ["l", "л"],
  ["m", "м"],
  ["n", "н"],
  ["o", "о"],
  ["p", "п"],
  ["r", "р"],
  ["s", "с"],
  ["š", "ш"],
  ["t", "т"],
  ["u", "у"],
  ["v", "в"],
  ["z", "з"],
  ["ž", "ж"],
]);

const SERBIAN_CYRILLIC = /^[абвгдђежзијклљмнњопрстћуфхцчџш]+$/u;

export function normalizeSerbianWord(input) {
  let value = String(input ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("sr")
    .replace(/[’'`´-]/gu, "")
    .trim();

  for (const [latin, cyrillic] of LATIN_DIGRAPHS) {
    value = value.replaceAll(latin, cyrillic);
  }

  value = [...value]
    .map((character) => LATIN_TO_CYRILLIC.get(character) ?? character)
    .join("");

  return SERBIAN_CYRILLIC.test(value) ? value : null;
}

export function extractWordCandidates(text) {
  return String(text ?? "")
    .normalize("NFC")
    .match(/[\p{L}’'`´-]+/gu)
    ?.map(normalizeSerbianWord)
    .filter(Boolean) ?? [];
}

export function tileLength(word) {
  return [...word].length;
}

export function sortSerbianWords(words) {
  return [...words].sort((left, right) =>
    left.localeCompare(right, "sr-Cyrl", { sensitivity: "base" }),
  );
}
