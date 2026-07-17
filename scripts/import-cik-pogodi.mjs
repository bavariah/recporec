import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeSerbianWord,
  sortSerbianWords,
  tileLength,
} from "./dictionary-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultCikRoot = path.resolve(root, "..", "cik-pogodi");
const cikRoot = path.resolve(process.argv[2] ?? defaultCikRoot);
const outputPath = path.join(
  root,
  "data",
  "dictionary",
  "imports",
  "cik-pogodi.txt",
);

const sources = [
  {
    length: 4,
    file: "supabase/migrations/202607100001_weekly_four_letter_challenge.sql",
  },
  {
    length: 5,
    file: "supabase/migrations/202607120002_import_five_letter_words.sql",
  },
  {
    length: 6,
    file: "supabase/migrations/202607070002_accepted_guess_words.sql",
  },
];

const words = new Set();
const counts = {};

for (const source of sources) {
  const sourcePath = path.join(cikRoot, source.file);
  const sql = await fs.readFile(sourcePath, "utf8");
  const matches = [...sql.matchAll(/^\s*\('([^']+)'/gmu)];
  const sourceWords = new Set(
    matches
      .map((match) => normalizeSerbianWord(match[1]))
      .filter((word) => word && tileLength(word) === source.length),
  );

  for (const word of sourceWords) words.add(word);
  counts[source.length] = sourceWords.size;
}

const sorted = sortSerbianWords(words);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  [
    "# Generated from reviewed cik-pogodi migrations. Re-run npm run dictionary:import-cik.",
    ...sorted,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Imported ${sorted.length} unique words from ${cikRoot}`);
for (const [length, count] of Object.entries(counts)) {
  console.log(`${length}-letter words: ${count}`);
}
