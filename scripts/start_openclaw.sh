#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .openclaw/state logs

export OPENCLAW_CONFIG_PATH="$ROOT_DIR/.openclaw/config.json"
export OPENCLAW_STATE_DIR="$ROOT_DIR/.openclaw/state"

exec openclaw gateway run \
  --dev \
  --allow-unconfigured \
  --auth none \
  --port 8081
