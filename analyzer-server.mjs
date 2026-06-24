// Upwork Profile Analyzer — local AI bridge
// Meneruskan profil dari UI ke Claude Code CLI (`claude --print`) yang sudah login
// pakai langganan Claude Pro/Max — TANPA API key.
//
// Jalankan:  node analyzer-server.mjs   (atau dobel-klik start-analyzer.bat)
// Lalu buka: http://localhost:8788
//
// Mesin: AI Claude lokal. Membaca/menelusuri profil Upwork → audit + skor + rewrite.

import http from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 8788; // beda dari generator cover letter (8787) → bisa jalan bersamaan
const DIR = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(DIR, 'index.html');
const RUBRIC_FILE = path.join(DIR, 'rubric.txt'); // rubrik kustom (opsional) yang diedit dari website
const MODELS = new Set(['sonnet', 'opus', 'haiku']);

// Kode pairing: pengaman supaya hanya website yang kamu beri kode ini bisa
// memakai bridge Claude di komputermu. Dicetak saat start; ditempel ke website.
const PAIR_TOKEN = (process.env.PAIR_TOKEN || crypto.randomBytes(8).toString('hex')).toUpperCase();

/* ============================================================
   RUBRIK ANALISA — logika "Upwork Consultant Expert".
   Diturunkan dari artikel "Upwork Has Changed" + kerangka audit.
   FIXED: instruksi teknis output (tidak bisa diedit dari website).
   ============================================================ */
const FIXED_PREAMBLE = `You are an elite Upwork Profile Consultant (10+ years placing freelancers in the top 1%). You audit a freelancer's Upwork profile and return a structured, brutally honest, actionable report. You ALWAYS return ONE JSON object and nothing else: no markdown, no code fences, no commentary before or after.

WRITING RULE (mandatory, applies to EVERY string in your output, including the rewrites): never use the em-dash character. Replace it with a comma or a period, whichever fits the sentence. Use plain, natural punctuation only.`;

// RUBRIC: logika penilaian — bisa diedit user dari website (disimpan ke rubric.txt).
const DEFAULT_RUBRIC = `=== CONTEXT — How Upwork works now (2025-2026) ===
Upwork is now an AI-powered marketplace: AI drives search, recommendations, ranking, and client matching. The decisive factor is POSITIONING, not effort or price. "Can-do-everything" profiles are dead. Freelancers split into two groups: (1) cheap executors → being replaced by AI; (2) those who solve business problems AND visibly leverage AI → winning the next decade. A profile is no longer isolated — clients Google the name and check LinkedIn / YouTube / Behance before hiring, so off-Upwork authority is a trust signal.

=== SCORING — total 0-100, sum of weighted dimensions ===
Score EACH dimension out of its max. status = "good" (>=80% of max), "warning" (40-79%), "critical" (<40%).
1. Title / Headline (max 15) — must read as a SPECIALIST: niche + service + outcome. Penalize identity dilution (e.g. "| Graphic Designer" tacked on, or stacking multiple roles) — the algorithm reads that as a generalist and deprioritizes it.
2. Bio / Overview client-orientation (max 20) — must OPEN by addressing the CLIENT's problem, not "Hello! I'm...". Penalize self-first openers and "can-do-all" signals ("I also design logos, characters, and more!", "diverse industries"). The hook must land within the first ~210 characters (Upwork truncates the preview).
3. AI positioning (max 10) — does the profile show the freelancer leverages AI tools in their craft? Absence puts them in the threatened "Group 1". Reward concrete, craft-relevant AI usage.
4. Business outcomes (max 15) — concrete, QUANTIFIED results ($ raised, deals closed, %, funding, ROI). Penalize vague claims ("impactful decks", "high quality").
5. Niche clarity (max 10) — one sharp niche vs scattered services. Identify any HIGH-DEMAND niche already hinted in the profile but not exploited (e.g. Crypto/Web3, SaaS, fintech).
6. Social proof & consistency (max 15) — Top Rated / Plus, Job Success Score, rating, # reviews, # jobs, years active, country reach. FLAG suspicious gaps (e.g. very few reviews vs many years) and any inconsistency.
7. Skill tags (max 5) — must align tightly with the niche (the algorithm uses them to decide which searches you appear in).
8. Project Catalog / packaging (max 5) — productized fixed-price packages with clear deadlines get an algorithm boost and convert time-poor clients.
9. Off-Upwork presence (max 5) — LinkedIn / YouTube / Behance authority as a trust signal.

=== HOW TO WRITE THE REPORT ===
- Be SPECIFIC and quote the actual profile. Never generic filler.
- For each dimension give: score, max, status, finding (what is right/wrong, quoting the profile), and fix (one concrete action).
- criticalProblems: the 2-4 highest-impact issues, ranked, each with a clear "why it hurts".
- biggestOpportunity: the single most valuable untapped move.
- firstStep: the ONE thing to do today for the biggest fast win.
- rewrites.newTitle: 2-3 ready-to-paste title options (niche + service + outcome).
- rewrites.newBio: a ready-to-paste, client-first overview — first person, hook in the first sentence (problem the client feels), then solution → proof/credibility → soft CTA. ~120-180 words, plain text, no markdown.
- rewrites.skillTags: 8-12 niche-aligned skill tags.

=== LANGUAGE ===
Write ALL analysis prose (verdict, summary, strengths, findings, fixes, criticalProblems, biggestOpportunity, firstStep) in Bahasa Indonesia. Keep the ready-to-paste rewrites (newTitle, newBio, skillTags) in English (the client-facing language of Upwork).`;

const OUTPUT_SHAPE = `=== STRICT OUTPUT ===
Return EXACTLY ONE JSON object (no markdown, no code fences, no text around it) with this shape:
{
  "profileFound": boolean,            // false if you genuinely could not retrieve enough profile data
  "score": number,                    // 0-100 overall
  "verdict": string,                  // 1-2 sentence headline verdict (Bahasa Indonesia)
  "summary": string,                  // 2-4 sentence executive summary (Bahasa Indonesia)
  "strengths": string[],              // things that are already strong — do NOT change (Bahasa Indonesia)
  "dimensions": [                     // one per scoring dimension above
    { "name": string, "score": number, "max": number, "status": "good"|"warning"|"critical", "finding": string, "fix": string }
  ],
  "criticalProblems": [ { "title": string, "detail": string } ],  // ranked, highest impact first
  "biggestOpportunity": string,
  "firstStep": string,
  "rewrites": {
    "newTitle": string[],             // 2-3 options, English
    "newBio": string,                 // English, client-first, ~120-180 words
    "skillTags": string[]             // 8-12, English
  }
}
If profileFound is false, still return the object: set score to 0, explain in summary what data you need, and leave arrays/rewrites empty.`;

/* ============================================================ */

function buildUserPrompt(b) {
  const lines = ['=== PROFILE TO ANALYZE ==='];
  const url = (b.url || '').trim();
  const text = (b.profileText || '').trim();

  if (url) {
    lines.push('Source URL: ' + url);
    lines.push(
      'Use the WebSearch tool FIRST to find this Upwork freelancer\'s public profile data (Upwork frequently blocks direct fetching, so search for the indexed public page; you may also try WebFetch).',
      'Retrieve as much as you can: title/headline, overview/bio text, hourly rate, Job Success Score, Top Rated/Plus badge, number of completed jobs, number of reviews, rating, years active, country reach, listed services/specializations, skill tags, and any portfolio/links.',
      'If, after genuinely trying, you cannot retrieve enough real data, set profileFound=false and explain in summary (do NOT invent profile content).'
    );
  }
  if (text) {
    lines.push(
      url ? 'The user ALSO pasted profile content below — treat this as the authoritative source (more reliable than fetching):' : 'The user pasted the profile content below — analyze it directly:',
      '"""',
      text,
      '"""'
    );
  }
  if (!url && !text) {
    lines.push('(No profile provided.)');
  }
  return lines.join('\n');
}

// Rubrik aktif: pakai file kustom bila ada & tidak kosong, jika tidak pakai bawaan.
async function loadRubric() {
  try {
    const txt = await readFile(RUBRIC_FILE, 'utf8');
    if (txt && txt.trim()) return txt;
  } catch { /* belum ada file kustom */ }
  return DEFAULT_RUBRIC;
}

// Ekstrak objek JSON dari output Claude (buang code fence / teks pembungkus bila ada).
function extractJSON(raw) {
  if (!raw) throw new Error('Output kosong dari Claude.');
  let s = raw.trim();
  // Buang ```json ... ``` atau ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Jalur cepat: kalau memang JSON murni, langsung parse.
  try { return JSON.parse(s); } catch { /* lanjut ke pemindai */ }
  // Pemindai kedalaman kurawal: ambil objek seimbang PERTAMA dari '{',
  // hormati string (abaikan kurawal di dalam string) → tahan terhadap
  // narasi pembungkus atau kurawal nyasar di dalam nilai string.
  const start = s.indexOf('{');
  if (start === -1) throw new Error('Claude tidak mengembalikan JSON yang valid.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('Claude tidak mengembalikan JSON yang valid.');
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Hentikan proses anak beserta turunannya. Di Windows (shell:true) `claude`
// asli adalah cucu dari cmd.exe; child.kill() saja meninggalkannya yatim &
// tetap memakai kuota — pakai taskkill /T untuk membunuh seluruh pohon.
function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else { child.kill(); }
  } catch { try { child.kill(); } catch {} }
}

// Tulis prompt ke stdin anak dengan aman (broken pipe / EPIPE tidak meng-crash bridge).
function feedStdin(child, payload) {
  child.stdin.on('error', () => {});
  try { child.stdin.write(payload); child.stdin.end(); } catch {}
}

// Bangun argumen claude (dipakai mode biasa & streaming).
function claudeArgs(model, stream) {
  const a = ['--print', '--model', MODELS.has(model) ? model : 'sonnet', '--allowedTools', 'WebSearch,WebFetch'];
  if (stream) a.splice(1, 0, '--output-format', 'stream-json', '--verbose');
  return a;
}

function runClaude(userPrompt, model, rubric) {
  return new Promise((resolve, reject) => {
    const payload = [FIXED_PREAMBLE, rubric || DEFAULT_RUBRIC, OUTPUT_SHAPE, userPrompt].join('\n\n');
    const args = claudeArgs(model, false);
    const child = spawn('claude', args, {
      cwd: os.tmpdir(),                 // netral: hindari CLAUDE.md proyek ikut terbaca
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let out = '', err = '';
    const killer = setTimeout(() => { killTree(child); reject(new Error('Timeout 300s, Claude tidak merespon (analisa profil + web bisa memakan waktu).')); }, 300000);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => {
      clearTimeout(killer);
      reject(e.code === 'ENOENT'
        ? new Error('Perintah `claude` tidak ditemukan. Pastikan Claude Code terpasang & ada di PATH.')
        : e);
    });
    child.on('close', code => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error(err.trim() || ('claude keluar dengan kode ' + code)));
      if (!out.trim()) return reject(new Error(err.trim() || 'Claude tidak mengembalikan output. Pastikan sudah login (jalankan `claude` sekali), lalu coba lagi.'));
      try { resolve(extractJSON(out)); }
      catch (e) { reject(new Error(e.message + ' (output mentah: ' + out.slice(0, 200).replace(/\s+/g, ' ') + '…)')); }
    });
    feedStdin(child, payload);
  });
}

/* ============================================================
   AUTO-FETCH PROFIL via cf-fetch.mjs (browser tersembunyi).
   Saat user menempel LINK, Upwork diblok Cloudflare untuk fetch biasa.
   cf-fetch.mjs meluncurkan Chrome ASLI (profil terakhir dibuka) dengan
   jendela disembunyikan off-screen → lolos Cloudflare → cetak teks profil.
   Opsional: butuh `npm install` (Playwright). Gagal = fallback diam.
   ============================================================ */
const CF_FETCH = path.join(DIR, 'cf-fetch.mjs');
const CF_ENABLED = process.env.ANALYZER_CF_FETCH !== '0';

function mapFetchStep(line) {
  const m = line.replace(/^\[cf-fetch\]\s*/, '').trim();
  if (/^goto/i.test(m)) return 'Membuka profil & melewati Cloudflare (browser tersembunyi)…';
  if (/profil terakhir/i.test(m)) return 'Menyiapkan sesi browser…';
  if (/^ok,/i.test(m)) return 'Profil terbaca, mulai menilai…';
  if (/diblok|terlalu pendek|error|belum ada/i.test(m)) return 'Auto-fetch: ' + m;
  return null;
}

function fetchProfileHidden(url, step) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CF_FETCH, url], { cwd: DIR, windowsHide: true });
    let out = '', errbuf = '';
    const killer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('Auto-fetch timeout (180s).')); }, 180000);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => {
      errbuf += d.toString();
      const lines = errbuf.split('\n'); errbuf = lines.pop();
      for (const ln of lines) { const msg = mapFetchStep(ln); if (msg && step) step(msg); }
    });
    child.on('error', e => { clearTimeout(killer); reject(e.code === 'ENOENT' ? new Error('Node tidak ditemukan untuk cf-fetch.') : e); });
    child.on('close', code => {
      clearTimeout(killer);
      if (code === 0 && out.trim().length > 300) resolve(out);
      else reject(new Error('cf-fetch keluar dengan kode ' + code + (code === 3 ? ' (Playwright/Chrome belum disiapkan — jalankan `npm install`).' : '')));
    });
  });
}

// Lengkapi body.profileText dari URL via browser tersembunyi bila perlu.
// Gagal = lanjut diam-diam (Claude coba WebSearch / kembalikan profileFound:false).
async function resolveProfile(body, step) {
  if (body.profileText && body.profileText.trim()) return;        // user sudah tempel teks
  if (!(body.url && body.url.trim()) || !CF_ENABLED) return;      // tak ada url / fitur dimatikan
  try {
    step && step('Mengambil profil dari Upwork (browser tersembunyi)…');
    const text = await fetchProfileHidden(body.url.trim(), step);
    body.profileText = 'Halaman profil Upwork (hasil render; ada navigasi situs juga, fokus ke konten profil freelancer):\n\n' + text;
    body.url = ''; // perlakukan sebagai paste agar prompt bersih
    body._autofetched = true;
  } catch (e) {
    step && step('Auto-fetch gagal: ' + e.message + ' Coba tempel teks profil.');
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Token',
  'Access-Control-Max-Age': '86400',
};

const server = http.createServer(async (req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, ...CORS });
    res.end(body);
  };
  const tokenOk = () => String(req.headers['x-pair-token'] || '').toUpperCase() === PAIR_TOKEN;
  const denied = () => send(401, 'application/json', JSON.stringify({
    error: 'Belum terhubung / kode pairing salah. Jalankan start-analyzer.bat, salin kodenya, lalu klik "Hubungkan Claude lokal" di website.'
  }));

  // Preflight CORS dari browser
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  // Halaman dilayani lokal oleh bridge → suntik token & flag supaya tak perlu pairing manual
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) {
    try {
      let html = await readFile(HTML, 'utf8');
      const inject = `<script>window.__BRIDGE_TOKEN__=${JSON.stringify(PAIR_TOKEN)};window.__BRIDGE_LOCAL__=true;</script>`;
      html = html.includes('</head>') ? html.replace('</head>', inject + '\n</head>') : inject + html;
      send(200, 'text/html; charset=utf-8', html);
    } catch {
      send(200, 'text/html; charset=utf-8',
        '<!doctype html><meta charset="utf-8"><title>Bridge aktif</title>' +
        '<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:56px auto;padding:0 22px;color:#0f1419;line-height:1.6">' +
        '<h2 style="color:#14a800;margin-bottom:6px">● Bridge Claude aktif</h2>' +
        '<p style="margin-top:0;color:#5e6b73">Halaman ini tidak perlu dibuka.</p>' +
        '<p>Buka <b>website analyzer</b>-mu, lalu tempel kode pairing ini:</p>' +
        '<p style="font-size:30px;font-weight:800;letter-spacing:3px;background:#f0f7ee;border:1px solid #d6ecd0;border-radius:10px;padding:16px;text-align:center;margin:14px 0">' + PAIR_TOKEN + '</p>' +
        '<p style="color:#5e6b73;font-size:13px">Biarkan jendela terminal tetap terbuka selama memakai mode AI.</p></body>');
    }
    return;
  }

  // Bridge hidup? (tanpa token)
  if (req.method === 'GET' && req.url === '/health') {
    send(200, 'application/json', JSON.stringify({ ok: true, service: 'upwork-analyzer' }));
    return;
  }

  // Cek kode pairing benar
  if (req.method === 'GET' && req.url === '/ping-auth') {
    return tokenOk() ? send(200, 'application/json', JSON.stringify({ ok: true })) : denied();
  }

  // Baca rubrik aktif (untuk editor di website)
  if (req.method === 'GET' && req.url === '/rubric') {
    if (!tokenOk()) return denied();
    let isCustom = false, rubric = DEFAULT_RUBRIC;
    try { const t = await readFile(RUBRIC_FILE, 'utf8'); if (t && t.trim()) { rubric = t; isCustom = true; } } catch {}
    send(200, 'application/json', JSON.stringify({ rubric, isCustom, default: DEFAULT_RUBRIC }));
    return;
  }

  // Simpan / reset rubrik. Body { rubric: "..." }; kosong = reset ke bawaan.
  if (req.method === 'POST' && req.url === '/rubric') {
    if (!tokenOk()) return denied();
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); }
      catch { return send(400, 'application/json', JSON.stringify({ error: 'Body bukan JSON valid.' })); }
      try {
        if (!body.rubric || !body.rubric.trim()) {
          try { await unlink(RUBRIC_FILE); } catch {}
          console.log('[rubric] reset ke bawaan');
          return send(200, 'application/json', JSON.stringify({ ok: true, reset: true }));
        }
        await writeFile(RUBRIC_FILE, body.rubric, 'utf8');
        console.log(`[rubric] tersimpan (${body.rubric.length} karakter)`);
        send(200, 'application/json', JSON.stringify({ ok: true }));
      } catch (e) {
        send(500, 'application/json', JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    if (!tokenOk()) return denied();
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); }
      catch { return send(400, 'application/json', JSON.stringify({ error: 'Body bukan JSON valid.' })); }
      if (!(body.url && body.url.trim()) && !(body.profileText && body.profileText.trim())) {
        return send(400, 'application/json', JSON.stringify({ error: 'Isi link profil Upwork, atau tempel teks profilnya.' }));
      }
      const t0 = Date.now();
      try {
        await resolveProfile(body); // auto-fetch profil dari URL via browser tersembunyi bila perlu
        const rubric = (body.rubric && body.rubric.trim()) ? body.rubric : await loadRubric();
        const result = await runClaude(buildUserPrompt(body), body.model, rubric);
        console.log(`[analyze] ok in ${((Date.now() - t0) / 1000).toFixed(1)}s · model=${body.model || 'sonnet'} · score=${result && result.score}`);
        send(200, 'application/json', JSON.stringify({ result }));
      } catch (e) {
        console.error('[analyze] error:', e.message);
        send(500, 'application/json', JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Versi STREAMING: meneruskan progres Claude (web search, dll) ke browser via SSE.
  if (req.method === 'POST' && req.url === '/analyze-stream') {
    if (!tokenOk()) return denied();
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); }
      catch { return send(400, 'application/json', JSON.stringify({ error: 'Body bukan JSON valid.' })); }
      if (!(body.url && body.url.trim()) && !(body.profileText && body.profileText.trim())) {
        return send(400, 'application/json', JSON.stringify({ error: 'Isi link profil Upwork, atau tempel teks profilnya.' }));
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...CORS,
      });
      const sse = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
      sse('progress', { phase: 'start', detail: 'Menyiapkan analisa…', tokens: 0 });

      let done = false, child = null, killer = null;
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
      const finish = () => { if (killer) clearTimeout(killer); clearInterval(ping); };
      req.on('close', () => { if (!done) { done = true; finish(); if (child) killTree(child); } });

      // Auto-fetch profil dari URL via browser tersembunyi (cf-fetch) bila belum ada teks.
      await resolveProfile(body, msg => sse('progress', { phase: 'fetch', detail: msg, tokens: 0 }));
      if (done) return; // klien menutup koneksi saat fetch

      const rubric = (body.rubric && body.rubric.trim()) ? body.rubric : await loadRubric();
      const payload = [FIXED_PREAMBLE, rubric, OUTPUT_SHAPE, buildUserPrompt(body)].join('\n\n');
      child = spawn('claude', claudeArgs(body.model, true), {
        cwd: os.tmpdir(), shell: process.platform === 'win32', windowsHide: true,
      });

      const t0 = Date.now();
      let buf = '', err = '', finalText = null, tokens = 0;
      killer = setTimeout(() => {
        if (done) return; done = true; killTree(child);
        sse('error', { error: 'Timeout 300s, Claude tidak merespon.' }); res.end();
      }, 300000);

      child.stdout.on('data', d => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'assistant' && ev.message) {
            const u = ev.message.usage; if (u && u.output_tokens) tokens += u.output_tokens;
            for (const b of (ev.message.content || [])) {
              if (b.type === 'tool_use') {
                if (b.name === 'WebSearch') sse('progress', { phase: 'search', detail: 'Menelusuri web: ' + truncate((b.input && b.input.query) || '', 64), tokens });
                else if (b.name === 'WebFetch') sse('progress', { phase: 'fetch', detail: 'Membuka: ' + truncate((b.input && b.input.url) || '', 64), tokens });
                else sse('progress', { phase: 'tool', detail: 'Memakai ' + b.name, tokens });
              } else if (b.type === 'text' && b.text && b.text.trim()) {
                sse('progress', { phase: 'writing', detail: 'Menyusun penilaian & rewrite…', tokens });
              }
            }
          } else if (ev.type === 'user' && ev.message) {
            sse('progress', { phase: 'read', detail: 'Membaca hasil pencarian…', tokens });
          } else if (ev.type === 'result') {
            if (ev.subtype === 'success' && !ev.is_error) { finalText = ev.result; if (ev.usage && ev.usage.output_tokens) tokens = ev.usage.output_tokens; }
            else err = err || ('Claude error: ' + (ev.subtype || 'unknown'));
          }
        }
      });
      child.stderr.on('data', d => (err += d.toString()));
      child.on('error', e => {
        if (done) return; done = true; finish();
        sse('error', { error: e.code === 'ENOENT' ? 'Perintah `claude` tidak ditemukan. Pastikan Claude Code terpasang & ada di PATH.' : e.message });
        res.end();
      });
      child.on('close', code => {
        if (done) return; done = true; finish();
        if (finalText) {
          try {
            const result = extractJSON(finalText);
            console.log(`[analyze-stream] ok in ${((Date.now() - t0) / 1000).toFixed(1)}s · model=${body.model || 'sonnet'} · score=${result && result.score}`);
            sse('done', { result });
          } catch (e) { sse('error', { error: e.message }); }
        } else {
          sse('error', { error: err.trim() || ('claude keluar dengan kode ' + code) });
        }
        res.end();
      });
      feedStdin(child, payload);
    });
    return;
  }

  send(404, 'text/plain', 'Not found');
});

server.listen(PORT, () => {
  console.log('════════════════════════════════════════════════');
  console.log('  Upwork Profile Analyzer — AI bridge aktif');
  console.log('  Pakai login Claude Code (tanpa API key).');
  console.log('');
  console.log('  KODE PAIRING:   ' + PAIR_TOKEN);
  console.log('');
  console.log('  Pakai LOKAL  :  buka  http://localhost:' + PORT);
  console.log('                  (kode pairing terisi otomatis)');
  console.log('  Pakai WEBSITE:  buka website-mu, klik "Hubungkan');
  console.log('                  Claude lokal", tempel kode di atas.');
  console.log('  Stop server  :  Ctrl + C');
  console.log('════════════════════════════════════════════════');
});
