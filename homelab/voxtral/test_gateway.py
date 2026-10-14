import asyncio
import base64
import json
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("VOXTRAL_UPSTREAM_URL", "ws://127.0.0.1:7871/v1/realtime")

from gateway import EventBridge, StreamStats, append_event, cortex_stream, session_update, upstream_url


class VoxtralProtocolTests(unittest.TestCase):
    def test_stream_stats_distinguish_audio_delivery_from_caption_delivery(self):
        stats = StreamStats(started_at=100.0)
        stats.record_audio(3200, now=101.0)
        bridge = EventBridge(stats=stats, clock=lambda: 101.0)
        bridge.translate({
            "type": "conversation.item.input_audio_transcription.delta",
            "delta": "Hello",
        }, elapsed=0.1)

        snapshot = stats.snapshot(now=106.0)
        self.assertEqual(snapshot["audio_packets"], 1)
        self.assertEqual(snapshot["audio_bytes"], 3200)
        self.assertEqual(snapshot["audio_seconds"], 0.1)
        self.assertEqual(snapshot["caption_chunks"], 1)
        self.assertEqual(snapshot["seconds_since_audio"], 5.0)
        self.assertEqual(snapshot["seconds_since_caption"], 5.0)

    def test_upstream_url_adds_the_selected_model_without_accepting_credentials(self):
        url = upstream_url(
            "ws://127.0.0.1:7871/v1/realtime",
            "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
        )
        self.assertIn("model=mlx-community%2FVoxtral-Mini-4B-Realtime-2602-4bit", url)
        with self.assertRaises(ValueError):
            upstream_url("ws://user:secret@127.0.0.1:7871/v1/realtime", "model")

    def test_session_declares_16khz_pcm_and_server_vad_turn_boundaries(self):
        message = session_update()
        audio = message["session"]["audio"]["input"]
        self.assertEqual(audio["format"], {"type": "audio/pcm", "rate": 16000})
        self.assertEqual(audio["turn_detection"], {
            "type": "server_vad",
            "threshold": 0.5,
            "prefix_padding_ms": 300,
            "silence_duration_ms": 700,
        })

    def test_session_can_disable_turn_detection_for_the_final_flush(self):
        message = session_update(turn_detection=False)
        self.assertIsNone(message["session"]["audio"]["input"]["turn_detection"])

    def test_pcm_is_encoded_for_the_openai_realtime_wire_format(self):
        raw = b"\x01\x02\x03\x04"
        self.assertEqual(append_event(raw), {
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(raw).decode("ascii"),
        })

    def test_incremental_tokens_map_to_ordered_cortex_chunks(self):
        bridge = EventBridge()
        self.assertEqual(bridge.translate({
            "type": "conversation.item.input_audio_transcription.delta",
            "delta": "Hello",
        }, elapsed=0.48), {"type": "chunk", "index": 0, "at": 0.48, "text": "Hello"})
        self.assertEqual(bridge.translate({
            "type": "conversation.item.input_audio_transcription.delta",
            "delta": " world",
        }, elapsed=0.96), {"type": "chunk", "index": 1, "at": 0.96, "text": " world"})
        self.assertIsNone(bridge.translate({"type": "session.updated"}, elapsed=1.0))

    def test_intermediate_turn_completion_keeps_the_cortex_session_open(self):
        bridge = EventBridge()
        self.assertIsNone(bridge.translate({
            "type": "input_audio_buffer.committed",
        }, elapsed=1.0))
        self.assertEqual(bridge.translate({
            "type": "conversation.item.input_audio_transcription.completed",
        }, elapsed=1.1), {"type": "turn_done"})
        self.assertEqual(bridge.committed_turns, 1)
        self.assertEqual(bridge.completed_turns, 1)
        self.assertEqual(bridge.session_updates, 0)

        self.assertIsNone(bridge.translate({"type": "session.updated"}, elapsed=1.2))
        self.assertEqual(bridge.session_updates, 1)
        self.assertEqual(bridge.translate({
            "type": "conversation.item.input_audio_transcription.delta",
            "delta": "Next question",
        }, elapsed=1.3), {"type": "chunk", "index": 0, "at": 1.3, "text": "Next question"})

    def test_empty_turn_completion_preserves_the_final_commit_counter_and_chunk_index(self):
        bridge = EventBridge(index=2, committed_turns=1)
        self.assertEqual(bridge.translate({
            "type": "conversation.item.input_audio_transcription.completed",
            "transcript": "",
        }, elapsed=1.1), {"type": "turn_done"})
        self.assertEqual(bridge.completed_turns, 1)
        self.assertEqual(bridge.index, 2)

    def test_upstream_errors_are_exposed_without_leaking_structures(self):
        bridge = EventBridge()
        self.assertEqual(bridge.translate({
            "type": "error", "error": {"message": "model failed"},
        }, elapsed=0), {"type": "error", "error": "model failed"})


class VoxtralSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_done_waits_for_the_final_turn_completion_to_be_delivered(self):
        upstream_events = asyncio.Queue()
        final_delivery_started = asyncio.Event()
        release_final_delivery = asyncio.Event()
        next_turn = asyncio.Event()
        received = []
        upstream_requests = []

        class Upstream:
            def __aiter__(self):
                return self

            async def __anext__(self):
                return await self.recv()

            async def recv(self):
                return json.dumps(await upstream_events.get())

            async def send(self, payload):
                event = json.loads(payload)
                upstream_requests.append(event)
                kind = event["type"]
                if kind == "session.update":
                    await upstream_events.put({"type": "session.updated"})
                elif kind == "input_audio_buffer.append":
                    for event in [
                        {"type": "input_audio_buffer.committed"},
                        {"type": "conversation.item.input_audio_transcription.delta", "delta": "What is a closure"},
                        {"type": "conversation.item.input_audio_transcription.completed", "transcript": "What is a closure"},
                    ]:
                        await upstream_events.put(event)
                elif kind == "input_audio_buffer.commit":
                    await upstream_events.put({"type": "input_audio_buffer.committed"})
                    await upstream_events.put({"type": "conversation.item.input_audio_transcription.completed", "transcript": ""})

            async def close(self):
                pass

        class Client:
            headers = {}
            client = None
            reads = 0

            async def accept(self):
                pass

            async def receive_json(self):
                return {"protocol": "cortex-pcm-v1", "token": ""}

            async def receive(self):
                self.reads += 1
                if self.reads == 1:
                    return {"type": "websocket.receive", "bytes": b"\x00\x00"}
                await next_turn.wait()
                return {"type": "websocket.receive", "text": "end"}

            async def send_json(self, event):
                if event["type"] == "turn_done":
                    if any(row["type"] == "turn_done" for row in received):
                        final_delivery_started.set()
                        await release_final_delivery.wait()
                    else:
                        next_turn.set()
                received.append(event)

            async def close(self):
                pass

        async def connect_upstream(*_args, **_kwargs):
            await upstream_events.put({"type": "session.created"})
            return Upstream()

        with patch("gateway.connect", connect_upstream), patch("gateway.TOKEN", ""):
            task = asyncio.create_task(cortex_stream(Client()))
            try:
                await asyncio.wait_for(final_delivery_started.wait(), timeout=1)
                await asyncio.sleep(0)
                self.assertNotIn({"type": "done"}, received)
                release_final_delivery.set()
                await asyncio.wait_for(task, timeout=1)
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self.assertEqual([row["type"] for row in received], ["ready", "chunk", "turn_done", "turn_done", "done"])
        self.assertEqual(upstream_requests[-2], session_update(turn_detection=False))
        self.assertEqual(upstream_requests[-1], {"type": "input_audio_buffer.commit"})


if __name__ == "__main__":
    unittest.main()
