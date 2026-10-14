import type { PhoneticEntry } from "./api";
export type { PhoneticEntry } from "./api";

// ponytail: a curated list of 200 words, not a dictionary; expand only if needed.
export const MAX_PHONETIC_WORDS = 200;
const WORD = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;
export const phoneticWordKey = (word: string) => word.trim().replace(/’/g, "'").toLowerCase();

export function phoneticWords(text: string): string[] {
  const words = text.split(/[\s,，;；]+/).filter(Boolean);
  if (words.some((word) => word.length > 60 || !WORD.test(word))) {
    throw new Error("Enter English words separated by spaces, commas or newlines.");
  }
  return [...new Map(words.map((word) => [phoneticWordKey(word), word])).values()];
}

// Saved vocabulary may contain pending words; model output must include IPA.
export function validatePhoneticEntries(value: unknown, allowMissingIpa = false): PhoneticEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PHONETIC_WORDS) {
    throw new Error("The phonetic vocabulary must contain at most 200 words.");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry.word !== "string" || typeof entry.ipa !== "string") {
      throw new Error("Invalid phonetic vocabulary. Edit the words and IPA before saving.");
    }
    const word = entry.word.trim();
    const ipa = entry.ipa.trim();
    const key = phoneticWordKey(word);
    if (!WORD.test(word) || word.length > 60 || seen.has(key) || ipa.length > 160 ||
        ((!allowMissingIpa || ipa !== "") &&
          (!/^(?:\/[^/]+\/|\[[^\[\]]+\])$/u.test(ipa) || !ipa.slice(1, -1).trim() || /[\x00-\x1f\x7f<>]/u.test(ipa)))) {
      throw new Error("Each unique English word needs an IPA pronunciation in /slashes/ or [brackets].");
    }
    seen.add(key);
    return { word, ipa };
  });
}

export function readPhoneticEntries(saved: string | null): PhoneticEntry[] {
  return saved ? validatePhoneticEntries(JSON.parse(saved), true) : [];
}

// Single-word requests keep each pronunciation within its own output budget.
// Yielding lets the editor retain progress and stop before submitting the next word.
export async function* generatePhoneticsSerially(
  words: string[], request: (words: string[]) => Promise<unknown>,
): AsyncGenerator<PhoneticEntry, void> {
  if (!words.length || words.length > 30) throw new Error("Enter between 1 and 30 English words.");
  if (words.some((word) => word.trim().length > 60 || !WORD.test(word.trim())) ||
      new Set(words.map(phoneticWordKey)).size !== words.length) {
    throw new Error("Each unique English word needs an IPA pronunciation in /slashes/ or [brackets].");
  }
  for (const word of words) {
    try {
      const entries = validatePhoneticEntries(await request([word]));
      if (entries.length !== 1 || phoneticWordKey(entries[0].word) !== phoneticWordKey(word)) {
        throw new Error("The model did not return the requested pronunciations. Please retry or edit IPA manually.");
      }
      yield { word, ipa: entries[0].ipa };
    } catch (reason) { throw new Error(`${word}: ${String(reason)}`); }
  }
}

export function annotatePhoneticWords(text: string, entries: PhoneticEntry[]): { text: string; ipa?: string }[] {
  const words = new Map(entries.map((entry) => [phoneticWordKey(entry.word), entry.ipa]));
  const tokens: { text: string; ipa?: string }[] = [];
  let start = 0;
  // Include accented letters, digits and underscores so 'art' never matches
  // inside 'party', 'art2' or another word. Original punctuation/spacing stays intact.
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:['’-][\p{L}\p{M}\p{N}_]+)*/gu)) {
    const ipa = words.get(phoneticWordKey(match[0]));
    if (!ipa) continue;
    if (match.index! > start) tokens.push({ text: text.slice(start, match.index) });
    tokens.push({ text: match[0], ipa });
    start = match.index! + match[0].length;
  }
  if (start < text.length) tokens.push({ text: text.slice(start) });
  return tokens;
}
