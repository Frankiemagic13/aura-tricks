/* Volume buttons as triggers (Aura 8 / AuraKit), shared by all trick pages.
   Needs ../aurakit/aurakit.js before this file.
   Use (in the page script, before hui.js builds the settings):
     FVTVol.setup({
       page: 'calc',
       // optional: extraHTML (more settings cards for the Volume tab) + tabWords (their .lbl titles, lower case)                                  // settings are saved per page
       actions: [{ id: 'reset', label: 'Clear (AC)', run: () => reset() }, ...],
       psOptions: () => document.querySelector('#sheet select[data-k]'),   // optional: copy the PeekSmith button choices
       psRun: a => ...,                               // optional: run one PeekSmith button choice
       defaults: { up: 'reset', down: 'none' },
       black: false                                   // optional: hide the simple black screen action
     });
   The page gets a "Volume" settings tab: on/off, App Clip, keep volume, buzz, and an action for
   Volume +, Volume + twice, Volume −, Volume − twice. Presses do nothing while the settings are open. */
(function () {
  'use strict';
  const DOUBLE_MS = 400;
  let cfg = null, S = null, watcher = null, starting = false, pend = { up: null, down: null }, lastSt = '';
  const $ = id => document.getElementById(id);
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
  };
  const key = () => 'fvtvol.' + cfg.page;
  const save = () => ls.set(key(), S);
  const AK = () => window.AuraKit;
  const sheetOpen = () => document.body.classList.contains('open');

  /* ---------- generic actions (all pages) ---------- */
  let blk = null;
  function blackToggle(on) {
    if (!blk) {
      blk = document.createElement('div');
      blk.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483000;display:none;touch-action:none';
      const off = e => { e.preventDefault(); e.stopPropagation(); blackToggle(false) };
      blk.addEventListener('touchend', off, { passive: false }); blk.addEventListener('click', off);
      blk.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation() }, { passive: false });
      document.body.appendChild(blk);
    }
    const show = on == null ? blk.style.display === 'none' : !!on;
    blk.style.display = show ? 'block' : 'none';
  }
  function buzz(style) { try { const a = AK(); if (a) a.haptics.impact(style || 'light') } catch (e) {} }
  function genActions() {
    const g = [];
    if (cfg.black !== false) g.push({ id: 'g:black', label: 'Black screen on/off', run: () => blackToggle() });
    g.push({ id: 'g:buzz', label: 'Buzz only (test)', run: () => buzz('heavy') });
    g.push({ id: 'g:quit', label: 'Close the App Clip', run: () => { const a = AK(); if (a) a.quitAppClip().catch(() => {}) } });
    return g;
  }

  /* ---------- run ---------- */
  function run(id) {
    if (!id || id === 'none') return;
    try {
      if (id.startsWith('ps:')) { if (cfg.psRun) cfg.psRun(id.slice(3)); return }
      const a = (cfg.actions || []).concat(genActions()).find(x => x.id === id);
      if (a) a.run();
    } catch (e) { console.warn('[vol]', e) }
  }
  let lastPress = { up: 0, down: 0 };
  function onPress({ button }) {
    const b = button === 'up' ? 'up' : 'down';
    /* one press can come 2 times (press + the volume reset of "Keep the volume"): skip a copy that comes very fast */
    const t = Date.now(); if (t - lastPress[b] < 150) return; lastPress[b] = t;
    if (S.buzz) buzz('light');
    if (blk && blk.style.display !== 'none' && (S.map[b] !== 'g:black' && S.map[b + '2'] !== 'g:black')) return; // black screen: only the black action works
    if (sheetOpen() || (cfg.blocked && cfg.blocked())) return;
    const dbl = S.map[b + '2'];
    if (!dbl || dbl === 'none') { run(S.map[b]); return }
    if (pend[b]) { clearTimeout(pend[b]); pend[b] = null; run(dbl); return }
    pend[b] = setTimeout(() => { pend[b] = null; run(S.map[b]) }, DOUBLE_MS);
  }

  /* ---------- start / stop ---------- */
  function status(t) { lastSt = t; const el = $('volSt'); if (el) el.textContent = t }
  async function apply() {
    const a = AK();
    if (!a) { status('AuraKit did not load'); return }
    const env = await a.ready().catch(() => null);
    const can = env && env.available && env.caps && env.caps.volumeButtons;
    const want = S.on && can && (!env.appClip || S.clip);
    if (watcher && (!want || watcher.keep !== S.keep)) { try { watcher.stop() } catch (e) {} watcher = null }
    if (!env || !env.available) { status('Only in Aura'); return }
    if (!can) { status('Update Aura to version 8'); return }
    if (!S.on) { status('Off'); return }
    if (env.appClip && !S.clip) { status('Off in the App Clip (see "In the App Clip")'); return }
    if (watcher || starting) { status('On'); return }
    starting = true;
    try {
      const w = await a.volumeButtons.watch(onPress, { keepVolume: S.keep });
      watcher = { stop: w.stop, keep: S.keep }; status('On');
    } catch (e) { status('Error: ' + (e && e.message || e)) }
    starting = false;
  }

  /* ---------- settings UI ---------- */
  const SLOTS = [['up', 'Volume +'], ['up2', 'Volume + twice'], ['down', 'Volume −'], ['down2', 'Volume − twice']];
  function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
  function optionsHTML() {
    let h = '<option value="none">Nothing</option>';
    const page = (cfg.actions || []);
    if (page.length) h += '<optgroup label="This page">' + page.map(a => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('') + '</optgroup>';
    const src = cfg.psOptions && cfg.psOptions();
    if (src && cfg.psRun) {
      const list = [...src.querySelectorAll('option')].filter(o => o.value && o.value !== 'none');
      if (list.length) h += '<optgroup label="PeekSmith button actions">' + list.map(o => `<option value="ps:${esc(o.value)}">${esc(o.textContent.trim())}</option>`).join('') + '</optgroup>';
    }
    h += '<optgroup label="Any page">' + genActions().map(a => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('') + '</optgroup>';
    return h;
  }
  function fill() {
    const h = optionsHTML();
    SLOTS.forEach(([k]) => {
      const s = $('vol_' + k); if (!s) return;
      s.innerHTML = h;
      if (![...s.options].some(o => o.value === S.map[k])) S.map[k] = 'none';
      s.value = S.map[k] || 'none';
    });
    $('volOn').checked = !!S.on; $('volClip').checked = !!S.clip; $('volKeep').checked = !!S.keep; $('volBuzz').checked = !!S.buzz;
    status(lastSt || '…');
  }
  function buildUI() {
    const sheet = document.getElementById(cfg.sheet || 'sheet'); if (!sheet) return;
    /* the Volume tab, before Help and Kill */
    try {
      const c = JSON.parse(sheet.getAttribute('data-hui') || '{}'); c.tabs = c.tabs || [];
      if (!c.tabs.some(t => (t.s || []).includes('volume buttons'))) {
        const t = { n: 'Volume', i: 'volume', s: ['volume buttons'].concat(cfg.tabWords || []) };
        const i = c.tabs.findIndex(x => /^(help|kill)$/i.test(x.n));
        if (i < 0) c.tabs.push(t); else c.tabs.splice(i, 0, t);
        sheet.setAttribute('data-hui', JSON.stringify(c));
      }
    } catch (e) {}
    const box = document.createElement('div');
    box.innerHTML =
      '<div class="lbl">Volume buttons</div><div class="grp">' +
      '<div class="r">On<input type="checkbox" id="volOn"></div>' +
      SLOTS.map(([k, n]) => `<div class="r">${n}<select id="vol_${k}"></select></div>`).join('') +
      '<div class="r">Buzz on press<input type="checkbox" id="volBuzz"></div>' +
      '<div class="r">Keep the volume<input type="checkbox" id="volKeep"></div>' +
      '<div class="r">In the App Clip<input type="checkbox" id="volClip"></div>' +
      '<div class="r">Status<span id="volSt" class="dim" style="color:#8d919c">…</span></div></div>' +
      '<div class="snote">Needs Aura 8. The volume buttons do the action you choose. "Twice" = two quick presses; ' +
      'when a "twice" action is set, one press waits ' + DOUBLE_MS / 1000 + ' s. Keep the volume: the volume does not change and iOS shows no volume bar. ' +
      'Presses do nothing while these settings are open, and only while the page is on screen (not when the phone is locked). ' +
      'In the App Clip (spectator phones) Apple does not let Aura hide the volume bar, so it is off by default.</div>' + (cfg.extraHTML || '');
    /* put it before the Kill switch section if there is one, else at the end */
    const kill = [...sheet.querySelectorAll('.lbl')].find(l => /^kill/i.test(l.textContent.trim()));
    const before = kill || sheet.querySelector('[data-tab="Help"]');
    [...box.childNodes].forEach(n => before ? sheet.insertBefore(n, before) : sheet.appendChild(n));
    const help = sheet.querySelector('[data-tab="Help"]');
    if (help) help.insertAdjacentHTML('beforeend', '<h4>Volume buttons</h4><p>Volume tab: choose what Volume +, Volume −, and two quick presses of each do. Needs Aura 8. Off while the settings are open.</p>');
    SLOTS.forEach(([k]) => { $('vol_' + k).onchange = e => { S.map[k] = e.target.value; save() } });
    $('volOn').onchange = e => { S.on = e.target.checked; save(); apply() };
    $('volClip').onchange = e => { S.clip = e.target.checked; save(); apply() };
    $('volKeep').onchange = e => { S.keep = e.target.checked; save(); apply() };
    $('volBuzz').onchange = e => { S.buzz = e.target.checked; save() };
    fill();
    /* the choices can change (for example new routines): fill again each time the settings open */
    let was = sheetOpen();
    new MutationObserver(() => { const now = sheetOpen(); if (now && !was) fill(); was = now })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function setup(c) {
    cfg = Object.assign({ actions: [], defaults: {} }, c);
    const d = cfg.defaults || {};
    S = Object.assign({ on: true, clip: false, keep: true, buzz: true }, ls.get('fvtvol.' + cfg.page) || {});
    S.map = Object.assign({ up: d.up || 'none', up2: d.up2 || 'none', down: d.down || 'none', down2: d.down2 || 'none' }, S.map || {});
    buildUI();
    apply();
    /* back from the page cache: start again (Aura releases the buttons when a page loads) */
    addEventListener('pageshow', e => { if (e.persisted) { try { watcher && watcher.stop() } catch (x) {} watcher = null; apply() } });
  }
  window.FVTVol = { setup, run, black: blackToggle, get settings() { return S } };
})();
