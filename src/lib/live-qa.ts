import type { Caption } from "./live-captions";

// Tauri invoke cannot abort a submitted answer. Share its slot across page remounts.
let activeTransport: Promise<unknown> | null = null;

/** ASR finality is independent of translation; the caller deduplicates caption IDs. */
export function finalizedCaptionText(caption: Caption): string | null {
  return caption.final ? caption.original.trim() || null : null;
}

/** FIFO requests; reset invalidates responses but cannot abort the provider transport. */
export class LiveQaQueue<Request, Result> {
  private pending: Request[] = [];
  private running = false;
  private generation = 0;

  constructor(private callbacks: {
    request: (item: Request) => Promise<Result>;
    onStart?: (item: Request) => void;
    onResult: (item: Request, result: Result) => void;
    onError: (item: Request, error: unknown) => void;
  }) {}

  enqueue(item: Request): boolean {
    if (this.pending.length >= 8) {
      this.callbacks.onError(item, new Error("Live Q&A queue is full; this transcript was not submitted"));
      return false;
    }
    this.pending.push(item);
    void this.drain();
    return true;
  }

  reset(): void {
    this.generation++;
    this.pending = [];
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const item = this.pending.shift()!;
        const generation = this.generation;
        try {
          while (activeTransport) {
            await activeTransport.catch(() => {});
            if (generation !== this.generation) break;
          }
          if (generation !== this.generation) continue;
          this.callbacks.onStart?.(item);
          const transport = this.callbacks.request(item);
          activeTransport = transport;
          let result: Result;
          try { result = await transport; }
          finally { if (activeTransport === transport) activeTransport = null; }
          if (generation === this.generation) this.callbacks.onResult(item, result);
        } catch (error) {
          if (generation === this.generation) this.callbacks.onError(item, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
