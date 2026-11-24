#!/usr/bin/env bash
# Start Germline Exome QC Hub for the LAN. Rebuilds the frontend only if it hasn't been built yet.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-9000}"
export PATH="$HOME/.local/bin:$PATH"

if [ ! -d frontend/dist ]; then
  echo "Building frontend…"
  (cd frontend && npm install && npm run build)
fi

LAN_IP="$(hostname -I | awk '{print $1}')"
echo
echo "  Germline Exome QC Hub is starting…"
echo "  On this machine:      http://localhost:${PORT}"
echo "  For everyone on LAN:  http://${LAN_IP}:${PORT}"
echo "  Press Ctrl+C to stop."
echo

if [ ! -d backend/vswarehouse/node_modules ]; then
  echo "Installing token monitor dependencies..."
  (cd backend/vswarehouse && npm install)
fi

cd backend
source .venv/bin/activate
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"
