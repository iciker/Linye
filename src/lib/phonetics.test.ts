import { expect, test } from "bun:test";
import { annotatePhoneticWords, generatePhoneticsSerially, phoneticWords, readPhoneticEntries, validatePhoneticEntries } from "./phonetics";
import { readFileSync } from "node:fs";

test("curated phonetic words match complete words while retaining original text", () => {
  const entries = [{ word: "art", ipa: "/ɑːt/" }, { word: "isn't", ipa: "/ˈɪznt/" }];
  const original = "ART, party art2 art_tag; isn't / Isn’t.\n<em>art</em> 中文 résumé.";
  const tokens = annotatePhoneticWords(original, entries);
  expect(tokens.map((token) => token.text).join("")).toBe(original);
  expect(tokens.filter((token) => token.ipa).map((token) => token.text)).toEqual(["ART", "isn't", "Isn’t", "art"]);
  expect(annotatePhoneticWords("nothing", entries)).toEqual([{ text: "nothing" }]);
  expect(annotatePhoneticWords("", entries)).toEqual([]);
});

test("word entry and stored vocabulary are bounded and validated without guessing IPA", () => {
  expect(phoneticWords("Art, art\nwork-force Isn’t")).toEqual(["art", "work-force", "Isn’t"]);
  expect(() => phoneticWords("hello <script>")).toThrow();
  expect(readPhoneticEntries(null)).toEqual([]);
  const entries = [{ word: "word", ipa: "/wɜːd/" }];
  expect(readPhoneticEntries(JSON.stringify(entries))).toEqual(entries);
  for (const bad of ["not json", "{}", '[{"word":"word","ipa":"/ /"}]', '[{"word":"word","ipa":"/<b>/"}]']) {
    expect(() => readPhoneticEntries(bad)).toThrow();
  }
  expect(() => validatePhoneticEntries([...entries, { word: "WORD", ipa: "/wɜːd/" }])).toThrow();
  expect(() => validatePhoneticEntries(Array.from({ length: 201 }, () => entries[0]))).toThrow();
});

test("saving and reopening incomplete vocabulary preserves words and completed IPA without annotating blanks", async () => {
  const draft = [{ word: "realised", ipa: "/ˈrɪəlaɪzd/" },
    { word: " prepare ", ipa: "  " }, { word: "efficiently", ipa: "" }];
  const saved = JSON.stringify(validatePhoneticEntries(draft, true));
  const reopened = readPhoneticEntries(saved);
  expect(reopened).toEqual([{ word: "realised", ipa: "/ˈrɪəlaɪzd/" },
    { word: "prepare", ipa: "" }, { word: "efficiently", ipa: "" }]);
  expect(annotatePhoneticWords("prepare realised efficiently", reopened).filter((token) => token.ipa))
    .toEqual([{ text: "realised", ipa: "/ˈrɪəlaɪzd/" }]);
  const requests: string[][] = [];
  for await (const entry of generatePhoneticsSerially(reopened.filter((entry) => !entry.ipa).map((entry) => entry.word), async (words) => {
    requests.push(words);
    return [{ word: words[0], ipa: "/ə/" }];
  })) reopened.find((row) => row.word === entry.word)!.ipa = entry.ipa;
  expect(requests).toEqual([["prepare"], ["efficiently"]]);
  expect(reopened[0].ipa).toBe("/ˈrɪəlaɪzd/");
  expect(readPhoneticEntries(JSON.stringify(validatePhoneticEntries([{ word: "word", ipa: "" }], true))))
    .toEqual([{ word: "word", ipa: "" }]);
  for (const invalid of [[{ word: "bad word", ipa: "" }], [{ word: "", ipa: "" }],
    [{ word: "word", ipa: "" }, { word: "WORD", ipa: "/wɜːd/" }], [{ word: "word", ipa: "bad IPA" }],
    [{ word: "word", ipa: "/ /" }], [{ word: "word", ipa: "/<b>/" }], [{ word: "word", ipa: "/a\nb/" }]]) {
    expect(() => validatePhoneticEntries(invalid, true)).toThrow();
  }
  expect(() => validatePhoneticEntries([{ word: "word", ipa: "" }])).toThrow();
  expect(() => validatePhoneticEntries(Array.from({ length: 201 }, () => ({ word: "word", ipa: "" })), true)).toThrow();
  expect(readFileSync("src/components/PhoneticVocabulary.svelte", "utf8")).toContain("validatePhoneticEntries(draft, true)");
});

test("bulk IPA uses single-word requests, retains progress on failure and retries only missing words", async () => {
  const draft = [{ word: "realised", ipa: "/ˈrɪəlaɪzd/" },
    { word: "economic", ipa: "" }, { word: "curriculum", ipa: "" }, { word: "prepare", ipa: "" }];
  const requests: string[][] = [];
  const request = async (words: string[]) => {
    requests.push(words);
    if (words.length > 1 || words[0] === "prepare") throw new Error("response hit the output-token limit");
    return [{ word: words[0], ipa: "/ə/" }];
  };
  const run = async (send: typeof request) => {
    for await (const entry of generatePhoneticsSerially(draft.filter((entry) => !entry.ipa).map((entry) => entry.word), send)) {
      draft.find((row) => row.word === entry.word)!.ipa = entry.ipa;
    }
  };
  await expect(run(request)).rejects.toThrow("prepare: Error: response hit the output-token limit");
  expect(requests).toEqual([["economic"], ["curriculum"], ["prepare"]]);
  expect(draft.map((entry) => entry.ipa)).toEqual(["/ˈrɪəlaɪzd/", "/ə/", "/ə/", ""]);
  await run(async (words) => { requests.push(words); return [{ word: words[0], ipa: "/prɪˈpeə/" }]; });
  expect(requests.slice(3)).toEqual([["prepare"]]);
  expect(draft[3].ipa).toBe("/prɪˈpeə/");
});

test("serial IPA waits for each request and stops requesting after the editor closes", async () => {
  let resolve!: (value: unknown) => void;
  const waiting = new Promise((yes) => { resolve = yes; });
  const requests: string[][] = [];
  const iterator = generatePhoneticsSerially(["first", "second"], async (words) => {
    requests.push(words);
    return waiting;
  });
  const first = iterator.next();
  expect(requests).toEqual([["first"]]);
  resolve([{ word: "FIRST", ipa: "/fɜːst/" }]);
  expect((await first).value).toEqual({ word: "first", ipa: "/fɜːst/" });
  await iterator.return(undefined);
  expect(requests).toEqual([["first"]]);

  let finish!: (value: unknown) => void;
  const late = new Promise((yes) => { finish = yes; });
  let generation = 1;
  let draft: { word: string; ipa: string }[] = [];
  const active = generation;
  const consume = async () => {
    for await (const entry of generatePhoneticsSerially(["old", "never"], async (words) => {
      requests.push(words);
      return late;
    })) {
      if (active !== generation) break;
      draft.push(entry);
    }
  };
  const pending = consume();
  expect(requests.at(-1)).toEqual(["old"]);
  generation++; // Close/reopen while the provider is still busy.
  draft = [{ word: "new", ipa: "/njuː/" }];
  finish([{ word: "old", ipa: "/əʊld/" }]);
  await pending;
  expect(draft).toEqual([{ word: "new", ipa: "/njuː/" }]);
  expect(requests).toEqual([["first"], ["old"]]);

  // The actual modal checks its lifetime before merging a late result or asking for the next word.
  const component = readFileSync("src/components/PhoneticVocabulary.svelte", "utf8");
  expect(component).toContain("for await (const entry of generatePhoneticsSerially(");
  expect(component).toContain("if (disposed || current !== generation || !dialog?.open) break;");
  expect(component.slice(component.indexOf("function openEditor"), component.indexOf("function closed"))).toContain("generation++;");
});

test("serial IPA rejects wrong, extra or invalid results before publishing them", async () => {
  for (const response of [[], [{ word: "other", ipa: "/ə/" }],
    [{ word: "word", ipa: "/ə/" }, { word: "other", ipa: "/ə/" }], [{ word: "word", ipa: "" }]]) {
    const published: unknown[] = [];
    const run = async () => {
      for await (const entry of generatePhoneticsSerially(["word"], async () => response)) published.push(entry);
    };
    await expect(run()).rejects.toThrow("word:");
    expect(published).toEqual([]);
  }
  for (const words of [[], ["word", "WORD"], ["two words"], ["<script>"], ["a".repeat(61)], Array(31).fill("word")]) {
    let requests = 0;
    const iterator = generatePhoneticsSerially(words, async () => { requests++; return []; });
    await expect(iterator.next()).rejects.toThrow();
    expect(requests).toBe(0);
  }
});
