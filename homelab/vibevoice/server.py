"""Cortex PCM streaming adapter for MLX VibeVoice on Apple Silicon."""
import asyncio
import hmac
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

MODEL_PATH = Path(os.environ["VIBEVOICE_MODEL_PATH"]).resolve()
MODEL_NAME = os.environ.get("VIBEVOICE_MODEL_NAME", MODEL_PATH.parent.name)
TOKEN = os.environ.get("VIBEVOICE_TOKEN", "")
MAX_NEW_TOKENS = int(os.environ.get("VIBEVOICE_MAX_NEW_TOKENS", "128"))
STRICT_WEIGHTS = os.environ.get("VIBEVOICE_STRICT_WEIGHTS", "true").lower() == "true"
ORIGINS = {"tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
           "http://localhost:1420", "http://127.0.0.1:1420"}
executor = ThreadPoolExecutor(max_workers=1)
model = None
busy = False
last_audio = None


class SpeechGain:
    """Gently lift quiet speech for live ASR without altering the saved audio."""
    def __init__(self, target_rms=10 ** (-22 / 20), max_gain=4.0):
        self.target_rms = target_rms
        self.max_gain = max_gain
        self.gain = 1.0

    def push(self, audio):
        if not len(audio):
            return audio
        rms = float(np.sqrt(np.mean(np.square(audio.astype(np.float64)))))
        desired = 1.0 if rms < 0.002 else float(np.clip(self.target_rms / rms, 1.0, self.max_gain))
        # Raise quiet speech immediately; release more slowly to avoid pumping.
        self.gain = desired if desired > self.gain else 0.85 * self.gain + 0.15 * desired
        return np.clip(audio * self.gain, -1.0, 1.0).astype(np.float32)


class Resampler:
    """16 kHz to 24 kHz linear interpolation with phase shared across packets."""
    def __init__(self):
        self.buffer = np.empty(0, dtype=np.float32)
        self.base = 0
        self.next_tick = 0

    def push(self, pcm):
        self.buffer = np.concatenate((self.buffer, pcm))
        last = self.base + len(self.buffer) - 1
        ticks = np.arange(self.next_tick, last * 3 + 1, 2, dtype=np.int64)
        if not len(ticks):
            return np.empty(0, dtype=np.float32)
        out = np.interp(ticks / 3 - self.base, np.arange(len(self.buffer)), self.buffer)
        self.next_tick = int(ticks[-1]) + 2
        keep = min(self.next_tick // 3 - self.base, len(self.buffer) - 1)
        self.buffer = self.buffer[keep:]
        self.base += keep
        return out.astype(np.float32)


def load_model():
    global model
    import mlx.core as mx
    from mlx_audio.stt import load
    mx.set_memory_limit(22 * 1024**3)
    mx.set_cache_limit(256 * 1024**2)
    model = load(MODEL_PATH, model_type="vibevoice_asr", strict=STRICT_WEIGHTS)
    if not model.is_streaming_model or model.sample_rate != 24000:
        raise ValueError("Expected a 24 kHz VibeVoice streaming checkpoint")


async def work(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(executor, fn, *args)


@asynccontextmanager
async def lifespan(app):
    if not 16 <= MAX_NEW_TOKENS <= 512:
        raise ValueError("VIBEVOICE_MAX_NEW_TOKENS must be between 16 and 512")
    await work(load_model)
    yield
    executor.shutdown(wait=True)


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def health():
    return {"status": "ok" if model else "loading", "model": MODEL_NAME,
            "protocol": "cortex-pcm-v1", "busy": busy, "last_audio": last_audio}


def step(audio, state):
    import mlx.core as mx
    features = model.encode_speech(mx.array(audio)[None, :])
    text, state = model.streaming_generate_step(features, state, max_new_tokens=MAX_NEW_TOKENS)
    mx.clear_cache()
    return text, state


@app.websocket("/ws/cortex")
async def stream(ws: WebSocket):
    global busy, last_audio
    # Local pages cannot silently open the microphone stream endpoint. LAN use
    # additionally requires a token; tokens travel in the first frame, not URLs.
    origin = ws.headers.get("origin")
    if origin and origin not in ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    claimed = False
    receiver = None
    state = None
    try:
        hello = await asyncio.wait_for(ws.receive_json(), 10)
        if TOKEN and not hmac.compare_digest(str(hello.get("token", "")), TOKEN):
            raise ValueError("Invalid VibeVoice access token")
        if hello.get("protocol") != "cortex-pcm-v1":
            raise ValueError("Unsupported streaming protocol")
        if busy:
            raise ValueError("VibeVoice is serving another recording; try again later")
        busy = claimed = True
        state = await work(model.init_streaming_state)
        await ws.send_json({"type": "ready", "sample_rate": 16000})
        queue = asyncio.Queue(maxsize=120)
        queued_bytes = 0
        received_samples = 0

        async def receive():
            nonlocal queued_bytes, received_samples
            try:
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        raise WebSocketDisconnect()
                    if message.get("text") == "end":
                        await queue.put(None)
                        return
                    raw = message.get("bytes")
                    if raw is None or len(raw) % 2 or len(raw) > 320000:
                        raise ValueError("Expected at most ten seconds of mono 16 kHz PCM16")
                    if queue.full() or queued_bytes + len(raw) > 16000 * 2 * 30:
                        raise ValueError("Live ASR is more than thirty seconds behind")
                    queued_bytes += len(raw)
                    received_samples += len(raw) // 2
                    queue.put_nowait(raw)
            except Exception as error:
                # Wake the consumer even when the audio queue is full.
                while not queue.empty():
                    queue.get_nowait()
                await queue.put(error)

        receiver = asyncio.create_task(receive())
        resampler = Resampler()
        speech_gain = SpeechGain()
        buffer = np.empty(0, dtype=np.float32)
        index = 0
        total_samples = 0
        sum_squares = 0.0
        peak = 0.0
        while True:
            raw = await queue.get()
            if isinstance(raw, Exception):
                raise raw
            final = raw is None
            if not final:
                queued_bytes -= len(raw)
                total_samples += len(raw) // 2
                if total_samples > 16000 * 60 * 60:
                    raise ValueError("Live sessions are limited to one hour; reopen captions to continue")
                audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
                sum_squares += float(np.dot(audio.astype(np.float64), audio.astype(np.float64)))
                peak = max(peak, float(np.max(np.abs(audio), initial=0.0)))
                rms = (sum_squares / total_samples) ** 0.5 if total_samples else 0.0
                last_audio = {
                    "seconds": round(total_samples / 16000, 2),
                    "rms_dbfs": round(20 * np.log10(max(rms, 1e-9)), 1),
                    "peak": round(peak, 4),
                    "gain": round(speech_gain.gain, 2),
                }
                buffer = np.concatenate((buffer, resampler.push(speech_gain.push(audio))))
            while len(buffer) >= model.streaming_window_samples or (final and len(buffer)):
                window = buffer[:model.streaming_window_samples]
                window = np.pad(window, (0, model.streaming_window_samples - len(window)))
                step_started = time.perf_counter()
                text, state = await work(step, window, state)
                step_seconds = time.perf_counter() - step_started
                processed_seconds = min(
                    received_samples / 16000,
                    (index + 1) * model.streaming_chunk_samples / model.sample_rate,
                )
                last_audio.update({
                    "processed_seconds": round(processed_seconds, 2),
                    "lag_seconds": round(max(0.0, received_samples / 16000 - processed_seconds), 2),
                    "last_step_seconds": round(step_seconds, 2),
                })
                await ws.send_json({"type": "chunk", "index": index,
                                    "at": index * model.streaming_chunk_samples / model.sample_rate,
                                    "text": text})
                index += 1
                buffer = buffer[model.streaming_chunk_samples:]
            if final:
                await ws.send_json({"type": "done"})
                break
    except WebSocketDisconnect:
        pass
    except Exception as error:
        try:
            await ws.send_json({"type": "error", "error": str(error)})
        except Exception:
            pass
    finally:
        if receiver:
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)
        state = None
        if claimed:
            # All work on this session has drained before accepting another.
            await work(lambda: __import__("mlx.core", fromlist=["clear_cache"]).clear_cache())
            busy = False
        try:
            await ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("VIBEVOICE_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "::1", "localhost"} and len(TOKEN) < 24:
        raise SystemExit("LAN binding requires VIBEVOICE_TOKEN with at least 24 characters")
    uvicorn.run(app, host=host, port=int(os.environ.get("VIBEVOICE_PORT", "7870")),
                ws_max_size=320000, access_log=False)
