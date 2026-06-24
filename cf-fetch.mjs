/**
 * cf-fetch.mjs — ambil teks halaman Upwork (dilindungi Cloudflare) TANPA jendela terlihat.
 *
 * Dipakai oleh analyzer-server.mjs saat user menempel LINK profil. Logika diadaptasi
 * dari project "Cloudflare Captha Solver" (cf_solver.js), dengan perubahan:
 *  - TIDAK attach via CDP. Kita launch Chrome ASLI sendiri (channel 'chrome'),
 *    HEADFUL tapi jendelanya DISEMBUNYIKAN (digeser jauh ke luar layar) = "hidden mode".
 *  - WAJIB pakai Chrome profile yang TERAKHIR DIBUKA (profile.last_used dari
 *    "Local State") supaya login + cookie cf_clearance ikut → lolos Cloudflare.
 *  - Output: HANYA teks profil ke stdout; semua log ke stderr; exit 0 = sukses.
 *  - Cross-platform: deteksi OS (Windows / macOS / Linux) untuk lokasi profil
 *    Chrome + cara penyalinan (robocopy di Windows, fs.cpSync di macOS/Linux).
 *
 * Prasyarat: `npm install` di folder ini (playwright-core) + Google Chrome terpasang.
 * Pakai:     node cf-fetch.mjs <url>
 */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[cf-fetch]', ...a);     // log -> stderr (bukan stdout)
const CF_RE = /just a moment|attention required|verifying|checking your browser|^challenge/i;

// Lokasi profil Google Chrome per OS (deteksi otomatis). SRC = root "User Data"
// (berisi "Local State" + folder profil); DBG = salinan kerja (tidak mengunci profil asli).
function chromeDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const root = path.join(la, 'Google', 'Chrome');
    return { src: path.join(root, 'User Data'), dbg: path.join(root, 'Debug Profile') };
  }
  if (process.platform === 'darwin') { // macOS
    const root = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    return { src: root, dbg: root + ' Debug Profile' };
  }
  const root = path.join(home, '.config', 'google-chrome'); // Linux
  return { src: root, dbg: root + '-debug' };
}
const { src: SRC, dbg: DBG } = chromeDirs();

function lastUsedProfile() {
  try {
    const ls = JSON.parse(readFileSync(path.join(SRC, 'Local State'), 'utf8'));
    return (ls && ls.profile && ls.profile.last_used) || 'Default';
  } catch { return 'Default'; }
}

// Salin profil TERAKHIR DIBUKA -> Debug Profile (incremental; file terkunci dilewati
// robocopy bila Chrome sedang berjalan, salinan lama tetap dipakai).
// Folder cache besar / file kunci yang TIDAK perlu disalin (cookie & login tetap ikut).
const SKIP_RE = /^(Cache|Code Cache|GPUCache|GrShaderCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Service Worker|Application Cache|component_crx_cache|extensions_crx_cache|Singleton.*|.*\.lock|lockfile|.*Socket.*)$/i;

function refreshProfileCopy() {
  const prof = lastUsedProfile();
  log('profil terakhir dibuka:', prof, '| os:', process.platform);
  const srcProf = path.join(SRC, prof);
  const dstProf = path.join(DBG, 'Default');
  mkdirSync(dstProf, { recursive: true });
  try { copyFileSync(path.join(SRC, 'Local State'), path.join(DBG, 'Local State')); } catch {}
  if (process.platform === 'win32') {
    // robocopy menangani file terkunci (Chrome berjalan) dengan baik; /XD lewati cache besar.
    const r = spawnSync('robocopy', [
      srcProf, dstProf, '/E', '/R:0', '/W:0', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/XJ',
      '/XD', 'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'DawnCache', 'Service Worker',
    ], { windowsHide: true });
    log('robocopy status', r.status, '(<8 = ok)');
  } else {
    // macOS / Linux: salin rekursif, lewati cache besar + file kunci/soket.
    try {
      cpSync(srcProf, dstProf, {
        recursive: true, force: true, errorOnExist: false,
        filter: s => !SKIP_RE.test(path.basename(s)),
      });
      log('salin profil (cpSync) selesai');
    } catch (e) { log('salin sebagian gagal (pakai salinan lama bila ada):', e.message); }
  }
}

// Lolos atau belum? (logika cf_solver: cek token widget, lalu interstitial)
async function looksPassed(page) {
  // Mode WIDGET (Turnstile tertanam, mis. halaman demo): lolos jika token terisi.
  const hasWidget = (await page.locator('input[name="cf-turnstile-response"]').count().catch(() => 0)) > 0;
  if (hasWidget) {
    try { const val = await page.$eval('input[name="cf-turnstile-response"]', el => el.value); return Boolean(val); }
    catch { return false; }
  }
  // Mode INTERSTITIAL ("Just a moment"): lolos jika sudah hilang & tak ada iframe challenge.
  const title = ((await page.title().catch(() => '')) || '').toLowerCase();
  const stillInterstitial = /just a moment|moment|verifying|attention required|checking your browser/.test(title);
  const hasChallengeFrame = page.frames().some(f => (f.url() || '').includes('challenges.cloudflare.com'));
  return !stillInterstitial && !hasChallengeFrame;
}

async function clickTurnstile(page) {
  for (const frame of page.frames()) {
    if (!(frame.url() || '').includes('challenges.cloudflare.com')) continue;
    try {
      const el = await frame.frameElement();
      const box = await el.boundingBox();
      if (box && box.width > 0) {
        const x = box.x + 30, y = box.y + box.height / 2;
        await page.mouse.move(x, y, { steps: 5 });
        await page.mouse.click(x, y);
        return true;
      }
    } catch {}
  }
  return false;
}

async function main() {
  const url = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!url) { log('usage: node cf-fetch.mjs <url>'); process.exit(1); }

  try { refreshProfileCopy(); } catch (e) { log('copy dilewati:', e.message); }
  if (!existsSync(DBG)) { log('Debug Profile belum ada. Tutup Chrome lalu jalankan analisa sekali untuk membuat salinan.'); process.exit(3); }

  const ctx = await chromium.launchPersistentContext(DBG, {
    channel: 'chrome',
    headless: false,                                   // browser ASLI (lolos Cloudflare)
    args: [
      '--window-position=-2400,-2400',                 // jendela disembunyikan (off-screen)
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check',
    ],
    viewport: null,
  });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    log('goto', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log('goto:', e.message));

    // Beri jeda agar challenge (jika ADA) sempat muncul dulu — supaya KASUS 2
    // (harus solve) tidak salah dianggap "lolos" hanya karena dicek terlalu cepat.
    // KASUS 1 (sudah ter-solve / langsung masuk) tetap cepat: setelah jeda ini,
    // tidak ada widget/interstitial → looksPassed() langsung true di iterasi pertama.
    await sleep(1500);

    const deadline = Date.now() + 75000;
    let passed = false;
    let sawChallenge = false;
    while (Date.now() < deadline) {
      const hasWidget = (await page.locator('input[name="cf-turnstile-response"]').count().catch(() => 0)) > 0;
      const hasFrame = page.frames().some(f => (f.url() || '').includes('challenges.cloudflare.com'));
      const t = ((await page.title().catch(() => '')) || '').toLowerCase();
      if (hasWidget || hasFrame || /just a moment|verifying|attention required|checking your browser/.test(t)) sawChallenge = true;
      if (await looksPassed(page)) { passed = true; break; }
      await clickTurnstile(page).catch(() => {});
      await sleep(2500);
    }
    log(sawChallenge ? 'kasus 2 (solve challenge), lolos:' : 'kasus 1 (langsung masuk), lolos:', passed);
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await sleep(1200);

    const title = await page.title().catch(() => '');
    if (!passed) { log('gagal lolos Cloudflare. title:', title); process.exit(4); }
    const text = (await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')) || '';
    if (text.trim().length < 400) { log('konten terlalu pendek (len ' + text.length + ')'); process.exit(5); }
    process.stdout.write(text);                         // <-- HANYA teks profil ke stdout
    log('ok, len', text.length, '| title:', title.slice(0, 60));
    process.exit(0);
  } finally {
    await ctx.close().catch(() => {});
  }
}

main().catch(e => { log('error', e.message); process.exit(2); });
