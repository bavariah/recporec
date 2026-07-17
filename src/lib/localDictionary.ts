let dictionaryPromise: Promise<Set<string>> | null = null;

function normalizeWord(word: string) {
  return word.trim().toLocaleLowerCase("sr-Cyrl");
}

export async function loadLocalDictionary(): Promise<Set<string>> {
  if (!dictionaryPromise) {
    dictionaryPromise = fetch("/dictionary.txt", { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Dictionary returned ${response.status}`);
        return response.text();
      })
      .then(
        (text) =>
          new Set(
            text
              .split(/\r?\n/u)
              .map(normalizeWord)
              .filter(Boolean),
          ),
      )
      .catch((error) => {
        dictionaryPromise = null;
        throw error;
      });
  }

  return dictionaryPromise;
}

export async function checkLocalWords(words: string[]) {
  const dictionary = await loadLocalDictionary();
  return words.filter((word) => !dictionary.has(normalizeWord(word)));
}
