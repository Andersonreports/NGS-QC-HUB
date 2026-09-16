#!/usr/bin/env bash
# Start the NGS QC Hub backend (serves the built frontend too, if present).
set -euo pipefail
cd "$(dirname "$0")"
source .venv/bin/activate
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
