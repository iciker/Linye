import os
import unittest
os.environ.setdefault("VIBEVOICE_MODEL_PATH", "/tmp/unused-test-model")
import numpy as np
from server import Resampler, SpeechGain


class ResamplerTests(unittest.TestCase):
    def test_packet_boundaries_do_not_change_audio(self):
        audio = np.sin(np.arange(16000, dtype=np.float32) / 12)
        whole = Resampler().push(audio)
        fragmented = Resampler()
        parts = [fragmented.push(part) for part in np.array_split(audio, 173)]
        np.testing.assert_array_equal(np.concatenate(parts), whole)
        self.assertEqual(len(whole), 23999)

    def test_silence_and_empty_input(self):
        resampler = Resampler()
        self.assertEqual(len(resampler.push(np.empty(0))), 0)
        self.assertTrue(np.all(resampler.push(np.zeros(16000)) == 0))


class SpeechGainTests(unittest.TestCase):
    def test_quiet_speech_is_lifted_without_clipping(self):
        audio = np.sin(np.arange(16000, dtype=np.float32) / 12) * 0.01
        gain = SpeechGain()
        boosted = gain.push(audio)
        self.assertEqual(gain.gain, 4.0)
        self.assertAlmostEqual(float(np.max(np.abs(boosted))), 0.04, places=3)

    def test_near_silence_is_not_amplified(self):
        gain = SpeechGain()
        silence = np.full(16000, 0.0001, dtype=np.float32)
        np.testing.assert_array_equal(gain.push(silence), silence)
        self.assertEqual(gain.gain, 1.0)


if __name__ == "__main__":
    unittest.main()
