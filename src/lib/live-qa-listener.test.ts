import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeCaption } from "./live-captions";
import { pcmFromWav } from "./vibevoice";

// Execute the actual store classes without a Svelte mount or a physical microphone.
const listenerSource = readFileSync(new URL("./live-qa-listener.svelte.ts", import.meta.url), "utf8");
const recorderSource = readFileSync(new URL("./recorder.svelte.ts", import.meta.url), "utf8");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const recorderCode = transpiler.transformSync(recorderSource.slice(recorderSource.indexOf("const SEG_MS"),
  recorderSource.indexOf("export const rec")).replace("export function encodeWav", "function encodeWav"));
const listenerCode = transpiler.transformSync(listenerSource.slice(listenerSource.indexOf("/** A microphone"),
  listenerSource.indexOf("export const liveQa")));

function harness(options: {
  settings?: Record<string, string>;
  microphone?: () => Promise<unknown>;
  ios?: boolean;
} = {}) {
  const calls: string[] = [];
  const api = { async getAllSettings() { calls.push("settings"); return options.settings || { live_asr_provider: "voxtral" }; } };
  const { rec, encodeWav } = new Function("$state", "api", "app", `${recorderCode}; return {rec: new RecorderStore(), encodeWav};`)
    ((value: unknown) => value, api, {});
  let stopped = 0, contextClosed = 0, captureClosed = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const media = { async getUserMedia() { calls.push("microphone"); return options.microphone ? options.microphone() : stream; } };
  class Context {
    async resume() { calls.push("resume"); }
    async close() { contextClosed++; }
    createMediaStreamSource() { return {}; }
  }
  let onPcm!: (pcm: Int16Array) => void;
  const sessions: Session[] = [];
  class Session {
    audio: number[][] = [];
    cancelled = false;
    constructor(_address: string, _token: string,
      private readAudio: () => Promise<{ audio: number[] } | null>,
      _translate: unknown, public publish: (caption: ReturnType<typeof makeCaption>) => void,
      public onError: (error: string) => void, _at: number, _delay: number, translateEnabled: boolean) {
      expect(translateEnabled).toBe(false);
      sessions.push(this);
    }
    async poll() {
      const audio = await this.readAudio();
      if (audio) this.audio.push(Array.from(pcmFromWav(audio.audio)));
    }
    async finish() {
      calls.push("finish");
      await this.poll();
      expect(listener.finishing).toBe(true);
      this.publish(makeCaption(1, "Final tail", undefined, true));
      this.cancel();
    }
    cancel() { this.cancelled = true; }
  }
  const listener = new Function("api", "rec", "encodeWav", "isIOS", "isMacOS", "describeMicrophoneFailure",
    "normalizeLiveAsrProvider", "VoxtralCaptions", "prepareCaptionAudioCapture", "startCaptionAudioCapture",
    "AudioContext", "navigator", "$state", `${listenerCode}; return new LiveQaListener();`)(
    api, rec, encodeWav, options.ios || false, false, (error: unknown) => ({ message: String(error) }),
    (value: string) => value === "voxtral" || value === "vibevoice" ? "voxtral" : "whisper", Session,
    async () => { calls.push("prepare"); },
    async (_context: unknown, _source: unknown, callback: typeof onPcm) => {
      onPcm = callback;
      callback(new Int16Array([1, 2]));
      return {
        async flush() { calls.push("flush"); callback(new Int16Array([-3])); },
        close() { captureClosed++; },
      };
    }, Context, { mediaDevices: media }, (value: unknown) => value);
  return { listener, rec, stream, sessions, calls, pcm: (pcm: Int16Array) => onPcm(pcm),
    stats: () => ({ stopped, contextClosed, captureClosed }) };
}

test("Q&A only listens to the mic, flushes its PCM tail, and never writes a lecture take", async () => {
  const h = harness();
  try {
    await h.listener.start();
    expect(h.listener.listening).toBe(true);
    expect(h.rec.recording).toBe(false);
    expect(h.rec.status).toBe("ready");
    expect(h.rec.reviewBytes.length).toBe(0);
    await h.rec.start();
    expect(h.rec.errorMsg).toContain("Stop realtime Q&A");
    expect(h.rec.recording).toBe(false);
    h.sessions[0].publish(makeCaption(0, "Question?", undefined, true));
    await h.listener.stop();
    expect(h.calls.indexOf("flush")).toBeLessThan(h.calls.indexOf("finish"));
    expect(h.sessions[0].audio).toEqual([[1, 0, 2, 0], [253, 255]]);
    expect(h.listener.captions.map((row: { original: string }) => row.original)).toEqual(["Question?", "Final tail"]);
    expect(h.listener.finishing).toBe(false);
    expect(h.stats()).toEqual({ stopped: 2, contextClosed: 1, captureClosed: 1 });
    const release = h.rec.reserveLiveQaCapture();
    expect(release).not.toBeNull(); release();
    expect(h.calls).toEqual(["settings", "resume", "prepare", "microphone", "flush", "finish"]);
  } finally { h.listener.cancel(); }
});

test("lecture capture atomically prevents Q&A and cancelled permissions cannot leak a microphone", async () => {
  let allowMic!: (stream: unknown) => void;
  const microphone = new Promise<unknown>((resolve) => { allowMic = resolve; });
  const h = harness({ microphone: () => microphone });
  h.rec.recording = true;
  await h.listener.start();
  expect(h.listener.error).toContain("Stop the lecture");
  expect(h.calls).toEqual([]);
  h.rec.recording = false;
  const pending = h.listener.start();
  while (!h.calls.includes("microphone")) await Promise.resolve();
  h.listener.cancel();
  allowMic(h.stream);
  await pending;
  expect(h.listener.listening).toBe(false);
  expect(h.sessions).toEqual([]);
  expect(h.stats().stopped).toBe(1);
  expect(h.stats().contextClosed).toBe(1);
  const release = h.rec.reserveLiveQaCapture();
  expect(release).not.toBeNull(); release();
});

test("Q&A fails explicitly for Whisper, offline remote ASR and unsupported mobile capture", async () => {
  const cases: Array<{ settings?: Record<string, string>; ios?: boolean; error: string }> = [
    { settings: { live_asr_provider: "whisper" }, error: "Select Voxtral" },
    { settings: { live_asr_provider: "voxtral", offline_mode: "true", vibevoice_url: "http://192.168.1.2:7870" }, error: "Offline mode" },
    { ios: true, error: "desktop webview" },
  ];
  for (const options of cases) {
    const h = harness(options);
    await h.listener.start();
    expect(h.listener.error).toContain(options.error);
    expect(h.calls).toEqual(["settings"]);
    expect(h.listener.starting).toBe(false);
    const release = h.rec.reserveLiveQaCapture();
    expect(release).not.toBeNull(); release();
  }
});

test("a cancelled permission result cannot close or release a replacement listening session", async () => {
  let allowOld!: (stream: unknown) => void;
  const oldMicrophone = new Promise<unknown>((resolve) => { allowOld = resolve; });
  let reads = 0, oldStopped = 0;
  const h = harness({ microphone: () => ++reads === 1 ? oldMicrophone : Promise.resolve(h.stream) });
  try {
    const oldStart = h.listener.start();
    while (!h.calls.includes("microphone")) await Promise.resolve();
    h.listener.cancel();
    await h.listener.start();
    const replacement = h.sessions[0];
    allowOld({ getTracks: () => [{ stop() { oldStopped++; } }] });
    await oldStart;
    expect(oldStopped).toBe(1);
    expect(h.listener.listening).toBe(true);
    expect(replacement.cancelled).toBe(false);
    expect(h.rec.reserveLiveQaCapture()).toBeNull();
    expect(h.stats().contextClosed).toBe(1);
    await h.listener.stop();
    expect(replacement.cancelled).toBe(true);
    expect(h.stats().contextClosed).toBe(2);
  } finally { h.listener.cancel(); }
});

test("audio backlog failure releases capture and ignores stale socket callbacks", async () => {
  const h = harness();
  try {
    await h.listener.start();
    const session = h.sessions[0];
    h.pcm(new Int16Array(16000 * 120 + 1));
    expect(h.listener.error).toContain("two minutes behind");
    expect(h.listener.listening).toBe(false);
    expect(session.cancelled).toBe(true);
    session.publish(makeCaption(0, "Stale", undefined, true));
    session.onError("Stale failure");
    expect(h.listener.captions).toEqual([]);
    expect(h.listener.error).not.toBe("Stale failure");
    expect(h.stats().contextClosed).toBe(1);
    const release = h.rec.reserveLiveQaCapture();
    expect(release).not.toBeNull(); release();
  } finally { h.listener.cancel(); }
});
