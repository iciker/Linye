import * as api from "./api";
import { rec, encodeWav } from "./recorder.svelte";
import { isIOS, isMacOS } from "./platform";
import { describeMicrophoneFailure } from "./recorder-errors";
import { normalizeLiveAsrProvider } from "./realtime-asr";
import { VoxtralCaptions } from "./vibevoice";
import { prepareCaptionAudioCapture, startCaptionAudioCapture, type CaptionAudioCapture } from "./caption-audio";
import type { Caption } from "./live-captions";

/** A microphone-only listener: no MediaRecorder, audio files, save or lecture state. */
class LiveQaListener {
  listening = $state(false);
  starting = $state(false);
  finishing = $state(false);
  error = $state("");
  captions = $state<Caption[]>([]);

  private generation = 0;
  private releaseCapture: (() => void) | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private capture: CaptionAudioCapture | null = null;
  private session: VoxtralCaptions | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pcm: Int16Array[] = [];
  private samples = 0;
  private sentSamples = 0;

  async start(): Promise<void> {
    if (this.starting || this.listening || this.finishing) return;
    const release = rec.reserveLiveQaCapture();
    if (!release) { this.error = "Stop the lecture recording before starting realtime Q&A."; return; }
    const generation = ++this.generation;
    this.releaseCapture = release;
    this.starting = true;
    this.error = "";
    this.captions = [];
    try {
      const settings = await api.getAllSettings();
      if (generation !== this.generation) return;
      if (normalizeLiveAsrProvider(settings.live_asr_provider) !== "voxtral") {
        throw new Error("Select Voxtral in Settings → Integrations before starting realtime Q&A.");
      }
      const address = settings.vibevoice_url || "http://127.0.0.1:7870";
      if (settings.offline_mode === "true" &&
          !["127.0.0.1", "localhost", "[::1]"].includes(new URL(address).hostname)) {
        throw new Error("Offline mode only allows a local Voxtral server");
      }
      if (isIOS || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Realtime Q&A microphone listening requires a desktop webview with AudioWorklet support.");
      }
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      await prepareCaptionAudioCapture(context);
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error) => {
        throw new Error(describeMicrophoneFailure(error, isMacOS).message);
      });
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const source = context.createMediaStreamSource(stream);
      const session = new VoxtralCaptions(address, settings.vibevoice_token || "",
        async () => {
          if (generation !== this.generation || !this.samples) return null;
          const blocks = this.pcm, at = this.sentSamples / 16000;
          this.sentSamples += this.samples;
          this.pcm = []; this.samples = 0;
          return { audio: Array.from(encodeWav(blocks)), at };
        },
        async () => "", // Translation is disabled; confirmed originals go straight to Q&A.
        (caption) => {
          if (generation !== this.generation) return;
          const index = this.captions.findIndex((row) => row.id === caption.id);
          this.captions = index < 0 ? [...this.captions, { ...caption }]
            : this.captions.map((row, at) => at === index ? { ...caption } : row);
        },
        (error) => { if (generation === this.generation) this.fail(error); },
        0, 150, false);
      this.session = session;
      const capture = await startCaptionAudioCapture(context, source, (pcm) => {
        if (generation !== this.generation) return;
        if (this.samples + pcm.length > 16000 * 120) {
          this.fail("Realtime Q&A audio is more than two minutes behind. Check Voxtral, then restart listening.");
          return;
        }
        this.pcm.push(pcm); this.samples += pcm.length;
      });
      if (generation !== this.generation) { capture.close(); return; }
      this.capture = capture;
      this.listening = true;
      // VoxtralCaptions.poll serializes reads even if a delayed socket spans several ticks.
      this.timer = setInterval(() => { void session.poll(); }, 250);
      await session.poll();
    } catch (error) { if (generation === this.generation) this.fail(String(error)); }
    finally { if (generation === this.generation) this.starting = false; }
  }

  async stop(): Promise<void> {
    if (this.finishing) return;
    if (this.starting) { this.cancel(); return; }
    if (!this.listening) return;
    const generation = this.generation;
    this.finishing = true;
    this.listening = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Freeze the microphone first, then flush the worklet's partial final PCM packet.
    this.stream?.getTracks().forEach((track) => track.stop());
    try {
      await this.capture?.flush();
      if (generation !== this.generation) return;
      this.capture?.close(); this.capture = null;
      await this.session?.finish();
    } catch (error) { if (generation === this.generation) this.error = String(error); }
    finally { if (generation === this.generation) this.cleanup(); }
  }

  cancel(): void { this.cleanup(); this.captions = []; }

  private fail(error: string): void { this.error = error; this.cleanup(); }

  private cleanup(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.session?.cancel(); this.session = null;
    this.capture?.close(); this.capture = null;
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
    void this.context?.close().catch(() => {}); this.context = null;
    this.releaseCapture?.(); this.releaseCapture = null;
    this.pcm = []; this.samples = 0; this.sentSamples = 0;
    this.listening = false; this.starting = false; this.finishing = false;
  }
}

export const liveQa = new LiveQaListener();
