import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import * as api from "./api";
import { formatBilingualTranscript, LiveCaptions } from "./live-captions";
import { VoxtralCaptions } from "./vibevoice";

// Execute the actual save/retry methods without mounting an audio device or webview.
const source = readFileSync(new URL("./recorder.svelte.ts", import.meta.url), "utf8");
const methods = source.slice(source.indexOf("  async confirmSave()"), source.indexOf("  // ════════════════════ live bilingual captions"));
const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(`class Review { ${methods} }`);
const recorderCode = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.slice(source.indexOf("const SEG_MS"), source.indexOf("export const rec"))
    .replace("export function encodeWav", "function encodeWav"),
);

test("a late WAV watchdog cannot restart a stopped MediaRecorder while captions drain", async () => {
  let finishCaptions!: () => void;
  const pending = new Promise<void>((resolve) => { finishCaptions = resolve; });
  const rec = new Function("$state", "app", `${recorderCode}; return new RecorderStore();`)(
    (value: unknown) => value, { activeSubject: { id: "subject", topics: [] } },
  );
  let processors = 0;
  const node = () => ({ connect() { return this; }, disconnect() {} });
  rec.audioCtx = {
    sampleRate: 16000, destination: node(), close: async () => {},
    createScriptProcessor() { processors++; return { ...node(), onaudioprocess: null }; },
    createGain: () => ({ ...node(), gain: { value: 1 } }),
  };
  rec.srcNode = node();
  rec.recording = true;
  rec.captionSession = { finish: () => pending, cancel() {} };
  const finishing = rec.finalizeWeb();
  try {
    await Promise.resolve();
    // The 3.5s watchdog reaches this method after MediaRecorder.stop/onstop.
    rec.switchToWavCapture();
    expect(rec.captureMode).toBe("media");
    expect(processors).toBe(0);
    finishCaptions();
    await finishing;
    expect(rec.status).toBe("ready");
    expect(rec.reviewBytes.length).toBe(0);
    expect(rec.errorMsg).toContain("Nothing was captured");
  } finally {
    finishCaptions();
    await finishing;
  }
});

test("WAV stop freezes audio and elapsed time while captions drain, retaining the caption tail", async () => {
  let finishTranscription!: (text: string) => void;
  const transcription = new Promise<string>((resolve) => { finishTranscription = resolve; });
  const intervals = new Map<number, () => void>();
  let nextTimer = 0;
  let onPcm!: (pcm: Int16Array) => void;
  let transcribed: number[] = [];
  let stopped = 0;
  const node = () => ({ connect() { return this; }, disconnect() {} });
  const processor = { ...node(), onaudioprocess: null as ((event: unknown) => void) | null };
  const context = {
    sampleRate: 16000, destination: node(),
    createScriptProcessor: () => processor,
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    close: async () => {},
  };
  const app = { activeSubject: { id: "subject", topics: [] } };
  const rec = new Function("$state", "api", "app", "isMobile", "LiveCaptions", "VoxtralCaptions",
    "formatBilingualTranscript", "startCaptionAudioCapture", "setInterval", "clearInterval", `${recorderCode}; return new RecorderStore();`)(
    (value: unknown) => value,
    {
      transcribePartial(audio: number[]) { transcribed = audio; return transcription; },
      translateCaption: async () => "尾部字幕",
    }, app, false, LiveCaptions, VoxtralCaptions, formatBilingualTranscript,
    async (_context: unknown, _source: unknown, callback: typeof onPcm) => {
      onPcm = callback;
      return { async flush() { callback(new Int16Array([3000])); }, close() {} };
    },
    (callback: () => void) => { const id = ++nextTimer; intervals.set(id, callback); return id; },
    (id: number) => intervals.delete(id),
  );
  const audio = (samples: number[]) => processor.onaudioprocess?.({
    inputBuffer: { getChannelData: () => new Float32Array(samples) },
  });
  try {
    rec.audioCtx = context;
    rec.srcNode = node();
    rec.stream = { getTracks: () => [{ stop() { stopped++; } }] };
    rec.beginSession();
    rec.switchToWavCapture();
    await rec.startCaptions();
    rec.secs = 7;
    audio([0.25, -0.25]);
    onPcm(new Int16Array([4000]));

    const finishing = rec.finalizeWeb();
    // Simulate another callback and clock tick while the external ASR is slow.
    audio([0.75]);
    for (const tick of intervals.values()) tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(rec.wavChunks.map((chunk: Int16Array) => Array.from(chunk))).toEqual([[8192, -8192]]);
    expect(rec.secs).toBe(7);
    expect(rec.finishing).toBe(true);

    finishTranscription("Tail words");
    await finishing;
    expect(rec.status).toBe("review");
    expect(rec.reviewDuration).toBe("00:07");
    expect(Array.from(rec.reviewBytes.slice(44))).toEqual([0, 32, 0, 224]);
    expect(Array.from(new Int16Array(Uint8Array.from(transcribed).slice(44).buffer))).toEqual([4000, 3000]);
    expect(rec.reviewTranscript).toContain("Tail words");
    expect(rec.reviewTranscript).toContain("尾部字幕");
    expect(rec.recording).toBe(false);
    expect(rec.finishing).toBe(false);
    expect(stopped).toBe(1);
    expect(intervals.size).toBe(0);
  } finally {
    finishTranscription("Tail words");
    rec.discardRecording();
  }
});

test("failed transcript commit keeps the review; retry uses the saved audio only once", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const calls: string[] = [];
  const commits: unknown[] = [];
  let rejectCommit = true;
  let successes = 0;
  mockIPC((command, args) => {
    calls.push(command);
    if (command === "save_recording_raw") return { source: { id: "saved-audio" } };
    if (command === "commit_live_transcript") {
      commits.push(args);
      if (rejectCommit) throw new Error("disk full");
      return;
    }
    throw new Error(`Unexpected IPC: ${command}`);
  });
  try {
    const app = { refresh: async () => {}, pushToast: () => { successes++; }, openSubject: () => {}, setTab: () => {} };
    const review = new Function("api", "app", `${compiled}; return new Review();`)(api, app);
    Object.assign(review, {
      reviewSubjectId: "subject", reviewName: "Lecture", reviewTopicId: "", reviewDuration: "1:00",
      reviewSourceLabel: "microphone", reviewPath: "", reviewSavedSourceId: "", reviewExt: "wav",
      reviewBytes: new Uint8Array([1, 2]), reviewTranscript: "Original words\n中文翻译",
      reviewUsesLiveTranscript: true, status: "review", stopCaptions() {},
    });
    await review.confirmSave();
    expect(review.status).toBe("review");
    expect(review.reviewTranscript).toBe("Original words\n中文翻译");
    expect(review.reviewSavedSourceId).toBe("saved-audio");
    expect(review.errorMsg).toContain("disk full");
    expect(successes).toBe(0);
    rejectCommit = false;
    await Promise.all([review.confirmSave(), review.confirmSave()]);
    expect(calls).toEqual(["save_recording_raw", "commit_live_transcript", "commit_live_transcript"]);
    expect(commits[0]).toEqual(commits[1]);
    expect(review.status).toBe("ready");
    expect(review.reviewTranscript).toBe("");
    expect(review.reviewSavedSourceId).toBe("");
    expect(successes).toBe(1);
  } finally {
    clearMocks();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
