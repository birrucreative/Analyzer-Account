#!/bin/bash
# Upwork Profile Analyzer — launcher macOS / Linux
cd "$(dirname "$0")"

# --- Pastikan Node.js terpasang ---
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js belum terpasang."
  echo "    Pasang dari https://nodejs.org lalu jalankan file ini lagi."
  echo
  read -n 1 -s -r -p "Tekan tombol apa saja untuk menutup..."
  exit 1
fi

# --- Pasang dependency SEKALI (playwright-core) untuk fitur auto-fetch link ---
if [ ! -d "./node_modules" ]; then
  echo "[*] Persiapan pertama kali: memasang dependency (npm install)..."
  echo "    (sekali saja, butuh internet, ringan)"
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "[!] npm install gagal. Mode auto-fetch link mungkin tidak aktif,"
    echo "    tapi mode \"tempel teks profil\" tetap bisa dipakai. Lanjut..."
    echo
  fi
fi

echo "Menjalankan server AI Analyzer (pakai login Claude Code, tanpa API key)..."
echo
if [ -f "./index.html" ]; then
  ( sleep 1; open "http://localhost:8788" 2>/dev/null || xdg-open "http://localhost:8788" 2>/dev/null ) &
else
  echo "Mode bridge-only: buka website-mu, lalu Hubungkan pakai KODE PAIRING di bawah."
  echo
fi
node analyzer-server.mjs
echo
echo "Server berhenti."
