# Design Contract — Upwork Profile Analyzer

Mode: **Existing → Refine** (pertahankan arah, naikkan ke kualitas produk).

> Catatan arsitektur: produk ini WAJIB satu file `index.html` statis (dilayani bridge lokal + bisa dobel-klik + deploy statis). Karena itu shadcn/ui (React) tidak dipasang; yang diadopsi adalah **bahasa desain shadcn** (token sistem, badge, kartu, hierarki, audit Phase 1 & 3) diimplementasi **vanilla CSS**.

```
AESTHETIC: minimal product UI ala shadcn / Linear — tenang, percaya-diri pada data, banyak ruang napas.
TYPE: Instrument Sans (display + body) / Instrument Serif italic (aksen eyebrow & verdict) / JetBrains Mono (skor & kode pairing).
COLOR: netral zinc (#18181b fg, #6b7280 muted, #e8e8ea border, #f7f7f6 bg) + 1 aksen hijau Upwork #14a800. Status: hijau (baik) / amber #d97706 (perlu dibenahi) / merah #dc2626 (kritis) / biru #2563eb (info). Tanpa gradien kecuali logo.
MOTION: halus & cepat (≤300ms), ease-out untuk masuk; bar skor animasi tumbuh; angka skor count-up.
FORBIDDEN: Inter sebagai font utama, em-dash (—) di teks apa pun (ganti koma/titik), purple SaaS gradient, kartu tanpa hierarki, magic-number spacing.
```

Audit (Phase 3) target ≥85: tipografi 2 font, skala spasi konsisten, kontras AA, satu CTA primer per layar, status badge konsisten, fokus ring di semua kontrol, state loading/error/empty ada, responsif 360–1440.
