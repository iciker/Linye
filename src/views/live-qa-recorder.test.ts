import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import * as api from "../lib/api";
import { LiveQaQueue, finalizedCaptionText } from "../lib/live-qa";
import { makeCaption, newestFirstCaptions } from "../lib/live-captions";

// Execute the independent page's real handlers without opening a microphone.
const source = readFileSync(new URL("./LiveQa.svelte", import.meta.url), "utf8");
const handlers = source.slice(source.indexOf("  // ---- document scope"), source.indexOf("  // ---- end document scope"));
const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(handlers);
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function viewHarness(resizes: Array<() => void> = []) {
  const effects: Array<() => void> = [];
  const cleanup: Array<() => void> = [];
  const app = { activeSubject: { id: "course" }, subjects: [{ id: "course" }, { id: "second" }], activeSubjectId: "course", refresh: async () => {} };
  let starts = 0;
  let cancels = 0;
  const liveQa = {
    captions: [] as ReturnType<typeof makeCaption>[], listening: false, finishing: false,
    start: async () => { starts++; liveQa.captions = []; liveQa.listening = true; },
    cancel: () => { cancels++; liveQa.listening = false; liveQa.finishing = false; liveQa.captions = []; },
  };
  const view = new Function("api", "app", "liveQa", "$state", "$derived", "$effect", "untrack", "onMount", "onDestroy", "LiveQaQueue", "finalizedCaptionText", "newestFirstCaptions", "ResizeObserver", `${compiled}
    return { startListening, uploadQaDocuments, selectQaDocument, askLatestCaption,
      answerScroll: typeof preserveAnswerPosition === "function" ? preserveAnswerPosition : undefined,
      returnToLatest: typeof returnToLatest === "function" ? returnToLatest : undefined,
      get atLatest() { return typeof answersAtLatest === "undefined" ? true : answersAtLatest; },
      get replies() { return qaReplies; }, get selected() { return selectedDocIds; }, get error() { return liveQaError; } };`)(
    api, app, liveQa, (value: unknown) => value, (value: unknown) => value,
    (effect: () => void) => effects.push(effect), (callback: () => void) => callback(),
    () => {}, (callback: () => void) => cleanup.push(callback), LiveQaQueue, finalizedCaptionText, newestFirstCaptions,
    class { constructor(callback: () => void) { resizes.push(callback); } observe() {} disconnect() { resizes.length = 0; } },
  );
  return { view, app, liveQa, effects, cleanup, get starts() { return starts; }, get cancels() { return cancels; } };
}

async function withWindow(run: () => Promise<void>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  try { await run(); }
  finally {
    clearMocks();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("lecture recorder has no Q&A requests or document side effects", () => {
  const recorder = readFileSync(new URL("./Recorder.svelte", import.meta.url), "utf8");
  expect(recorder).not.toContain("chatAnswer");
  expect(recorder).not.toContain("listSources");
  expect(recorder).not.toContain("liveQa");
  expect(recorder).toContain("rec.confirmSave()");
  expect(recorder).toContain("rec.exportCaptions()");
  expect(recorder).toContain("drawWave(levels)");
});

test("independent Q&A uploads documents, refuses empty scope, and requests each confirmed original once", async () => {
  await withWindow(async () => {
    const calls: Array<Record<string, unknown>> = [];
    let release!: (value: api.ChatAnswer) => void;
    const firstAnswer = new Promise<api.ChatAnswer>((resolve) => { release = resolve; });
    const doc = { id: "template", subject_id: "course", name: "Template.docx", kind: "docx", status: "ready" };
    mockIPC((command, args) => {
      const payload = args as Record<string, unknown> | undefined;
      if (command === "list_sources") return [];
      if (command === "get_setting") return null;
      if (command === "set_setting") return;
      if (command === "plugin:dialog|open") return ["/test/Template.docx"];
      if (command === "add_source") {
        expect(payload?.input).toMatchObject({ subject_id: "course", path: "/test/Template.docx" });
        return { source: doc, chunk_count: 1, chars: 50, warning: null };
      }
      if (command === "chat_answer") {
        calls.push(payload ?? {});
        return calls.length === 1 ? firstAnswer : { text: `Answer ${calls.length}`, model: "chosen", citations: [] };
      }
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const harness = viewHarness();
    const { view, effects, liveQa, app } = harness;
    try {
      effects[0]();
      await settle();
      await view.startListening();
      expect(harness.starts).toBe(0);
      expect(view.error).toContain("select reference documents");
      expect(calls).toHaveLength(0);

      await view.uploadQaDocuments();
      expect(view.selected).toEqual(["template"]);
      await view.startListening();
      expect(harness.starts).toBe(1);
      liveQa.captions = [
        makeCaption(2, "Tell us about your background.", undefined, true),
        makeCaption(3, "Explain your project.", undefined, true),
        makeCaption(4, "Partial words"),
      ];
      effects[1]();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ subjectId: "course", sourceIds: ["template"], query: "Tell us about your background.", web: false, answerMode: "live" });
      expect(liveQa.captions[0].translationFinal).toBe(false);
      effects[1]();
      expect(view.replies).toHaveLength(2); // Translation / ASR updates cannot double-submit.

      liveQa.listening = false;
      await view.startListening(); // A new take keeps both the active and queued answers.
      expect(view.replies).toHaveLength(2);
      liveQa.captions = [makeCaption(5, "Question from a new take.", undefined, true)];
      effects[1]();
      expect(calls).toHaveLength(1); // Never overlap the old in-flight provider HTTP.
      release({ text: "Answer 1", model: "chosen", citations: [] });
      await settle();
      expect(calls).toHaveLength(3);
      expect(calls[1].query).toBe("Explain your project.");
      expect(calls[2].query).toBe("Question from a new take.");
      expect(view.replies.map((reply: { answer: api.ChatAnswer }) => reply.answer.text)).toEqual(["Answer 3", "Answer 2", "Answer 1"]);
      effects[0](); // Same-course refresh must not clear answers or stop the mic.
      expect(view.replies).toHaveLength(3);
      expect(liveQa.listening).toBe(true);
      liveQa.listening = false;
      liveQa.finishing = false;
      liveQa.captions.push(makeCaption(6, "Final tail published as stop finishes.", undefined, true));
      effects[1]();
      await settle();
      expect(calls).toHaveLength(4);
      expect(calls[3].query).toBe("Final tail published as stop finishes.");
      view.selectQaDocument("template", false);
      expect(view.selected).toEqual([]);
      expect(view.replies).toEqual([]);
      liveQa.captions.push(makeCaption(7, "A new question.", undefined, true));
      effects[1]();
      expect(calls).toHaveLength(4);

      app.activeSubject = { id: "second" };
      effects[0]();
      await settle();
      expect(liveQa.listening).toBe(false);
      expect(view.selected).toEqual([]);
      expect(view.replies).toEqual([]);
    } finally {
      for (const callback of harness.cleanup) callback();
      release({ text: "Released test transport", model: "chosen", citations: [] });
      await settle();
    }
  });
});

test("navigation cancels the microphone and a pending document picker cannot import after unmount", async () => {
  await withWindow(async () => {
    let releasePicker!: (paths: string[]) => void;
    const picked = new Promise<string[]>((resolve) => { releasePicker = resolve; });
    let imports = 0;
    mockIPC((command) => {
      if (command === "list_sources") return [];
      if (command === "get_setting") return null;
      if (command === "plugin:dialog|open") return picked;
      if (command === "add_source") { imports++; throw new Error("Must not import after unmount"); }
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const harness = viewHarness();
    harness.effects[0]();
    await settle();
    const upload = harness.view.uploadQaDocuments();
    await settle();
    harness.liveQa.listening = true;
    for (const callback of harness.cleanup) callback();
    expect(harness.liveQa.listening).toBe(false);
    releasePicker(["/test/Template.docx"]);
    await upload;
    expect(imports).toBe(0);
    harness.liveQa.captions = [makeCaption(1, "Late caption", undefined, true)];
    harness.liveQa.listening = true;
    harness.effects[1]();
    expect(harness.view.replies).toEqual([]);
  });
});

test("a failed microphone restart never resubmits retained final captions", async () => {
  await withWindow(async () => {
    const doc = { id: "template", subject_id: "course", name: "Template.docx", kind: "docx", status: "ready" };
    const calls: Array<Record<string, unknown>> = [];
    mockIPC((command, args) => {
      const payload = args as Record<string, unknown> | undefined;
      if (command === "list_sources") return [doc];
      if (command === "get_setting") return payload?.key === "live_qa_sources_course" ? '["template"]' : null;
      if (command === "chat_answer") {
        calls.push(payload ?? {});
        return { text: "Completed answer", model: "chosen", citations: [] };
      }
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const harness = viewHarness();
    try {
      harness.effects[0]();
      await settle();
      harness.liveQa.captions = [makeCaption(1, "A previously confirmed sentence.", undefined, true)];
      harness.effects[1]();
      await settle();
      expect(calls).toHaveLength(1);
      // A reserved microphone refusal keeps prior captions instead of starting a new session.
      harness.liveQa.start = async () => {};
      await harness.view.startListening();
      harness.effects[1]();
      await settle();
      expect(calls).toHaveLength(1);
      expect(harness.view.replies).toHaveLength(1);
      expect(harness.view.replies[0].answer.text).toBe("Completed answer");
    } finally { for (const callback of harness.cleanup) callback(); }
  });
});

test("all session answers survive stop and restart while reused caption IDs are submitted once", async () => {
  await withWindow(async () => {
    let calls = 0;
    const doc = { id: "template", subject_id: "course", name: "Template.docx", kind: "docx", status: "ready" };
    mockIPC((command, args) => {
      if (command === "list_sources") return [doc];
      if (command === "get_setting") return (args as { key: string }).key === "live_qa_sources_course" ? '["template"]' : null;
      if (command === "chat_answer") return { text: `Answer ${++calls}`, model: "chosen", citations: [] };
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const harness = viewHarness();
    try {
      harness.effects[0]();
      await settle();
      await harness.view.startListening();
      for (let id = 1; id <= 24; id++) {
        harness.liveQa.captions.push(makeCaption(id, `Question ${id}`, undefined, true));
        harness.effects[1]();
        await settle();
      }
      expect(harness.view.replies).toHaveLength(24);
      expect(harness.view.replies.at(-1).answer.text).toBe("Answer 1");
      harness.liveQa.listening = false;
      harness.effects[1]();
      expect(calls).toBe(24);
      harness.liveQa.start = async () => {
        harness.liveQa.captions = [];
        harness.effects[1]();
        await Promise.resolve();
        harness.liveQa.captions = [makeCaption(1, "Question from restarted listener", undefined, true)];
        harness.effects[1](); // The first final caption can arrive before start() resolves.
        harness.liveQa.listening = true;
      };
      await harness.view.startListening();
      harness.effects[1]();
      await settle();
      harness.effects[1]();
      expect(calls).toBe(25);
      expect(harness.view.replies).toHaveLength(25);
      expect(harness.view.replies[0].answer.text).toBe("Answer 25");
      expect(harness.view.replies.at(-1).answer.text).toBe("Answer 1");
    } finally { for (const callback of harness.cleanup) callback(); }
  });
});

test("answer scrolling preserves the visible reply when a new card or taller answer arrives", () => {
  const resizes: Array<() => void> = [];
  const harness = viewHarness(resizes);
  const listeners = new Map<string, () => void>();
  const heights = [200, 200, 200, 200];
  const content = {};
  const node = {
    scrollTop: 0, firstElementChild: content,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => cards,
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  const cards: Array<{ isConnected: boolean; getBoundingClientRect: () => { top: number; bottom: number } }> = [];
  for (let index = 0; index < heights.length; index++) {
    const card = {
      isConnected: true,
      getBoundingClientRect: () => {
        const at = cards.indexOf(card);
        const top = 100 + heights.slice(0, at).reduce((sum, height) => sum + height, 0) - node.scrollTop;
        return { top, bottom: top + heights[at] };
      },
    };
    cards.push(card);
  }
  const action = harness.view.answerScroll?.(node);
  const resize = () => { for (const callback of resizes) callback(); };
  const reading = cards[1];
  try {
    node.scrollTop = 250;
    listeners.get("scroll")?.();
    const offset = reading.getBoundingClientRect().top;
    const newCard = {
      isConnected: true,
      getBoundingClientRect: () => ({ top: 100 - node.scrollTop, bottom: 190 - node.scrollTop }),
    };
    cards.unshift(newCard);
    heights.unshift(90);
    resize();
    expect(reading.getBoundingClientRect().top).toBe(offset);
    expect(harness.view.atLatest).toBe(false);
    heights[1] += 150; // The async answer above the visible card becomes taller.
    resize();
    expect(reading.getBoundingClientRect().top).toBe(offset);
    harness.view.returnToLatest?.();
    expect(node.scrollTop).toBe(0);
    expect(harness.view.atLatest).toBe(true);
    heights[0] += 120;
    resize();
    expect(node.scrollTop).toBe(0);
  } finally {
    action?.destroy();
    for (const callback of harness.cleanup) callback();
  }
  expect(listeners.size).toBe(0);
  expect(resizes).toHaveLength(0);
});
