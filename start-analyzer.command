#!/bin/bash
# Upwork Profile Analyzer — launcher macOS
cd "$(dirname "$0")"
echo "Menjalankan server AI Analyzer (pakai login Claude Code, tanpa API key)..."
echo
if [ -f "./index.html" ]; then
  ( sleep 1; open "http://localhost:8788" ) &
else
  echo "Mode bridge-only: buka website-mu, lalu Hubungkan pakai KODE PAIRING di bawah."
  echo
fi
node analyzer-server.mjs
echo
echo "Server berhenti."
