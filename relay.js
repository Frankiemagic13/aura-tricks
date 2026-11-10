/* PeekRelay — sends and receives peeks.
   Main:   Firebase Realtime Database (free, no daily message limit)
   Backup: ntfy.sh (250 messages per day per connection) — used only if Firebase fails. */
(function () {
  const FB = 'https://peek-island-default-rtdb.firebaseio.com/peeks/';
  const NTFY = 'https://ntfy.sh/';
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  async function send(topic, text, title) {
    if (!topic || !text) return false;
    const body = JSON.stringify({ m: String(text), title: title || 'Peek', t: Date.now(), id: rid() });
    try {
      const r = await fetch(FB + encodeURIComponent(topic) + '.json', { method: 'PUT', body, keepalive: true });
      if (r.ok) return true;
    } catch (e) {}
    try {
      await fetch(NTFY + encodeURIComponent(topic) + '?title=' + encodeURIComponent(title || 'Peek'),
        { method: 'POST', body: String(text), keepalive: true });
      return true;
    } catch (e) { return false; }
  }

  /* onMsg(text) for each new peek. onState('Listening' | 'Reconnecting…') optional.
     sinceMs: also deliver a peek that is at most this old when listening starts (0 = only new ones). */
  function listen(topic, onMsg, onState, sinceMs) {
    let lastId = '', seen = new Map(), stopped = false, fbES = null, nES = null;
    const deliver = (text, key) => {
      const now = Date.now();
      for (const [k, t] of seen) if (now - t > 5000) seen.delete(k);
      if (seen.has(key)) return;
      seen.set(key, now);
      onMsg(text);
    };
    function fb() {
      if (stopped) return;
      let first = true;
      fbES = new EventSource(FB + encodeURIComponent(topic) + '.json');
      fbES.addEventListener('put', e => {
        try {
          const { path, data } = JSON.parse(e.data);
          const d = path === '/' ? data : null;
          if (!d || !d.id || d.id === lastId) { first = false; return; }
          const isFirst = first; first = false; lastId = d.id;
          if (isFirst && !(sinceMs && Date.now() - (d.t || 0) < sinceMs)) return; // value that was already there
          deliver(d.m, 'm:' + d.m);
        } catch (err) {}
      });
      fbES.onopen = () => onState && onState('Listening');
      fbES.onerror = () => { onState && onState('Reconnecting…'); if (fbES.readyState === 2) setTimeout(fb, 2000); };
    }
    function ntfy() {
      if (stopped) return;
      nES = new EventSource(NTFY + encodeURIComponent(topic) + '/sse' + (sinceMs ? '?since=' + Math.ceil(sinceMs / 1000) + 's' : ''));
      nES.onmessage = e => { try { const m = JSON.parse(e.data); if (m.event && m.event !== 'message') return; if (typeof m.message === 'string') deliver(m.message, 'm:' + m.message); } catch (err) {} };
      nES.onerror = () => { if (nES.readyState === 2) setTimeout(ntfy, 3000); };
    }
    fb(); ntfy();
    return () => { stopped = true; fbES && fbES.close(); nES && nES.close(); };
  }

  window.PeekRelay = { send, listen };
})();
