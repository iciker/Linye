#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_runtime="$task_root/.local/vibevoice-7b"
fast_model="$task_root/.local/vibevoice-1.5b/model"
if [[ -f "$fast_model/model-00003-of-00003.safetensors" ]]; then
  default_model="$fast_model"
  default_name="VibeVoice-ASR-Streaming-1.5B"
  default_strict="false"
else
  default_model="$task_runtime/model"
  default_name="VibeVoice-ASR-Streaming-7B"
  default_strict="true"
fi
if [[ ! -x "$task_runtime/venv/bin/python" || ! -f "$default_model/model.safetensors.index.json" ]]; then
  echo 'VibeVoice runtime/model missing. See homelab/vibevoice/README.md.' >&2
  exit 1
fi
export VIBEVOICE_MODEL_PATH="${VIBEVOICE_MODEL_PATH:-$default_model}"
export VIBEVOICE_MODEL_NAME="${VIBEVOICE_MODEL_NAME:-$default_name}"
export VIBEVOICE_STRICT_WEIGHTS="${VIBEVOICE_STRICT_WEIGHTS:-$default_strict}"
export HF_HOME="${HF_HOME:-$task_runtime/hf-cache}"
export HF_HUB_OFFLINE=1
exec "$task_runtime/venv/bin/python" -u "$task_root/homelab/vibevoice/server.py"
