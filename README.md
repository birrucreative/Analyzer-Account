# Upwork Profile Analyzer

Website yang menganalisa **profil Upwork**, memberi **skor /100**, daftar **masalah yang harus diperbaiki**, dan **rewrite siap pakai** (judul, bio client-first, skill tags).

Ditenagai **Claude Code di komputermu sendiri** lewat *local bridge* + *kode pairing* — pakai langganan Claude Pro/Max-mu, **TANPA API key**. Profil & hasil tidak dikirim ke server pihak ketiga.

Logika audit diturunkan dari artikel *"Upwork Has Changed"* + kerangka konsultan: positioning di era algoritma AI Upwork 2025–2026 (judul spesialis, bio client-first, positioning AI, outcome bisnis, niche, social proof, skill tags, Project Catalog, presence di luar Upwork).

---

## Prasyarat (sekali setup)
- **Node.js** — https://nodejs.org
- **Claude Code** terpasang & sudah login: jalankan `claude` sekali di terminal sampai bisa dipakai.

## Cara pakai (lokal)
1. Jalankan launcher:
   - **Windows:** dobel-klik `start-analyzer.bat`
   - **macOS:** dobel-klik `start-analyzer.command` (sekali: `chmod +x start-analyzer.command`)
2. Browser otomatis membuka `http://localhost:8788` (kode pairing terisi otomatis).
3. Tempel **link profil Upwork** → **Analisa Profil**.
   - Kalau hasil kosong (Upwork memblok akses otomatis), buka **"+ atau tempel teks profil"**, salin isi profil (judul, overview, skills, stats), lalu analisa lagi — ini jalur paling andal.

## Cara pakai (website + bridge)
Website bisa dideploy statis (mis. Vercel), tiap orang menjalankan bridge di komputernya:
1. Nyalakan `start-analyzer.bat` → terminal menampilkan **KODE PAIRING** (mis. `A1B2C3D4`).
2. Buka website di **Chrome/Edge/Firefox** (Safari memblok https→localhost).
3. Klik **"Hubungkan Claude lokal"**, tempel kode → status **terhubung ✓**.
4. Analisa seperti biasa.

> Kode pairing tersimpan di browser. Restart bridge = kode baru (tempel ulang). Mau kode tetap: `set PAIR_TOKEN=KODEKU & node analyzer-server.mjs`.

---

## Isi proyek
| File | Fungsi |
|---|---|
| `index.html` | UI analyzer (input link/teks, skor, dimensi, masalah, rewrite) |
| `analyzer-server.mjs` | Bridge lokal: meneruskan profil ke `claude --print`, gerbang kode pairing, rubrik audit |
| `start-analyzer.bat` | Launcher Windows |
| `start-analyzer.command` | Launcher macOS |
| `rubric.txt` | (opsional, dibuat otomatis) rubrik audit kustom |

## Catatan
- Port **8788** (beda dari generator cover letter 8787) → keduanya bisa jalan bersamaan.
- Model: **Sonnet** (cepat) atau **Opus** (paling dalam).
- Analisa via link memakai WebSearch Claude untuk data profil publik; kalau diblok Upwork, pakai tempel-teks.

🤖 Dibuat dengan bantuan [Claude Code](https://claude.com/claude-code)
