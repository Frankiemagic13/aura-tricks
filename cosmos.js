/* Cosmos engine — shared by the Cosmos page, Notes and Calculator.
   - Bluetooth to the Electricks Cosmos (LuckPrinter protocol, see cosmos/cosmos-printer.md), in Aura Browser or Chrome.
   - Handwriting renderer: text block + {prediction}, paper length (Auto / Fixed mm), text position, 1-bit output.
   - Templates: one list in localStorage ("fvtCosmosTpl") for all pages on this site.
     scope "cosmos" = made on the Cosmos page (shown on every page); scope "notes" / "calculator" = that page only.
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
C.FONTS = [
  ['Caveat','Quick pen'],['Kalam','Neat pen'],['Patrick Hand','Print letters'],['Nanum Pen Script','Ballpoint'],
  ['Shadows Into Light','Thin pen'],['Indie Flower','Round'],['Reenie Beanie','Fast note'],['Covered By Your Grace','Marker pen'],
  ['Just Another Hand','Tall'],['Gochi Hand','Felt pen'],['Annie Use Your Telescope','Light pencil'],['Coming Soon','School print'],
  ['The Girl Next Door','Loose'],['Sue Ellen Francisco','Narrow'],['Gaegu','Pencil'],['Bradley Hand','Apple'],['Noteworthy','Apple'],
];
C.loadFonts = () => {
  if (document.getElementById('cosmosFonts')) return;
  const l = document.createElement('link'); l.id = 'cosmosFonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Kalam:wght@300;400;700&family=Patrick+Hand&family=Gochi+Hand&family=Shadows+Into+Light&family=Indie+Flower&family=Reenie+Beanie&family=Covered+By+Your+Grace&family=Just+Another+Hand&family=Nanum+Pen+Script&family=Annie+Use+Your+Telescope&family=Coming+Soon&family=The+Girl+Next+Door&family=Sue+Ellen+Francisco&family=Gaegu:wght@400;700&display=swap';
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
/* Tear edge distance: paper between the print head and the tear edge (mm). With feed "Auto", a Fixed
   slip prints (length − this) and then feeds this, so each torn slip is the paper length. */
C.edge = () => { try { const v = +localStorage.getItem('fvtCosmosEdge'); return v >= 2 && v <= 40 ? v : 8; } catch(e){ return 8; } };
C.setEdge = v => { try { localStorage.setItem('fvtCosmosEdge', String(+v)); } catch(e){} emit('change'); };
C.DEFAULT = {
  text: 'You will think of\nthe {prediction}', font: 'Caveat', size: 52, ink: 1.5, mess: 4, lh: 1.1,
  align: 'center', bold: false, slant: false, seed: 1,
  mode: 'fixed', len: 61, px: 0.5, py: 0.5, yAuto: 24,
  dens: 2, feed: -1, flip: false, mirror: false,      // feed -1 = Auto (torn slip = paper length)
  source: 'inject', caseT: 'asis', fallback: '', sample: 'Cosmos System',
};
C.tpl = o => Object.assign({}, C.DEFAULT, o || {});

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
C.fill = (t, word) => String(t.text || '').split('{prediction}').join(C.applyCase(word, t.caseT));

/* render(t, word, k) -> { rows: Uint8Array(H*bpr), h, bpr, w, box:{x,y,w,h}, over, mm }
   k = 1: design grid (live view). k = C.prof().dpm / 8: printer dots. */
C.render = (t0, word, k = 1) => {
  const t = C.tpl(t0), W = Math.round(C.W * k), BPR = W >> 3, size = +t.size * k, ink = +t.ink * k, jit = (+t.mess)/10, lh = +t.lh, PAD = 6 * k;
  const fam = t.font, weight = t.bold ? '700' : '400';
  const fontStr = (sz) => `${t.slant ? 'italic ' : ''}${weight} ${sz.toFixed(1)}px "${fam}", "Caveat", "Bradley Hand", cursive`;
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
C.fontsReady = async t => { try { await C.myFonts.load(); } catch(e){} try { await document.fonts.load(`${t && t.bold ? 700 : 400} 40px "${(t && t.font) || 'Caveat'}"`); } catch(e){} };

/* ---------- Templates (shared localStorage) ---------- */
const TK = 'fvtCosmosTpl';
C.templates = {
  all(){ try { return JSON.parse(localStorage.getItem(TK) || '[]'); } catch(e){ return []; } },
  saveAll(a){ try { localStorage.setItem(TK, JSON.stringify(a)); } catch(e){} emit('templates'); },
  /* page "cosmos": only Cosmos templates. Other pages: Cosmos templates + the page's own. */
  list(page){ return this.all().filter(x => x.scope === 'cosmos' || x.scope === page); },
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
C.connect = async () => {
  if (C.connected) return true;
  credits = null;
  mode = C.hasAura() ? 'aura' : C.hasWeb() ? 'web' : null;
  if (!mode) { emit('status', 'No Bluetooth here', 'bad'); emit('toast', 'Open this page in Aura Browser or Chrome'); return false; }
  emit('status', 'Searching…', 'warn');
  try {
    if (mode === 'aura') await connectAura(); else await connectWeb();
    setConnected(true); emit('toast', 'Cosmos connected'); return true;
  } catch (e) {
    log('connect failed: ' + e.message); emit('status', 'Not connected', 'bad');
    emit('toast', /cancel/i.test(e.message) ? 'Cancelled' : 'Could not connect'); return false;
  }
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
  const pr = C.prof(), r = C.render(t, word == null ? t.sample : word, pr.dpm / 8);
  let rows = r.rows, h = r.h, feed = feedDots(t.feed);
  if (+t.feed === -1) {
    const edge = Math.round(C.edge() * pr.dpm); feed = edge;
    /* Fixed: the first part of the slip is the blank paper that is already past the print head */
    if (t.mode === 'fixed') {
      const cut = Math.min(edge, h - 8);
      if (r.box.y < cut) emit('toast', 'The text starts in the top ' + C.edge() + ' mm: move it down or make the paper longer');
      rows = r.rows.subarray(cut * r.bpr); h = h - cut;
    }
  }
  const chunks = rasterChunks(rows, h, r.bpr);
  log(`printing ${r.w}×${h} dots (${pr.name}), feed ${feed} in ${chunks.length} writes`);
  emit('status', 'Printing…', 'warn');
  return runJob(t.dens, async () => {
    for (let i = 0; i < chunks.length; i++) {
      await waitCredit(); await write(chunks[i]);
      if (i % 10 === 0) emit('status', `Printing… ${Math.round(i/chunks.length*100)}%`, 'warn');
    }
    if (feed > 0) { await waitCredit(); await write(CMD.feed(feed)); }
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


/* ---------- Settings panel for Notes / Calculator ("Print" tab) ----------
   opts: { page: 'notes' | 'calculator', psShow(text), defaultSource: 'inject' }
   The page has the panel markup (ids cz…) in its settings sheet. */
C.panel = function(opts){
  const $ = id => document.getElementById(id), page = opts.page, KEY = 'fvtCosmosPanel_' + page;
  const psShow = t => { try { opts.psShow && opts.psShow(t); } catch(e){} };
  let S = {}; try { S = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){}
  S = Object.assign({ tpl: '', src: '', waitNew: false, eq: false, acro: false,
    ed: { name: '', text: 'You will think of\nthe {prediction}', font: 'Caveat', size: 52, len: 61, pos: 'c' } }, S);
  if (!S.srcV) { if (S.src === 'inject') S.src = ''; S.srcV = 1; }   /* '' = use the template's own source */
  const presets = opts.presets || [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} };
  C.loadFonts();
  if (!$('czTpl')) return null;
  const cur = () => { try { return C.tpl(JSON.parse(localStorage.getItem('fvtCosmosCur') || 'null')); } catch(e){ return C.tpl(); } };
  const chosen = () => { if (!S.tpl) return cur(); const pr = presets.find(x => x.id === S.tpl); if (pr) return C.tpl(pr.tpl); const o = C.templates.get(S.tpl); return o ? C.tpl(o.tpl) : cur(); };
  const withSrc = t => Object.assign({}, t, { source: C.sources[S.src] ? S.src : (C.sources[t.source] ? t.source : 'inject') });
  function status(){ $('czSt').textContent = C.connected ? ('Connected' + (C.battery != null ? ' · ' + C.battery + '%' : '')) : 'Not connected'; $('czCon').textContent = C.connected ? 'Disconnect' : 'Connect Cosmos'; }
  C.on('change', status); C.on('status', t => { if (!C.connected) return; if (/Print|Wait|Sent/.test(t)) $('czSt').textContent = t; });
  $('czCon').onclick = () => C.connected ? C.disconnect() : C.connect();
  $('czFeed').onclick = () => C.connected ? C.feed(80) : C.connect();
  function preview(cv, t, word){ C.fontsReady(t).then(() => { const r = C.render(Object.assign({}, t, { flip: false, mirror: false }), word); C.paint(cv, r);
    const w = 150, h = r.h * w / C.W; cv.style.width = (h > 190 ? w * 190 / h : w) + 'px'; cv.style.height = Math.min(190, h) + 'px'; cv.style.background = '#f7f6f1'; cv.style.borderRadius = '2px'; cv.style.margin = '8px auto'; cv.style.display = 'block'; }); }
  function fillTpl(){
    const sel = $('czTpl'); sel.innerHTML = '';
    const add = (v, n) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); };
    add('', '★ Cosmos page (current setup)');
    presets.forEach(x => add(x.id, x.name));
    C.templates.list(page).forEach(x => add(x.id, (x.scope === 'cosmos' ? '★ ' : '') + x.name));
    if (S.tpl && !C.templates.get(S.tpl) && !presets.some(x => x.id === S.tpl)) S.tpl = '';
    sel.value = S.tpl;
    const o = S.tpl && C.templates.get(S.tpl); $('czDelRow').style.display = o && o.scope === page ? '' : 'none';
    preview($('czPrev'), chosen(), chosen().sample);
  }
  $('czTpl').onchange = () => { S.tpl = $('czTpl').value; save(); fillTpl(); };
  C.on('templates', fillTpl); addEventListener('storage', e => { if (e.key === 'fvtCosmosCur' && !S.tpl) fillTpl(); });
  function fillSrc(){ const sel = $('czSrc'); sel.innerHTML = ''; { const o = document.createElement('option'); o.value = ''; o.textContent = 'Template setting'; sel.appendChild(o); } Object.entries(C.sources).forEach(([id, s]) => { const o = document.createElement('option'); o.value = id; o.textContent = s.name; sel.appendChild(o); }); sel.value = C.sources[S.src] ? S.src : ''; }
  $('czSrc').onchange = () => { S.src = $('czSrc').value; save(); };
  $('czNew').checked = !!S.waitNew; $('czNew').onchange = () => { S.waitNew = $('czNew').checked; save(); };
  if ($('czEq')) { $('czEq').checked = !!S.eq; $('czEq').onchange = () => { S.eq = $('czEq').checked; save(); }; }
  if ($('czAcro')) { $('czAcro').checked = !!S.acro; $('czAcro').onchange = () => { S.acro = $('czAcro').checked; save(); }; }
  $('czDel').onclick = () => { const o = C.templates.get(S.tpl); if (!o || o.scope !== page) return; if (!confirm('Delete ' + o.name + '?')) return; C.templates.remove(o.id); S.tpl = ''; save(); fillTpl(); };
  /* new template (this page only) */
  const fs = $('czFont');
  function fillFonts(){ const v = fs.value || S.ed.font; fs.innerHTML = '';
    C.FONTS.forEach(([f, n, mine]) => { const o = document.createElement('option'); o.value = f; o.textContent = mine ? '✍️ ' + n + ' (my font)' : f + ' (' + n + ')'; fs.appendChild(o); });
    fs.value = C.FONTS.some(x => x[0] === v) ? v : 'Caveat'; }
  fillFonts();
  C.on('fonts', () => { fillFonts(); if (S.ed.font !== fs.value) { S.ed.font = fs.value; save(); } fillTpl(); preview($('czEdPrev'), edTpl(), 'Cosmos System'); });
  const edTpl = () => { const e = S.ed, posY = e.pos === 't' ? 0.08 : e.pos === 'b' ? 0.92 : 0.5;
    return C.tpl({ text: e.text, font: e.font, size: +e.size, mode: e.len === 'auto' ? 'auto' : 'fixed', len: e.len === 'auto' ? 61 : +e.len, px: 0.5, py: posY, yAuto: 24 }); };
  function fillEd(){ const e = S.ed; $('czName').value = e.name || ''; $('czText').value = e.text; fs.value = e.font; $('czSize').value = String(e.size); $('czLen').value = String(e.len); $('czPos').value = e.pos; preview($('czEdPrev'), edTpl(), 'Cosmos System'); }
  const edChange = () => { S.ed = { name: $('czName').value, text: $('czText').value, font: fs.value, size: +$('czSize').value, len: $('czLen').value === 'auto' ? 'auto' : +$('czLen').value, pos: $('czPos').value }; save(); preview($('czEdPrev'), edTpl(), 'Cosmos System'); };
  ['czName','czText'].forEach(id => $(id).oninput = edChange); ['czFont','czSize','czLen','czPos'].forEach(id => $(id).onchange = edChange);
  $('czIns').onclick = () => { const ta = $('czText'), a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a; ta.value = ta.value.slice(0, a) + '{prediction}' + ta.value.slice(b); edChange(); };
  $('czSave').onclick = () => { const n = ($('czName').value || '').trim() || ('My template ' + (C.templates.all().filter(x => x.scope === page).length + 1));
    const o = C.templates.add(n, page, edTpl()); S.tpl = o.id; S.ed.name = ''; save(); fillEd(); fillTpl(); psShow('Saved ' + n); };
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
  fillSrc(); fillTpl(); fillEd(); status();
  return { print: printNow, autoEq: () => !!S.eq, autoAcro: () => !!S.acro, settings: S,
    /* print a preset or template by id, whatever is selected (used by the page's own buttons) */
    printId: async id => { const keep = S.tpl; S.tpl = id; try { return await printNow(); } finally { S.tpl = keep; } } };
};

addEventListener('pagehide', () => { try { if (C.connected) C.disconnect(); } catch(e){} });
window.Cosmos = C;
})();
