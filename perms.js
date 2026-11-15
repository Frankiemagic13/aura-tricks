/* All permissions at launch — one file for all trick pages.
   Put it at the end of <body>:  <script src="../perms.js" data-perms="motion,camera,mic"></script>
   A page can also set window.fvtPerms = ['motion', ...] before this script (this wins over data-perms).

   motion  motion + orientation sensor. iOS shows this message only after a tap, so the FIRST TAP anywhere asks.
           Both requests go in the same tap (iOS stops a request that waits for another). The tap still works as usual.
   camera  camera (flashlight torch). Asked when the page opens.
   mic     microphone. Asked when the page opens. camera + mic together = one iOS message.
   speech  speech recognition (key words). Asked on the first tap (iOS needs a tap for it).
           A button with data-perms-own (it starts listening by itself) is not asked twice.

   If iOS does not show the camera/mic message when the page opens, the first tap asks again.
   Bluetooth (PeekSmith, Aura peer) is not here: those pages start the search when they open, so iOS asks then.

   Result: window event 'fvtperm' with detail {name:'motion'|'camera'|'mic'|'speech', state:'granted'|'denied'}. */
(function () {
  const me = document.currentScript;
  let want = Array.isArray(window.fvtPerms) ? window.fvtPerms
    : ((me && me.dataset.perms) || '').split(',');
  want = want.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (!want.length) return;
  const has = n => want.includes(n);
  const tell = (name, state) => { try { dispatchEvent(new CustomEvent('fvtperm', { detail: { name, state } })) } catch (e) {} };
  const tapJobs = [];

  /* ---- camera + mic: when the page opens ---- */
  const media = { video: has('camera'), audio: has('mic') };
  async function askMedia() {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return true;
    try {
      const s = await md.getUserMedia({ video: media.video ? { facingMode: { ideal: 'environment' } } : false, audio: media.audio });
      s.getTracks().forEach(t => t.stop());      // only the permission is necessary; the page opens its own stream later
      if (media.video) tell('camera', 'granted'); if (media.audio) tell('mic', 'granted');
      return true
    } catch (e) {
      if (media.video) tell('camera', 'denied'); if (media.audio) tell('mic', 'denied');
      return false
    }
  }
  if (media.video || media.audio) {
    let again = false;
    const start = () => askMedia().then(ok => { if (!ok) again = true });
    if (document.visibilityState === 'visible') start();
    else document.addEventListener('visibilitychange', function v() { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', v); start() } });
    tapJobs.push(() => { if (again) { again = false; askMedia() } });
  }

  /* ---- motion + orientation: first tap ---- */
  if (has('motion')) {
    const DO = window.DeviceOrientationEvent, DM = window.DeviceMotionEvent;
    const canDO = !!(DO && typeof DO.requestPermission === 'function'), canDM = !!(DM && typeof DM.requestPermission === 'function');
    if (!canDO && !canDM) tell('motion', DO || DM ? 'granted' : 'denied');   // not iOS: no message is necessary
    else tapJobs.unshift(() => {        // first in the list: iOS must see it straight from the tap
      const ps = [];
      try { if (canDO) ps.push(DO.requestPermission()) } catch (e) {}
      try { if (canDM) ps.push(DM.requestPermission()) } catch (e) {}
      Promise.all(ps.map(p => Promise.resolve(p).catch(() => 'denied')))
        .then(r => tell('motion', r.length && r.every(x => x === 'granted') ? 'granted' : 'denied'))
    });
  }

  /* ---- speech recognition: first tap (start, then stop at once) ---- */
  if (has('speech')) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) tapJobs.push(ev => {
      if (ev && ev.target && ev.target.closest && ev.target.closest('[data-perms-own]')) return;   // this button asks by itself
      try {
        const r = new SR(); let done = false;
        const end = st => { if (done) return; done = true; try { r.abort() } catch (e) {} tell('speech', st) };
        r.onstart = () => end('granted');
        r.onerror = ev => end(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'denied' : 'granted');
        r.start();
        setTimeout(() => end('granted'), 4000)
      } catch (e) {}
    });
  }

  /* ---- the first tap runs the jobs one time ---- */
  if (!tapJobs.length) return;
  let ran = false;
  function tap(ev) {
    if (ran) return; ran = true;
    ['touchend', 'click'].forEach(t => removeEventListener(t, tap, { capture: true }));
    tapJobs.forEach(f => { try { f(ev) } catch (e) {} })
  }
  ['touchend', 'click'].forEach(t => addEventListener(t, tap, { capture: true, passive: true }));
})();
