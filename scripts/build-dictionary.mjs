import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractWordCandidates,
  normalizeSerbianWord,
  sortSerbianWords,
  tileLength,
} from "./dictionary-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  pdf: path.join(root, "data", "dictionary", "extracted", "pdf-headwords.tsv"),
  cik: path.join(root, "data", "dictionary", "imports", "cik-pogodi.txt"),
  additional: path.join(root, "data", "dictionary", "manual", "additional-accepted.txt"),
  output: path.join(root, "output", "dictionary"),
  publicDictionary: path.join(root, "public", "dictionary.txt"),
};

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function addWord(target, rawWord, source) {
  const word = normalizeSerbianWord(rawWord);
  if (!word) return;
  const length = tileLength(word);
  if (length < 2 || length > 8) return;

  const current = target.get(word) ?? new Set();
  current.add(source);
  target.set(word, current);
}

function extractListWords(text) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .flatMap((line) => extractWordCandidates(line));
}

function extractPdfHeadwords(text) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("word\t"))
    .flatMap((line) => extractWordCandidates(line.split("\t", 1)[0]));
}

const pdfWords = extractPdfHeadwords(await readOptional(paths.pdf));
const cikWords = extractListWords(await readOptional(paths.cik));
const additionalWords = extractListWords(await readOptional(paths.additional));

const accepted = new Map();
const twoLetterReview = new Map();

for (const word of pdfWords) addWord(accepted, word, "pdf");

for (const word of cikWords) addWord(accepted, word, "cik-pogodi");
for (const word of additionalWords) addWord(accepted, word, "manual-addition");

await fs.mkdir(paths.output, { recursive: true });

const csvHeader = "word,tile_length,status,sources\n";
const acceptedRows = sortSerbianWords(accepted.keys()).map(
  (word) =>
    `${word},${tileLength(word)},accepted,"${[...accepted.get(word)].sort().join("|")}"`,
);
const reviewRows = sortSerbianWords(twoLetterReview.keys()).map(
  (word) => `${word},2,review,"pdf-review"`,
);

await fs.writeFile(
  path.join(paths.output, "accepted-words.csv"),
  csvHeader + acceptedRows.join("\n") + (acceptedRows.length ? "\n" : ""),
  "utf8",
);
await fs.writeFile(
  path.join(paths.output, "two-letter-review.csv"),
  csvHeader + reviewRows.join("\n") + (reviewRows.length ? "\n" : ""),
  "utf8",
);
await fs.writeFile(
  paths.publicDictionary,
  sortSerbianWords(accepted.keys()).join("\n") + (accepted.size ? "\n" : ""),
  "utf8",
);

const byLength = Object.fromEntries(
  Array.from({ length: 7 }, (_, index) => index + 2).map((length) => [
    length,
    [...accepted.keys()].filter((word) => tileLength(word) === length).length,
  ]),
);
const stats = {
  accepted: accepted.size,
  pendingTwoLetterReview: twoLetterReview.size,
  byLength,
  generatedAt: new Date().toISOString(),
};

await fs.writeFile(
  path.join(paths.output, "dictionary-stats.json"),
  `${JSON.stringify(stats, null, 2)}\n`,
  "utf8",
);

console.log(`Accepted words: ${stats.accepted}`);
console.log(`Two-letter words awaiting review: ${stats.pendingTwoLetterReview}`);
