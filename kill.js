/* Kill switch — "kill this show".
   Tap Kill after a show: every phone that saw a trick BEFORE the tap goes to apple.com from then on
   (also a page that is open at that moment). Phones that open a trick for the first time AFTER the tap
   (the next show) get the trick as normal. You never have to turn it back on.
   How: one online show number (same Firebase as the peeks). Kill = +1. Each spectator phone keeps the
   show number of the first time it opened a trick. Its number smaller than the online number = past show.
   No clocks are compared, so a wrong phone time has no effect.
   Your own phone (the phone that tapped Kill, or a link with ?me=1) is never sent away.
   App first (optional): a page can open a phone app before it is sent away, e.g. the calculator page opens
   the Calculator app. Put <script>window.KS_APP='calc://'</script> before kill.js. Test any app link on
   your own phone with ?kstest=1 (the page's app) or ?kstest=mobilenotes:// (any link).
   Put <script src="../kill.js"></script> in <head>, before the page shows.
   A settings row with id="ksBtn" (button) and id="ksSt" (status) is connected automatically. */
(function () {
  const URL_ = 'https://peek-island-default-rtdb.firebaseio.com/peeks/fvt-kill.json';
  const GO = window.__KS_GO || 'https://www.apple.com';   // (__KS_GO: test hook only)
  const WAIT_MS = 1500;   // no answer in this time = show the trick (a slow connection never breaks a show)
  const ls = {
    get(k) { try { return localStorage.getItem(k) } catch (e) { return null } },
    set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} }
  };
  const q = new URLSearchParams(location.search);
  if (q.get('me') === '1') ls.set('fvtMe', '1');
  if (q.get('me') === '0') ls.set('fvtMe', '');
  const isMe = () => ls.get('fvtMe') === '1' || q.get('me') === '1';

  let n = null, killT = 0, gone = false;          // n = online show number (null = not known yet)
  const mine = () => { const v = ls.get('fvtShow'); return v === null || v === '' ? null : +v };
  const toApple = () => { try { location.replace(GO) } catch (e) { location.href = GO } };
  /* Aura 8: close the App Clip (same method as AuraKit.quitAppClip: an oversized peer.join timeout
     makes the App Clip quit). Only in the App Clip, and Bluetooth must be on and allowed.
     If it does not close in QUIT_MS, the phone goes to apple.com as before. */
  const QUIT_MS = 900;
  async function quitClip() {
    const A = window.Aura;
    if (!A || !A.peer || typeof A.peer.join !== 'function' || typeof A.capabilities !== 'function') return;
    const caps = await Promise.race([Promise.resolve().then(() => A.capabilities()), new Promise(r => setTimeout(() => r(null), 600))]).catch(() => null);
    if (!caps || !caps.appClip) return;
    try { const p = A.peer.join({ room: '~quit-' + Math.random().toString(36).slice(2, 10), timeout: 1e300 }); if (p && p.catch) p.catch(() => {}) } catch (e) { return }
    await new Promise(r => setTimeout(r, QUIT_MS));
  }
  /* open the page's own phone app first (e.g. Calculator). The page then goes to the background;
     when the spectator comes back to it, it closes / goes to apple.com as before. */
  const APP = window.KS_APP || '';
  function openApp(link) {
    if (!link) return false;
    try { location.href = link } catch (e) { return false }
    return true;
  }
  const go = () => {
    if (gone || isMe()) return; gone = true;
    if (window.__KS_NOQUIT) { toApple(); return }   // (test hook only)
    const after = () => quitClip().catch(() => {}).then(toApple);
    if (openApp(APP)) { show(); setTimeout(after, 700) } else after();
  };
  const kt = q.get('kstest');
  if (kt) setTimeout(() => openApp(kt === '1' ? APP : kt), 1500);   // test on your own phone: only opens the app
  function take(d) {
    n = d && Number.isFinite(+d.n) ? +d.n : 0; killT = d && d.t ? +d.t : 0; ui();
    if (isMe()) return false;
    const m = mine();
    if (m === null) { ls.set('fvtShow', String(n)); return false }   // first time on this phone: this show
    if (m < n) { go(); return true }                                   // a past show
    return false
  }

  /* hide the page until the answer comes (only on spectator phones) */
  const root = document.documentElement;
  let st = null;
  function hide() {
    st = document.createElement('style');
    st.textContent = 'html.ks-wait body{visibility:hidden!important}';
    (document.head || root).appendChild(st); root.classList.add('ks-wait');
  }
  function show() { root.classList.remove('ks-wait'); if (st) { st.remove(); st = null } }
  if (!isMe()) {
    hide();
    const t = setTimeout(show, WAIT_MS);
    fetch(URL_, { cache: 'no-store' }).then(r => r.json()).then(d => { clearTimeout(t); if (!take(d)) show() })   // a past show stays hidden while it closes
      .catch(() => { clearTimeout(t); show() });
  } else {
    fetch(URL_, { cache: 'no-store' }).then(r => r.json()).then(take).catch(() => {});
  }

  /* live: a page that is open goes to apple.com at once when Kill is tapped */
  function listen() {
    let es;
    try { es = new EventSource(URL_) } catch (e) { return }
    let cur = {};
    const onEv = ev => {
      try {
        const m = JSON.parse(ev.data); if (!m) return;
        if (m.path === '/') cur = m.data && typeof m.data === 'object' ? m.data : {};
        else { const k = m.path.slice(1); cur = Object.assign({}, cur, { [k]: m.data }) }
        if (ev.type === 'patch' && m.path === '/') cur = Object.assign({}, cur, m.data);
        take(cur);
      } catch (e) {}
    };
    es.addEventListener('put', onEv); es.addEventListener('patch', onEv);
    es.onerror = () => { try { es.close() } catch (e) {} setTimeout(listen, 4000) };
  }
  listen();

  /* the settings button */
  function buzz() {
    try { const A = window.Aura; if (A && typeof A.haptic === 'function') { const r = A.haptic('impact', { style: 'heavy' }); if (r && r.catch) r.catch(() => {}) } } catch (e) {}
    try { navigator.vibrate && navigator.vibrate(40) } catch (e) {}
  }
  const when = t => { const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) };
  function ui(msg) {
    const b = document.getElementById('ksBtn'), s = document.getElementById('ksSt');
    if (b) b.textContent = 'Kill this show';
    if (s) s.textContent = msg || (killT ? 'Last kill: ' + when(killT) : (n === null ? '—' : 'No kill yet'));
  }
  let busy = false;
  async function kill() {
    if (busy) return; busy = true;
    ls.set('fvtMe', '1');   // this phone is yours: it is never sent away
    buzz(); ui('Killing…');
    try {
      /* read the newest number first, then save +1 */
      const d = await fetch(URL_, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      const cur = d && Number.isFinite(+d.n) ? +d.n : (n || 0);
      const v = { n: cur + 1, t: Date.now() };
      const r = await fetch(URL_, { method: 'PUT', body: JSON.stringify(v) });
      if (!r.ok) throw new Error(r.status);
      n = v.n; killT = v.t; ui('Killed ' + when(killT) + ' – past spectators → ' + (APP ? 'app, then closed' : 'apple.com'));
    } catch (e) { ui('Not saved – no internet? Tap again') }
    busy = false;
  }
  function bind() {
    const b = document.getElementById('ksBtn'); if (!b || b.dataset.ks) return; b.dataset.ks = '1';
    b.addEventListener('click', e => { e.preventDefault(); kill() });
    ui();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();

  window.KillSwitch = { kill, isMe, show: () => n };
})();
