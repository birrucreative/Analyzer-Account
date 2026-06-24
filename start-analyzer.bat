@echo off
title Upwork Profile Analyzer (AI - login Claude)
cd /d "%~dp0"
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
