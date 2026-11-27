/* Cosmos engine — shared by the Cosmos page, Notes and Calculator.
   - Bluetooth to the Electricks Cosmos (LuckPrinter protocol, see cosmos/cosmos-printer.md), in Aura Browser or Chrome.
   - Handwriting renderer: text block + {prediction}, paper length (Auto / Fixed mm), text position, 1-bit output.
   - Templates: one list in localStorage ("fvtCosmosTpl") for all pages on this site.
     All templates show on every page (Cosmos, Notes, Calculator). scope = the page where it was made (only for the label).
   - Prediction sources: "inject" is built in; pages add their own with Cosmos.addSource(id, name, fn).
   Events (Cosmos.on): status(text, kind), change(), toast(text), log(text), busy(on), printed(ok). */
(function(){
'use strict';
const C = {};
const ev = {};
C.on = (n, f) => { (ev[n] = ev[n] || []).push(f); return () => { ev[n] = ev[n].filter(x => x !== f); }; };
const emit = (n, ...a) => (ev[n] || []).forEach(f => { try { f(...a); } catch(e){} });
const log = t => emit('log', t);
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2,'0')).join(' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Fonts: everyday handwriting only ---------- */
/* Fonts that print black on the Cosmos (no gray on wide lines): medium or thin strokes, not too wide.
   Kalam, Patrick Hand and Caveat printed black in the font test at pen 0. Handlee and Nanum Pen Script
   have the same stroke weight or thinner (Nanum is narrow, so fewer dots in each row). Use pen 0. */
C.FONTS = [['Kalam','Neat pen'],['Patrick Hand','Print letters'],['Caveat','Quick pen'],['Handlee','Neat handwriting'],['Nanum Pen Script','Narrow ballpoint']];
C.loadFonts = () => {
  if (document.getElementById('cosmosFonts')) return;
  const l = document.createElement('link'); l.id = 'cosmosFonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Kalam:wght@300;400;700&family=Patrick+Hand&family=Caveat:wght@400;700&family=Handlee&family=Nanum+Pen+Script&display=swap';
  document.head.appendChild(l);
  C.myFonts.load();
};

/* ---------- My fonts: your own handwriting fonts (.ttf / .otf / .woff) ----------
   Kept for good on this phone and shared by every page on this site (Cosmos, Notes, Calculator).
   Names list in localStorage ("fvtCosmosMyFonts"), font files in IndexedDB ("fvtCosmosFonts").
   The names go into C.FONTS at once, so templates that use them stay valid; the files load in the background. */
const MFK = 'fvtCosmosMyFonts';
const idb = (mode, fn) => new Promise((res, rej) => {
  let rq; try { rq = indexedDB.open('fvtCosmosFonts', 1); } catch(e){ rej(e); return; }
  rq.onupgradeneeded = () => rq.result.createObjectStore('f');
  rq.onerror = () => rej(rq.error);
  rq.onsuccess = () => { const db = rq.result, tx = db.transaction('f', mode), st = tx.objectStore('f'); let out;
    const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => { db.close(); res(out); }; tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); }; };
});
const mfList = () => { try { return JSON.parse(localStorage.getItem(MFK) || '[]'); } catch(e){ return []; } };
const mfSave = a => { try { localStorage.setItem(MFK, JSON.stringify(a)); } catch(e){} };
const mfLoaded = {};
function mfSync(){ /* keep C.FONTS = built-in fonts + my fonts (in my order) */
  for (let i = C.FONTS.length - 1; i >= 0; i--) if (C.FONTS[i][2]) C.FONTS.splice(i, 1);
  mfList().forEach(f => C.FONTS.push([f.fam, f.name, 1]));
}
async function mfRegister(fam, buf){
  if (mfLoaded[fam]) return;
  const ff = new FontFace(fam, buf); await ff.load(); document.fonts.add(ff); mfLoaded[fam] = 1;
}
C.myFonts = {
  list: () => mfList(),
  isMine: fam => mfList().some(f => f.fam === fam),
  /* add a font file (File or Blob). Returns { fam, name }. Throws if the file is not a font. */
  async add(file, name){
    const buf = await file.arrayBuffer();
    const fam = 'FVT Hand ' + Date.now().toString(36);
    await mfRegister(fam, buf.slice(0));           /* check first: a bad file stops here */
    await idb('readwrite', st => st.put(buf, fam));
    const o = { fam, name: (name || file.name || 'My font').replace(/\.(ttf|otf|woff2?)$/i, '').trim().slice(0, 30) || 'My font' };
    const a = mfList(); a.push(o); mfSave(a); mfSync(); emit('fonts'); log('my font added: ' + o.name);
    return o;
  },
  rename(fam, name){ const a = mfList(), o = a.find(f => f.fam === fam); if (!o) return; o.name = String(name).trim().slice(0, 30) || o.name; mfSave(a); mfSync(); emit('fonts'); },
  async remove(fam){
    mfSave(mfList().filter(f => f.fam !== fam)); mfSync();
    try { await idb('readwrite', st => st.delete(fam)); } catch(e){}
    emit('fonts');
  },
  ready: null,
};
C.myFonts.load = () => C.myFonts.ready || (C.myFonts.ready = (async () => {
  mfSync();
  for (const f of mfList()) {
    try { const buf = await idb('readonly', st => st.get(f.fam)); if (buf) await mfRegister(f.fam, buf); else log('my font missing: ' + f.name); }
    catch(e){ log('my font: ' + f.name + ': ' + e.message); }
  }
  emit('fonts');
})());
mfSync();
addEventListener('storage', e => { if (e.key === MFK) { mfSync(); C.myFonts.ready = null; C.myFonts.load(); } });

/* ---------- Template defaults ---------- */
C.W = 384;                      // design grid: 384 units per line, 8 units/mm (48 mm print area). Templates and the live view use it.
C.PAPER_MM = 59;                // paper width
/* Printer resolution. A test print (17 Nov 2026) came out at about 2/3 size and off to one side with the
   203 dpi setting, so the Cosmos seems to be 300 dpi (12 dots/mm, 576 dots per line). Print jobs are
   rendered again at the printer resolution (k = dots per mm / 8); the live view stays on the 8/mm grid. */
C.PROFILES = { '203': { dpm: 8, w: 384, name: '203 dpi (384 dots)' }, '300': { dpm: 12, w: 576, name: '300 dpi (576 dots)' } };
C.dpi = () => { try { const v = localStorage.getItem('fvtCosmosDpi'); return C.PROFILES[v] ? v : '300'; } catch(e){ return '300'; } };
C.setDpi = v => { if (!C.PROFILES[v]) return; try { localStorage.setItem('fvtCosmosDpi', v); } catch(e){} emit('change'); };
C.prof = () => C.PROFILES[C.dpi()];
/* Feed "Auto" is for a loaded slip (a torn piece of paper put in the printer): after the print it feeds
   the rest of the slip (paper length − printed length) plus this extra (mm), so the slip comes out. */
C.edge = () => { try { const v = +localStorage.getItem('fvtCosmosEdge'); return v >= 2 && v <= 60 ? v : 15; } catch(e){ return 15; } };
C.setEdge = v => { try { localStorage.setItem('fvtCosmosEdge', String(+v)); } catch(e){} emit('change'); };
C.DEFAULT = {
  text: 'You will think of\nthe {prediction}', font: 'Kalam', size: 52, ink: 0, mess: 4, lh: 1.1,
  align: 'center', bold: false, slant: false, seed: 1,
  mode: 'fixed', len: 61, px: 0.5, py: 0.5, yAuto: 24,
  dens: 2, feed: -1, flip: false, mirror: false,      // feed -1 = Auto (push the loaded slip out)
  source: 'inject', caseT: 'asis', fallback: '', sample: 'Cosmos System',
};
C.tpl = o => { const t = Object.assign({}, C.DEFAULT, o || {});
  if (!C.FONTS.some(f => f[0] === t.font)) { t.font = 'Kalam'; t.ink = 0; }   /* a removed font: use Kalam, pen 0 */
  return t; };

/* ---------- Renderer ---------- */
function rng(seed){ let s = seed >>> 0 || 1; return () => (s = (s*1664525 + 1013904223) >>> 0) / 4294967296; }
function wrapLines(ctx, text, maxW){
  const out = [];
  String(text).replace(/\r/g,'').split('\n').forEach(par => {
    if (par === '') { out.push(''); return; }
    let line = '';
    par.split(/(\s+)/).forEach(tok => {
      const test = line + tok;
      if (ctx.measureText(test.trimEnd()).width > maxW && line.trim() !== '') { out.push(line.trimEnd()); line = tok.trimStart(); }
      else line = test;
    });
    out.push(line.trimEnd());
  });
  return out;
}
C.applyCase = (w, c) => { w = String(w ?? ''); if (c === 'upper') return w.toUpperCase(); if (c === 'lower') return w.toLowerCase();
  if (c === 'title') return w.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()); return w; };
/* more placeholders: a page adds one with Cosmos.addTag('notes', 'Notes', () => text). In the template it is {notes}.
   The value is read at print time. In the live view an empty value shows the placeholder. */
C.tags = {};
const PAGE_TAGS = ['notes'];   /* placeholders of other pages: on a page without them they print nothing */
C.addTag = (id, name, fn) => { C.tags[id] = { name, get: fn }; };
let printing = false;
C.fill = (t, word) => {
  let s = String(t.text || '').split('{prediction}').join(C.applyCase(word, t.caseT));
  for (const [id, g] of Object.entries(C.tags)) {
    if (!s.includes('{' + id + '}')) continue;
    let v = ''; try { v = String(g.get() ?? '').trim(); } catch(e){}
    s = s.split('{' + id + '}').join(v || (printing ? '' : '{' + id + '}'));
  }
  /* placeholders of other pages (here {notes} on the Cosmos page): the live view shows a sample */
  if (!printing) for (const id of PAGE_TAGS) if (!C.tags[id]) s = s.split('{' + id + '}').join(id === 'notes' ? 'Your note' : id);
  if (printing) for (const id of PAGE_TAGS) if (!C.tags[id]) s = s.split('{' + id + '}').join('');
  return s;
};

/* render(t, word, k) -> { rows: Uint8Array(H*bpr), h, bpr, w, box:{x,y,w,h}, over, mm }
   k = 1: design grid (live view). k = C.prof().dpm / 8: printer dots. */
C.render = (t0, word, k = 1) => {
  const t = C.tpl(t0), W = Math.round(C.W * k), BPR = W >> 3, size = +t.size * k, ink = +t.ink * k, jit = (+t.mess)/10, lh = +t.lh, PAD = 6 * k;
  const fam = t.font, weight = t.bold ? '700' : '400';
  const fontStr = (sz) => `${t.slant ? 'italic ' : ''}${weight} ${sz.toFixed(1)}px "${fam}", "Kalam", cursive`;
  const m = document.createElement('canvas').getContext('2d'); m.font = fontStr(size);
  const lines = wrapLines(m, C.fill(t, word ?? t.sample), W - PAD*2 - ink*2);
  const R = rng(t.seed), lineH = Math.round(size * lh), top = Math.round(size * 0.25), bot = Math.round(size * 0.35);
  const L = lines.map(ln => {
    const ch = [...ln], sz = ch.map(() => 1 + (R()-0.5) * 0.10 * jit);
    let total = 0;
    const adv = ch.map((c, k) => { m.font = fontStr(size*sz[k]); const w = m.measureText(c).width; total += w; return w; });
    const tilt = (R()-0.5) * 0.04 * jit;
    const fx = ch.map(() => ({ y: (R()-0.5) * size * 0.08 * jit, r: (R()-0.5) * 0.12 * jit, x: (R()-0.5) * size * 0.03 * jit }));
    return { ch, sz, adv, total, tilt, fx };
  });
  const bw = Math.min(W, Math.ceil(Math.max(8, ...L.map(l => l.total)) + ink*2 + size*0.18 + 4));
  const bh = Math.max(8, top + lineH * L.length + bot);
  let H, x = Math.round((+t.px) * (W - bw)), y;
  if (t.mode === 'fixed') { H = Math.max(16, Math.round(+t.len * 8 * k)); y = Math.round((+t.py) * Math.max(0, H - bh)); }
  else { y = Math.max(0, Math.round(+t.yAuto * k)); H = y + bh + Math.round(16 * k); }
  x = Math.max(0, Math.min(W - bw, x));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.lineCap = 'round'; g.textBaseline = 'alphabetic';
  L.forEach((l, i) => {
    let cx = x + ink + 2 + (t.align === 'left' ? 0 : t.align === 'right' ? (bw - ink*2 - 4 - l.total) : (bw - ink*2 - 4 - l.total) / 2);
    const baseY = y + top + lineH * i + size * 0.82, mid = x + bw/2;
    l.ch.forEach((ch, k) => {
      g.save();
      g.translate(cx, baseY + l.fx[k].y + (cx - mid) * l.tilt);
      if (t.slant) g.transform(1, 0, -0.18, 1, 0, 0);
      g.rotate(l.fx[k].r);
      g.font = fontStr(size * l.sz[k]);
      if (ink > 0) { g.lineWidth = ink; g.strokeText(ch, 0, 0); }
      g.fillText(ch, 0, 0);
      g.restore();
      cx += l.adv[k] + l.fx[k].x;
    });
  });
  const src = g.getImageData(0, 0, W, H).data;
  let rows = new Uint8Array(H * BPR);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const sx = t.mirror ? W-1-xx : xx;
    if (src[(yy*W + sx) * 4] < 140) rows[yy*BPR + (xx>>3)] |= 0x80 >> (xx & 7);
  }
  if (t.flip) {
    const r2 = new Uint8Array(rows.length);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++)
      if (rows[yy*BPR+(xx>>3)] & (0x80>>(xx&7))) { const nx = W-1-xx, ny = H-1-yy; r2[ny*BPR+(nx>>3)] |= 0x80>>(nx&7); }
    rows = r2;
  }
  return { rows, h: H, bpr: BPR, w: W, box: { x, y, w: bw, h: bh }, over: t.mode === 'fixed' && bh > H, mm: Math.round(H/(8*k)) };
};
/* draw the 1-bit result on a canvas (ink dots only, transparent paper) */
C.paint = (cv, r) => {
  const W = C.W; cv.width = W; cv.height = r.h;
  const g = cv.getContext('2d'), im = g.createImageData(W, r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < W; x++) {
    if (r.rows[y*48+(x>>3)] & (0x80>>(x&7))) { const p = (y*W+x)*4; im.data[p] = 30; im.data[p+1] = 30; im.data[p+2] = 34; im.data[p+3] = 255; }
  }
  g.putImageData(im, 0, 0);
};
C.fontsReady = async t => { try { await C.myFonts.load(); } catch(e){} try { await document.fonts.load(`${t && t.bold ? 700 : 400} 40px "${(t && t.font) || 'Kalam'}"`); } catch(e){} };

/* ---------- Templates (shared localStorage) ---------- */
const TK = 'fvtCosmosTpl';
/* tap a button two times to confirm (Aura does not show confirm() boxes) */
C.tap2 = (el, txt = 'Tap again to delete') => {
  if (el._t2 && Date.now() - el._t2 < 3000) { clearTimeout(el._t2t); el._t2 = 0; el.textContent = el._t2o; return true; }
  el._t2o = el.textContent; el._t2 = Date.now(); el.textContent = txt;
  el._t2t = setTimeout(() => { el._t2 = 0; el.textContent = el._t2o; }, 3000); return false;
};
C.templates = {
  all(){ try { return JSON.parse(localStorage.getItem(TK) || '[]'); } catch(e){ return []; } },
  saveAll(a){ try { localStorage.setItem(TK, JSON.stringify(a)); } catch(e){} emit('templates'); },
  /* page "cosmos": only Cosmos templates. Other pages: Cosmos templates + the page's own. */
  list(page){ return this.all(); },
  get(id){ return this.all().find(x => x.id === id) || null; },
  add(name, scope, tpl){ const a = this.all(); const o = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2,5), name: String(name || 'Template').slice(0, 40), scope, tpl: C.tpl(tpl), ts: Date.now() }; a.push(o); this.saveAll(a); return o; },
  update(id, patch){ const a = this.all(); const o = a.find(x => x.id === id); if (!o) return null; if (patch.name != null) o.name = String(patch.name).slice(0, 40); if (patch.tpl) o.tpl = C.tpl(patch.tpl); o.ts = Date.now(); this.saveAll(a); return o; },
  remove(id){ this.saveAll(this.all().filter(x => x.id !== id)); },
};
addEventListener('storage', e => { if (e.key === TK) emit('templates'); });

/* ---------- Prediction sources ---------- */
C.sources = {};
C.addSource = (id, name, fn) => { C.sources[id] = { name, get: fn }; };
C.injectId = () => { try { return (localStorage.getItem('fvtInjId') || '13297').replace(/\D/g,'') || '13297'; } catch(e){ return '13297'; } };
C.injectRead = async () => {
  const r = await fetch('https://11z.co/_w/' + C.injectId() + '/selection?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('Inject error ' + r.status);
  const j = await r.json(); return { value: String(j.value ?? '').trim(), count: String(j.count ?? '') + '|' + String(j.value ?? '') };
};
/* opts.waitNew: wait (up to 60 s) for a word that arrives after this call */
C.addSource('inject', 'Inject', async (opts = {}) => {
  if (!opts.waitNew) return (await C.injectRead()).value;
  const base = (await C.injectRead()).count, end = Date.now() + 60000;
  emit('status', 'Waiting for Inject…', 'warn');
  while (Date.now() < end) { await sleep(1000); const r = await C.injectRead(); if (r.count !== base && r.value) return r.value; }
  return '';
});
/* the word for a template: source → case → fallback. Returns null when nothing can print. */
C.prediction = async (t, opts = {}) => {
  t = C.tpl(t);
  if (!t.text.includes('{prediction}')) return '';
  const s = C.sources[t.source] || C.sources.inject;
  let w = '';
  try { w = String((await s.get(opts)) ?? '').trim(); } catch(e) { log('prediction: ' + e.message); emit('toast', s.name + ' failed'); }
  if (!w) w = String(t.fallback || '').trim();
  return w || null;
};

/* ---------- Bluetooth (Aura or Web Bluetooth) ---------- */
const SVC = 'ff00', WR = 'ff02', ST = 'ff01', FC = 'ff03';
const full = s => `0000${s}-0000-1000-8000-00805f9b34fb`;
const short = u => { u = String(u||'').toLowerCase(); const m = u.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/); return m ? m[1] : u.replace(/^0x/,''); };
C.hasAura = () => !!(window.Aura && window.Aura.bluetooth);
C.hasWeb = () => !!navigator.bluetooth;
C.showAll = false;          // Chrome: list all Bluetooth devices

let mode = null, auraId = null, auraSvc = null, auraWr = null, auraHooked = false, webDev = null, webWr = null, doneWaiter = null;
C.connected = false; C.busy = false; C.battery = null;
let battAsk = 0, battWait = null;
function showBatt(p){ C.battery = p; if (battWait) { const w = battWait; battWait = null; w(p); } emit('change'); }
async function askBattery(){
  if (!C.connected || C.busy) return;
  battAsk = Date.now();
  try { await waitCredit(); await write(Uint8Array.of(0x10,0xFF,0x50,0xF1)); } catch(e){ log('battery request failed: ' + e.message); }
}
C.readBattery = () => { if (!C.connected) return Promise.resolve(null); if (C.busy) return Promise.resolve(C.battery);
  const got = new Promise(r => { battWait = r; setTimeout(() => { if (battWait) { battWait = null; r(C.battery); } }, 2500); }); askBattery(); return got; };
function onStatus(u8){
  if (battAsk && Date.now() - battAsk < 3000 && u8.length === 2 && u8[1] <= 100) { battAsk = 0; showBatt(u8[1]); log('battery ' + u8[1] + '%'); return; }
  if (!(u8.length === 1 && u8[0] === 0 && !C.busy)) log('FF01 ← ' + hex(u8));
  if (doneWaiter && (u8.includes(0xAA) || String.fromCharCode(...u8).includes('OK'))) { const w = doneWaiter; doneWaiter = null; w(true); }
}
let credits = null;
function onFlow(u8){
  if (u8[0] === 0x01 && u8.length >= 2) { credits = (credits || 0) + u8[1]; if (!C.busy) log('FF03 ← ' + hex(u8) + ' (credits ' + credits + ')'); }
  else log('FF03 ← ' + hex(u8));
}
async function waitCredit(){
  if (credits === null) { await sleep(25); return; }
  const t0 = performance.now();
  while (credits <= 0) { if (performance.now() - t0 > 3000) { log('no credit after 3 s — sending anyway'); credits = 1; break; } await sleep(5); }
  credits--;
}
function toU8(v){ if (v instanceof Uint8Array) return v; if (v instanceof DataView) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength); if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v); if (typeof v === 'string') { const h = v.replace(/[^0-9a-f]/gi,''); return Uint8Array.from(h.match(/../g)||[], x => parseInt(x,16)); } if (v && v.data) return toU8(v.data); return new Uint8Array(); }
let kaTimer = null, connAt = 0;
function startKeepAlive(){
  stopKeepAlive(); connAt = Date.now(); let tick = 0;
  setTimeout(askBattery, 800);
  kaTimer = setInterval(async () => {
    if (!C.connected || C.busy) return;
    if (++tick % 4 === 0) return askBattery();
    try { await waitCredit(); await write(Uint8Array.of(0x10,0xFF,0x40)); } catch(e){ log('keep-alive failed: ' + e.message); }
  }, 15000);
}
function stopKeepAlive(){ if (kaTimer) clearInterval(kaTimer); kaTimer = null; }
function setConnected(on){
  if (!on && C.connected && connAt) log('connection lasted ' + Math.round((Date.now()-connAt)/1000) + ' s');
  if (on) startKeepAlive(); else { stopKeepAlive(); C.battery = null; }
  C.connected = on;
  emit('status', on ? 'Connected' : 'Not connected', on ? 'ok' : '');
  emit('change');
}
/* Other Bluetooth searches on the page (the PeekSmith search) can stop the Cosmos search in Aura.
   Pages add a function with Cosmos.beforeScan(fn); fn stops their search. While C.scanning is true,
   pages must not start a new search. */
const scanHooks = [];
C.beforeScan = fn => { scanHooks.push(fn); };
C.scanning = false;
C.lastError = '';
const why = m => /permission/i.test(m) ? 'No Bluetooth permission for Aura' : /off/i.test(m) ? 'Bluetooth is off'
  : /cancel/i.test(m) ? 'Cancelled' : /time|not found|no device/i.test(m) ? 'Cosmos not found – wake it up' : 'Could not connect';
C.connect = async (opts = {}) => {
  if (C.connected) return true;
  if (C.scanning) return false;
  credits = null;
  mode = C.hasAura() ? 'aura' : C.hasWeb() ? 'web' : null;
  if (!mode) { emit('status', 'No Bluetooth here', 'bad'); emit('toast', 'Open this page in Aura Browser or Chrome'); return false; }
  emit('status', 'Searching…', 'warn');
  C.scanning = true; emit('scan', true);
  try {
    if (mode === 'aura') {
      for (const f of scanHooks) { try { await Promise.race([f(), sleep(2500)]); } catch(e){} }
      try { await Aura.bluetooth.stopScan(); } catch(e){}
      await sleep(300);
      try { await connectAura(); }
      catch (e) {                                   /* one more try: a different search can stop the first one */
        if (/cancel|permission|off/i.test(e.message)) throw e;
        log('connect failed (' + e.message + '), trying again');
        try { if (auraId) await Aura.bluetooth.disconnect(auraId); } catch(x){}
        try { await Aura.bluetooth.stopScan(); } catch(x){}
        await sleep(900); await connectAura();
      }
    } else await connectWeb();
    C.lastError = '';
    setConnected(true); emit('toast', 'Cosmos connected'); return true;
  } catch (e) {
    C.lastError = why(e.message || '');
    log('connect failed: ' + e.message); emit('status', 'Not connected – ' + C.lastError, opts.quiet ? '' : 'bad');
    emit('change');
    if (!opts.quiet) emit('toast', C.lastError); return false;
  } finally { C.scanning = false; emit('scan', false); }
};
async function connectAura(){
  const A = Aura.bluetooth;
  try { const st = await A.state(); log('Aura bluetooth: ' + st);
    if (st === 'poweredOff') throw new Error('Bluetooth is off');
    if (st === 'unauthorized') throw new Error('Aura has no Bluetooth permission'); } catch(e){ if (/off|permission/.test(e.message)) throw e; }
  if (!auraHooked) {
    auraHooked = true;
    Aura.on('bluetooth.notification', ({ id, characteristic, value }) => {
      if (id !== auraId) return; const c = short(characteristic), u = toU8(value);
      if (c === ST) onStatus(u); else if (c === FC) onFlow(u);
    });
    Aura.on('bluetooth.disconnected', ({ id }) => { if (id === auraId) { log('disconnected'); setConnected(false); } });
  }
  const d = await A.requestDevice({ namePrefix: 'LuckP' });
  auraId = d.id; log('found ' + d.name + (d.rssi ? ' (' + d.rssi + ' dBm)' : ''));
  const info = await A.connect(auraId);
  const svcs = info && info.services || [];
  log('services: ' + svcs.map(s => short(s.uuid)).join(', '));
  const s = svcs.find(s => short(s.uuid) === SVC);
  auraSvc = s ? s.uuid : full(SVC);
  const ch = (s && s.characteristics) || [];
  const pick = id => { const c = ch.find(c => short(c.uuid || c) === id); return c ? (c.uuid || c) : full(id); };
  auraWr = pick(WR);
  try { await A.startNotifications(auraId, auraSvc, pick(ST)); } catch(e){ log('notify FF01: ' + e.message); }
  try { await A.startNotifications(auraId, auraSvc, pick(FC)); } catch(e){ log('notify FF03: ' + e.message); }
}
async function connectWeb(){
  if (!webDev) {
    webDev = await navigator.bluetooth.requestDevice(C.showAll
      ? { acceptAllDevices: true, optionalServices: [full(SVC)] }
      : { filters: [{ namePrefix: 'LuckP' }, { services: [full(SVC)] }], optionalServices: [full(SVC)] });
    webDev.addEventListener('gattserverdisconnected', () => { log('disconnected'); setConnected(false); });
  }
  log('connecting to ' + (webDev.name || 'device'));
  const srv = await webDev.gatt.connect();
  const s = await srv.getPrimaryService(full(SVC));
  webWr = await s.getCharacteristic(full(WR));
  for (const [id, fn] of [[ST, onStatus], [FC, onFlow]]) {
    try { const c = await s.getCharacteristic(full(id)); c.addEventListener('characteristicvaluechanged', e => fn(toU8(e.target.value))); await c.startNotifications(); }
    catch(e){ log('notify ' + id + ': ' + e.message); }
  }
}
C.disconnect = async () => {
  log('disconnect (button)');
  try {
    if (mode === 'aura' && auraId) await Aura.bluetooth.disconnect(auraId);
    if (mode === 'web' && webDev && webDev.gatt.connected) webDev.gatt.disconnect();
  } catch(e){ log('disconnect: ' + e.message); }
  setConnected(false);
};
async function write(u8){
  if (mode === 'aura') await Aura.bluetooth.write(auraId, auraSvc, auraWr, u8);
  else await webWr.writeValue(u8);
}

/* ---------- Printer protocol (LuckPrinter / Lujiang) ---------- */
const CMD = {
  wake:   () => new Uint8Array(12),
  density:n => Uint8Array.of(0x10,0xFF,0x10,0x00,n),
  enable: () => Uint8Array.of(0x10,0xFF,0xF1,0x03),
  stop:   () => Uint8Array.of(0x10,0xFF,0xF1,0x45),
  feed:   n => { const a = []; while (n > 0){ const k = Math.min(255, n); a.push(0x1B,0x4A,k); n -= k; } return Uint8Array.from(a); },
};
/* Slow print (darker): wait after each write, longer when the rows have many black dots, so the print head
   has more time to heat. Level in localStorage "fvtCosmosSlow": 0 normal, 1 slow, 2 slower. Not measured yet. */
const PC = new Uint8Array(256); for (let i = 1; i < 256; i++) PC[i] = PC[i >> 1] + (i & 1);
C.slow = () => { const v = +(localStorage.getItem('fvtCosmosSlow') || 0); return v === 1 || v === 2 ? v : 0; };
C.setSlow = v => { try { localStorage.setItem('fvtCosmosSlow', String(+v || 0)); } catch(e){} };
function paceMs(chunk, lvl){ if (!lvl) return 0; let d = 0; for (let i = 8; i < chunk.length; i++) d += PC[chunk[i]];
  return lvl === 1 ? Math.min(40, d * 0.06) : Math.min(100, d * 0.15); }
const PKT_DATA = 144;       // rows per write: 8 + 144 = 152 bytes, under the 200-byte packet size
function rasterChunks(rows, h, bpr = 48){
  const out = [], per = Math.max(1, Math.floor(PKT_DATA / bpr));
  for (let y = 0; y < h; y += per) {
    const n = Math.min(per, h - y), b = new Uint8Array(8 + n*bpr);
    b.set([0x1D,0x76,0x30,0x00,bpr & 0xFF,bpr >> 8,n & 0xFF,n >> 8]); b.set(rows.subarray(y*bpr, (y+n)*bpr), 8); out.push(b);
  }
  return out;
}
const feedDots = mm8 => Math.round(+mm8 * C.prof().dpm / 8);   // feed values are in 1/8 mm
async function runJob(dens, body){
  if (C.busy) { emit('toast', 'Busy'); return false; }
  if (!C.connected) { emit('toast', 'Connect the Cosmos first'); return false; }
  C.busy = true; emit('busy', true);
  let enabled = false, ok = false;
  try {
    await waitCredit(); await write(CMD.wake());
    await waitCredit(); await write(CMD.density(+dens));
    await waitCredit(); await write(CMD.enable()); enabled = true;
    await body();
  } catch (e) { log('print error: ' + e.message); emit('toast', 'Print error — see Log'); }
  finally {
    if (enabled) {
      const done = new Promise(r => { doneWaiter = r; setTimeout(() => { if (doneWaiter) { doneWaiter = null; r(false); } }, 10000); });
      try { await waitCredit(); await write(CMD.stop()); } catch(e){ log('stop failed: ' + e.message); }
      ok = await done;
      emit('status', ok ? 'Printed ✓' : 'Sent (no done signal)', ok ? 'ok' : 'warn');
      emit('printed', ok);
    }
    C.busy = false; emit('busy', false); if (C.connected) setTimeout(askBattery, 1500);
  }
  return ok;
}
/* print a template with a word (word null = template sample) */
C.print = async (t, word) => {
  t = C.tpl(t);
  if (!C.connected) { emit('toast', 'Connect the Cosmos first'); return false; }
  await C.fontsReady(t);
  const pr = C.prof(); printing = true; let r; try { r = C.render(t, word == null ? t.sample : word, pr.dpm / 8); } finally { printing = false; }
  let rows = r.rows, h = r.h, feed = feedDots(t.feed);
  if (+t.feed === -1) {
    /* rest of the slip (Auto length: slip = the Fixed length setting) + the extra to push it out */
    const slip = Math.round(+t.len * pr.dpm), rest = Math.max(0, slip - h);
    feed = rest + Math.round(C.edge() * pr.dpm);
  }
  const chunks = rasterChunks(rows, h, r.bpr);
  log(`printing ${r.w}×${h} dots (${pr.name}), feed ${feed} in ${chunks.length} writes`);
  emit('status', 'Printing…', 'warn');
  const lvl = C.slow();
  return runJob(t.dens, async () => {
    for (let i = 0; i < chunks.length; i++) {
      await waitCredit(); await write(chunks[i]);
      const ms = paceMs(chunks[i], lvl); if (ms >= 1) await sleep(ms);
      if (i % 10 === 0) emit('status', `Printing… ${Math.round(i/chunks.length*100)}%`, 'warn');
    }
    if (feed > 0) { await waitCredit(); await write(CMD.feed(feed)); }
  });
};
/* Speed test: one slip with the same text 3 times — Normal, Slow, Slower — to compare the darkness. */
C.speedTest = async (t0, word) => {
  if (!C.connected) { emit('toast', 'Connect the Cosmos first'); return false; }
  const t = C.tpl(t0); await C.fontsReady(t); const pr = C.prof(), k = pr.dpm / 8;
  const names = ['1 Normal', '2 Slow', '3 Slower'];
  const blocks = names.map((n, lvl) => { const r = C.render(Object.assign({}, t, { mode: 'auto', flip: false, mirror: false,
      text: n + '\n' + (word || t.sample || 'the word Spongebob') }), null, k); return { lvl, chunks: rasterChunks(r.rows, r.h, r.bpr) }; });
  log('speed test: ' + blocks.map(b => b.chunks.length + ' writes').join(', '));
  emit('status', 'Printing…', 'warn');
  return runJob(t.dens, async () => {
    for (const b of blocks) {
      for (const ch of b.chunks) { await waitCredit(); await write(ch); const ms = paceMs(ch, b.lvl); if (ms >= 1) await sleep(ms); }
      await waitCredit(); await write(CMD.feed(Math.round(4 * pr.dpm)));
    }
    await waitCredit(); await write(CMD.feed(Math.round(C.edge() * pr.dpm)));
  });
};
/* get the prediction word, then print. Returns { ok, word } */
C.printPrediction = async (t, opts = {}) => {
  t = C.tpl(t);
  if (!C.connected) { emit('toast', 'Connect the Cosmos first'); return { ok: false }; }
  const w = await C.prediction(t, opts);
  if (w === null) { emit('toast', 'No prediction word'); emit('status', 'No prediction word', 'bad'); return { ok: false, word: null }; }
  return { ok: await C.print(t, w), word: w };
};
C.feed = (n = 80) => runJob(2, async () => { await write(CMD.feed(feedDots(n))); });
/* calibration print, at the chosen resolution: a frame as wide as the print line, a ruler with a mark
   each mm (long marks each 5 and 10 mm), and a 20 × 20 mm square. Measure it to check the resolution. */
C.calibrate = async () => {
  if (!C.connected) { emit('toast', 'Connect the Cosmos first'); return false; }
  const pr = C.prof(), d = pr.dpm, W = pr.w, H = 40 * d, BPR = W >> 3;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000';
  const lw = Math.max(2, Math.round(d / 4));
  g.fillRect(0, 0, W, lw); g.fillRect(0, H - lw, W, lw); g.fillRect(0, 0, lw, H); g.fillRect(W - lw, 0, lw, H);
  for (let mm = 0; mm * d < W; mm++) { const x = Math.round(mm * d), len = mm % 10 === 0 ? 4 * d : mm % 5 === 0 ? 2.5 * d : 1.2 * d;
    g.fillRect(x, lw, Math.max(1, Math.round(d / 8)), Math.round(len));
    if (mm % 10 === 0 && mm) { g.font = `${Math.round(2.6 * d)}px sans-serif`; g.fillText(String(mm), x + 2, lw + 6.6 * d); } }
  const sq = 20 * d, sx = Math.round((W - sq) / 2), sy = Math.round(12 * d);
  g.fillRect(sx, sy, sq, lw); g.fillRect(sx, sy + sq - lw, sq, lw); g.fillRect(sx, sy, lw, sq); g.fillRect(sx + sq - lw, sy, lw, sq);
  g.font = `${Math.round(2.8 * d)}px sans-serif`; g.textAlign = 'center'; g.fillText('20 mm', W / 2, sy + sq / 2 + d);
  g.textAlign = 'left'; g.fillText(pr.name, lw + d, H - 2 * d);
  const src = g.getImageData(0, 0, W, H).data, rows = new Uint8Array(H * BPR);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (src[(y*W + x) * 4] < 140) rows[y*BPR + (x>>3)] |= 0x80 >> (x & 7);
  const chunks = rasterChunks(rows, H, BPR);
  log(`calibration ${W}×${H} dots (${pr.name})`); emit('status', 'Printing…', 'warn');
  return runJob(2, async () => { for (const ch of chunks) { await waitCredit(); await write(ch); } await waitCredit(); await write(CMD.feed(feedDots(120))); });
};

/* ---------- Magic square (4 × 4, "Napkin" hand-drawn look) ----------
   C.magicSquare(n) -> 4×4 array or null. n = whole number 34 or more (34 = 1+2+…+16, the lowest total
   with 16 different positive numbers). Every row, column, both diagonals, the 4 corners, the center 4
   and each 2×2 corner block add up to n.
   Method: base square (1–16, total 34) + q on every cell, + r on 4 "key" cells (one in each row,
   column, diagonal, corner set, center and corner block). q = floor((n−34)/4), r = (n−34) mod 4.
   So the numbers stay close together and look natural. A random turn / mirror makes each print different. */
const MS_BASE = [[14,1,12,7],[11,8,13,2],[5,10,3,16],[4,15,6,9]];
const MS_KEY = [[0,0],[1,2],[2,3],[3,1]];
C.MS_MIN = 34;
C.magicSquare = (n, seed) => {
  n = Number(n);
  if (!Number.isInteger(n) || n < C.MS_MIN || n > 9999999) return null;
  const q = Math.floor((n - 34) / 4), r = (n - 34) % 4;
  let g = MS_BASE.map(row => row.map(v => v + q));
  MS_KEY.forEach(([y, x]) => { g[y][x] += r; });
  const R = rng(seed == null ? (Date.now() ^ (Math.random() * 1e9)) : seed);
  const turns = Math.floor(R() * 4), flip = R() < 0.5;
  for (let i = 0; i < turns; i++) g = g[0].map((_, x) => g.map(row => row[x]).reverse());
  if (flip) g = g.map(row => row.slice().reverse());
  return g;
};
C.MS_DEFAULT = { font: 'Kalam', mess: 7, cap: false, len: 61, dens: 2, ink: 3.4 };
/* renderSquare(n, o, k) -> same shape as render(): { rows, h, bpr, w, mm, grid } or null.
   o.mess 0–10 = how sloppy (lines and numbers). o.cap = write "= n" under the square. */
C.renderSquare = (n, o0, k = 1) => {
  const o = Object.assign({}, C.MS_DEFAULT, o0 || {});
  const grid = o.grid || C.magicSquare(n, o.seed);
  if (!grid) return null;
  const R = rng(o.seed == null ? (Date.now() & 0xffffff) + 7 : o.seed + 99);
  const m = Math.max(0, Math.min(10, +o.mess)) / 10;             // 0 … 1
  const W = Math.round(C.W * k), BPR = W >> 3, H = Math.max(16, Math.round(+o.len * 8 * k));
  const cell = 74 * k, gw = cell * 4;
  const capH = o.cap ? 70 * k : 0;
  const x0 = (W - gw) / 2 + (R() - 0.5) * 18 * k * m;
  const y0 = Math.max(10 * k, (H - gw - capH) / 2) + (R() - 0.5) * 16 * k * m;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
  /* the whole drawing sits a little crooked */
  g.translate(W / 2, y0 + gw / 2); g.rotate((R() - 0.5) * 0.07 * m); g.translate(-W / 2, -(y0 + gw / 2));
  /* Napkin grid: no outer box, 3 + 3 loose lines that run past the ends, bent, with a thick/thin pen */
  const pen = (x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const a = (6 + R() * 26 * m) * k, b = (6 + R() * 30 * m) * k;
    const sx = x1 - ux * a + (R() - 0.5) * 8 * k * m, sy = y1 - uy * a + (R() - 0.5) * 8 * k * m;
    const ex = x2 + ux * b + (R() - 0.5) * 10 * k * m, ey = y2 + uy * b + (R() - 0.5) * 10 * k * m;
    const b1 = (R() - 0.5) * 22 * k * m, b2 = (R() - 0.5) * 22 * k * m;
    const c1x = sx + (ex - sx) / 3 - uy * b1, c1y = sy + (ey - sy) / 3 + ux * b1;
    const c2x = sx + (ex - sx) * 2 / 3 - uy * b2, c2y = sy + (ey - sy) * 2 / 3 + ux * b2;
    const w0 = +o.ink * k, steps = 18;
    let px = sx, py = sy;
    for (let i = 1; i <= steps; i++) {                            // pen pressure: thin at the ends
      const t = i / steps, u = 1 - t;
      const x = u*u*u*sx + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*ex, y = u*u*u*sy + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*ey;
      g.lineWidth = w0 * (0.55 + 0.6 * Math.sin(Math.PI * t) + (R() - 0.5) * 0.25 * m);
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); px = x; py = y;
    }
  };
  for (let i = 1; i <= 3; i++) {
    pen(x0, y0 + i * cell, x0 + gw, y0 + i * cell);
    pen(x0 + i * cell, y0, x0 + i * cell, y0 + gw);
  }
  /* sloppy numbers: each number off-center and tilted, each digit with its own size, tilt and bounce */
  const fam = o.font, fs0 = 50 * k;
  const font = sz => `400 ${sz.toFixed(1)}px "${fam}", "Kalam", cursive`;
  const ink = Math.max(0.6, (+o.ink * 0.45) * k);
  const drawNum = (txt, cx, cy, maxW, base) => {
    const ch = [...String(txt)], sz = ch.map(() => base * (1 + (R() - 0.5) * 0.34 * m));
    const adv = ch.map((d, i) => { g.font = font(sz[i]); return g.measureText(d).width * (0.86 + R() * 0.2 * m); });
    let tot = adv.reduce((s, v) => s + v, 0);
    const sc = tot > maxW ? maxW / tot : 1;
    const tilt = (R() - 0.5) * 0.5 * m, slope = (R() - 0.5) * 0.22 * m;
    g.save(); g.translate(cx, cy); g.rotate(tilt); g.scale(sc, sc);
    let x = -tot / 2;
    ch.forEach((d, i) => {
      g.save();
      g.translate(x + adv[i] / 2, (R() - 0.5) * base * 0.22 * m + (x + adv[i] / 2) * slope);
      g.rotate((R() - 0.5) * 0.5 * m);
      g.font = font(sz[i]); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = ink; g.strokeText(d, 0, 0); g.fillText(d, 0, 0);
      g.restore(); x += adv[i];
    });
    g.restore();
  };
  grid.forEach((row, y) => row.forEach((v, x) => {
    const long = String(v).length > 2 ? 0.35 : 1;                 // long numbers drift less, so they do not touch the lines
    const cx = x0 + (x + 0.5) * cell + (R() - 0.5) * cell * 0.24 * m * long;
    const cy = y0 + (y + 0.5) * cell + (R() - 0.5) * cell * 0.22 * m;
    drawNum(v, cx, cy, cell * (long < 1 ? 0.78 : 0.9), fs0);
  }));
  if (o.cap) drawNum('= ' + grid[0].reduce((s, v) => s + v, 0), W / 2 + (R() - 0.5) * 30 * k * m, y0 + gw + capH * 0.62, gw, fs0 * 0.9);
  const src = g.getImageData(0, 0, W, H).data, rows = new Uint8Array(H * BPR);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++)
    if (src[(yy*W + xx) * 4] < 140) rows[yy*BPR + (xx>>3)] |= 0x80 >> (xx & 7);
  return { rows, h: H, bpr: BPR, w: W, mm: Math.round(H / (8 * k)), grid };
};
/* print a magic square for n. The same square goes to the live view and the printer (one grid, one seed). */
C.printSquare = async (n, o0) => {
  const o = Object.assign({}, C.MS_DEFAULT, o0 || {});
  if (!C.connected) { emit('toast', 'Connect the Cosmos first'); return false; }
  const grid = C.magicSquare(n);
  if (!grid) { emit('toast', 'Magic square: ' + C.MS_MIN + ' or more'); return false; }
  await C.fontsReady({ font: o.font });
  const pr = C.prof(), seed = Date.now() & 0xffffff;
  const r = C.renderSquare(n, Object.assign({}, o, { grid, seed }), pr.dpm / 8);
  const slip = Math.round(+o.len * pr.dpm), feed = Math.max(0, slip - r.h) + Math.round(C.edge() * pr.dpm);
  const chunks = rasterChunks(r.rows, r.h, r.bpr);
  log(`magic square ${n}: ${grid.map(x => x.join(' ')).join(' / ')} — ${r.w}×${r.h} dots, feed ${feed}`);
  emit('status', 'Printing…', 'warn');
  return runJob(o.dens, async () => {
    for (const ch of chunks) { await waitCredit(); await write(ch); }
    if (feed > 0) { await waitCredit(); await write(CMD.feed(feed)); }
  });
};


/* ---------- Settings panel for Notes / Calculator ("Print" tab) ----------
   opts: { page: 'notes' | 'calculator', psShow(text), defaultSource: 'inject' }
   The page has the panel markup (ids cz…) in its settings sheet. */
C.panel = function(opts){
  const $ = id => document.getElementById(id), page = opts.page, KEY = 'fvtCosmosPanel_' + page;
  const psShow = t => { try { opts.psShow && opts.psShow(t); } catch(e){} };
  let S = {}; try { S = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){}
  S = Object.assign({ tpl: '', src: '', waitNew: false, eq: false, acro: false,
    ed: { name: '', text: 'You will think of\nthe {prediction}', font: 'Kalam', size: 52, len: 61, pos: 'c' } }, S);
  if (!S.srcV) { if (S.src === 'inject') S.src = ''; S.srcV = 1; }   /* '' = use the template's own source */
  const presets = opts.presets || [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} };
  C.loadFonts();
  if (!$('czTpl')) return null;
  const cur = () => { try { return C.tpl(JSON.parse(localStorage.getItem('fvtCosmosCur') || 'null')); } catch(e){ return C.tpl(); } };
  const NEW = '_new';
  const chosen = () => { if (S.tpl === NEW || C.templates.get(S.tpl)) return edTpl(); if (!S.tpl) return cur(); const pr = presets.find(x => x.id === S.tpl); return pr ? C.tpl(pr.tpl) : cur(); };
  /* '{prediction} from' changes the source of your templates, not of the page presets (the Acrostic preset always uses the acrostic) */
  const withSrc = t => Object.assign({}, t, { source: (!presets.some(x => x.id === S.tpl) && C.sources[S.src]) ? S.src : (C.sources[t.source] ? t.source : 'inject') });
  function status(){ $('czSt').textContent = C.connected ? ('Connected' + (C.battery != null ? ' · ' + C.battery + '%' : '')) : C.scanning ? 'Searching…' : (C.lastError ? 'Not connected – ' + C.lastError : 'Not connected'); $('czCon').textContent = C.connected ? 'Disconnect' : 'Connect Cosmos'; }
  C.on('change', status); C.on('scan', status); C.on('status', t => { if (!C.connected) return; if (/Print|Wait|Sent/.test(t)) $('czSt').textContent = t; });
  $('czCon').onclick = () => C.connected ? C.disconnect() : C.connect();
  $('czFeed').onclick = () => C.connected ? C.feed(80) : C.connect();
  function preview(cv, t, word){ C.fontsReady(t).then(() => { const r = C.render(Object.assign({}, t, { flip: false, mirror: false }), word); C.paint(cv, r);
    const w = 150, h = r.h * w / C.W; cv.style.width = (h > 190 ? w * 190 / h : w) + 'px'; cv.style.height = Math.min(190, h) + 'px'; cv.style.background = '#f7f6f1'; cv.style.borderRadius = '2px'; cv.style.margin = '8px auto'; cv.style.display = 'block'; }); }
  /* One section: pick a template, change it, save it. "+ New template" makes a new one.
     Built-in ones (Cosmos page current setup, page presets) print but do not change here. */
  let draft = null, posChanged = false;
  const fs = $('czFont');
  const edRows = () => document.querySelectorAll('#sheet .czEd, .czEd');
  const base = () => { const o = S.tpl !== NEW && C.templates.get(S.tpl); return o ? C.tpl(o.tpl) : C.tpl({ px: 0.5, py: 0.5, yAuto: 24 }); };
  const edTpl = () => { const d = draft || S.ed, t = base();
    Object.assign(t, { text: d.text, font: d.font, size: +d.size, mode: d.len === 'auto' ? 'auto' : 'fixed', len: d.len === 'auto' ? (t.len || 61) : +d.len });
    if (S.tpl === NEW || posChanged) { t.px = 0.5; t.py = d.pos === 't' ? 0.08 : d.pos === 'b' ? 0.92 : 0.5; }
    return t; };
  const edFrom = o => { const t = C.tpl(o.tpl); return { name: o.name, text: t.text, font: t.font, size: +t.size, len: t.mode === 'auto' ? 'auto' : +t.len, pos: t.py < 0.3 ? 't' : t.py > 0.7 ? 'b' : 'c' }; };
  const setSel = (el, v, label) => { v = String(v); if (![...el.options].some(o => o.value === v)) { const o = document.createElement('option'); o.value = v; o.textContent = label; el.appendChild(o); } el.value = v; };
  function fillFonts(){ const v = fs.value || (draft || S.ed).font; fs.innerHTML = '';
    C.FONTS.forEach(([f, n, mine]) => { const o = document.createElement('option'); o.value = f; o.textContent = mine ? '✍️ ' + n + ' (my font)' : f + ' (' + n + ')'; fs.appendChild(o); });
    fs.value = C.FONTS.some(x => x[0] === v) ? v : 'Kalam'; }
  fillFonts();
  function showPrev(){ const t = chosen(); preview($('czPrev'), t, t.sample || 'Cosmos System'); }
  function loadEditor(){
    const o = S.tpl !== NEW && C.templates.get(S.tpl), can = S.tpl === NEW || !!o;
    edRows().forEach(r => { r.style.display = can ? '' : 'none'; });
    $('czLockRow').style.display = can ? 'none' : '';
    posChanged = false;
    if (can) {
      draft = o ? edFrom(o) : Object.assign({}, S.ed, { name: '' });
      $('czName').value = draft.name || ''; $('czName').placeholder = o ? o.name : 'My template';
      $('czText').value = draft.text; setSel(fs, draft.font, draft.font);
      setSel($('czSize'), draft.size, (draft.size / 8).toFixed(1) + ' mm');
      setSel($('czLen'), draft.len, draft.len + ' mm'); $('czPos').value = draft.pos;
      $('czSave').textContent = o ? 'Save changes' : 'Save template';
      $('czDel').style.display = o ? '' : 'none';
    } else draft = null;
    showPrev();
  }
  function fillTpl(){
    const sel = $('czTpl'); sel.innerHTML = '';
    const add = (v, n) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); };
    add('', '★ Cosmos page (current setup)');
    presets.forEach(x => add(x.id, x.name));
    C.templates.list(page).forEach(x => add(x.id, (x.scope === 'cosmos' ? '★ ' : '') + x.name));
    add(NEW, '+ New template');
    if (S.tpl && S.tpl !== NEW && !C.templates.get(S.tpl) && !presets.some(x => x.id === S.tpl)) S.tpl = '';
    sel.value = S.tpl;
    loadEditor();
  }
  $('czTpl').onchange = () => { S.tpl = $('czTpl').value; save(); fillTpl(); };
  C.on('templates', () => { if (document.activeElement && /^cz(Name|Text)$/.test(document.activeElement.id)) return; fillTpl(); });
  addEventListener('storage', e => { if (e.key === 'fvtCosmosCur' && !S.tpl) fillTpl(); });
  C.on('fonts', () => { fillFonts(); showPrev(); });
  function fillSrc(){ const sel = $('czSrc'); sel.innerHTML = ''; { const o = document.createElement('option'); o.value = ''; o.textContent = 'Template setting'; sel.appendChild(o); } Object.entries(C.sources).forEach(([id, s]) => { const o = document.createElement('option'); o.value = id; o.textContent = s.name; sel.appendChild(o); }); sel.value = C.sources[S.src] ? S.src : ''; }
  $('czSrc').onchange = () => { S.src = $('czSrc').value; save(); };
  $('czNew').checked = !!S.waitNew; $('czNew').onchange = () => { S.waitNew = $('czNew').checked; save(); };
  if ($('czEq')) { $('czEq').checked = !!S.eq; $('czEq').onchange = () => { S.eq = $('czEq').checked; save(); }; }
  if ($('czAcro')) { $('czAcro').checked = !!S.acro; $('czAcro').onchange = () => { S.acro = $('czAcro').checked; save(); }; }
  const edChange = () => { if (!draft) return;
    draft = { name: $('czName').value, text: $('czText').value, font: fs.value, size: +$('czSize').value, len: $('czLen').value === 'auto' ? 'auto' : +$('czLen').value, pos: $('czPos').value };
    if (S.tpl === NEW) { S.ed = Object.assign({}, draft, { name: '' }); save(); }
    showPrev(); };
  ['czName','czText'].forEach(id => $(id).oninput = edChange); ['czFont','czSize','czLen'].forEach(id => $(id).onchange = edChange);
  $('czPos').onchange = () => { posChanged = true; edChange(); };
  $('czName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('czName').blur(); } });
  const ins = tag => () => { const ta = $('czText'), a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a; ta.value = ta.value.slice(0, a) + tag + ta.value.slice(b); edChange(); };
  $('czIns').onclick = ins('{prediction}');
  document.querySelectorAll('[data-czins]').forEach(b => { b.onclick = ins('{' + b.dataset.czins + '}'); });
  $('czSave').onclick = () => {
    if (!draft) return; const o = S.tpl !== NEW && C.templates.get(S.tpl), t = edTpl();
    if (o) { const n = (draft.name || '').trim() || o.name; C.templates.update(o.id, { name: n, tpl: t }); emit('toast', 'Saved ' + n); psShow('Saved ' + n); }
    else { const n = (draft.name || '').trim() || ('My template ' + (C.templates.all().filter(x => x.scope === page).length + 1));
      const no = C.templates.add(n, page, t); S.tpl = no.id; save(); emit('toast', 'Saved ' + n); psShow('Saved ' + n); }
    fillTpl(); };
  $('czDel').onclick = () => { const o = C.templates.get(S.tpl); if (!o) return; if (!C.tap2($('czDel'))) return; C.templates.remove(o.id); emit('toast', 'Deleted ' + o.name); S.tpl = ''; save(); fillTpl(); };
  /* printing */
  async function printNow(){
    if (!C.connected) { psShow('Cosmos not connected'); return false; }
    if (C.busy) { psShow('Busy'); return false; }
    const t = withSrc(chosen());
    if (t.text.includes('{prediction}')) psShow(S.waitNew && t.source === 'inject' ? 'Waiting for Inject' : 'Getting ' + C.sources[t.source].name);
    const r = await C.printPrediction(t, { waitNew: !!S.waitNew });
    if (r.word === null) psShow('No word'); else psShow((r.ok ? 'Printed' : 'Sent') + (r.word ? ': ' + r.word : ''));
    return r.ok;
  }
  $('czPrint').onclick = printNow;
  $('czTest').onclick = () => { if (!C.connected) { C.connect(); return; } const t = chosen(); C.print(t, t.sample); };
  fillSrc(); fillTpl(); status();
  return { print: printNow, autoEq: () => !!S.eq, autoAcro: () => !!S.acro, settings: S, current: () => chosen(),
    /* print a preset or template by id, whatever is selected (used by the page's own buttons) */
    printId: async id => { const keep = S.tpl; S.tpl = id; try { return await printNow(); } finally { S.tpl = keep; } } };
};

addEventListener('pagehide', () => { try { if (C.connected) C.disconnect(); } catch(e){} });
window.Cosmos = C;
})();
