@echo off
title Upwork Profile Analyzer (AI - login Claude)
cd /d "%~dp0"

rem --- Pastikan Node.js terpasang ---
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js belum terpasang.
  echo     Pasang dari https://nodejs.org lalu jalankan file ini lagi.
  echo.
  pause >nul
  exit /b 1
)

rem --- Pasang dependency SEKALI (playwright-core) untuk fitur auto-fetch link ---
if not exist "%~dp0node_modules" (
  echo [*] Persiapan pertama kali: memasang dependency ^(npm install^)...
  echo     ^(sekali saja, butuh internet, ringan^)
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [!] npm install gagal. Mode auto-fetch link mungkin tidak aktif,
    echo     tapi mode "tempel teks profil" tetap bisa dipakai. Lanjut...
    echo.
  )
)

echo Menjalankan server AI Analyzer (pakai login Claude Code, tanpa API key)...
echo.
rem Buka browser HANYA kalau index.html ada di folder ini (mode lokal penuh).
if exist "%~dp0index.html" (
  start "" "http://localhost:8788"
) else (
  echo Mode bridge-only: buka website-mu, lalu Hubungkan pakai KODE PAIRING di bawah.
  echo.
)
node analyzer-server.mjs
echo.
echo Server berhenti. Tekan tombol apa saja untuk menutup.
pause >nul
