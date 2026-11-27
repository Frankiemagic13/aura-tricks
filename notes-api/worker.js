// Notes API — Cloudflare Worker
// Gives your Notes page its own API URL with a key, for apps like the one with "API 1 / URL / Value / GET / POST".
//
// Notes page (any phone)  -> POST /push            {text}        saves what the spectator typed
// Other app (GET)         -> GET  /api?key=KEY     -> {"text": "...", "<Value>": "..."}
// Other app (POST)        -> POST /api?key=KEY     {"field": "typed value"}  saves into "inbox"
// Notes page (any phone)  -> GET  /inbox           reads what the other app sent
// Notifications: set NTFY_TOPIC (secret). When the Notes page sends {text, done:true}
//                (typing stopped for 4 s), the note goes to ntfy.sh/<topic> (iPhone ntfy app).
// Add ?ch=NAME to any address for a separate saved text (the Calculator uses ch=calc).
// Your phone (admin)      -> GET  /admin           -> {url, key}      (header X-Admin-Password)
//                            POST /admin/reset     -> new key, old URL stops at once
//                            POST /admin/clear     -> clears saved note + inbox
//                            POST /admin/mute      {on, ttl} -> no notifications while on (ends by itself after ttl s)

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const fromPages = allowed.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": fromPages ? origin : "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Admin-Password",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const p = url.pathname.replace(/\/$/, "") || "/";
    // Channel: one saved text per page (?ch=calc for the Calculator). Default = Notes.
    const ch = (url.searchParams.get("ch") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
    const NOTE = ch ? "note:" + ch : "note";
    const INBOX = ch ? "inbox:" + ch : "inbox";

    // ---------- Public API for other apps (key in URL) ----------
    if (p === "/api") {
      const key = await getKey(env);
      if (!key || url.searchParams.get("key") !== key) return json({ error: "bad key" }, 401, cors);

      if (req.method === "GET") {
        const note = (await env.STORE.get(NOTE, "json")) || { text: "", at: 0 };
        if (url.searchParams.get("format") === "text") {
          return new Response(note.text, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
        }
        const out = { text: note.text, at: note.at };
        const field = url.searchParams.get("field");
        if (field) out[field] = note.text;
        return json(out, 200, cors);
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        // Takes {"any_field": "typed value"} — first string value wins
        const value = typeof body === "string" ? body : Object.values(body).find((v) => typeof v === "string") || "";
        await env.STORE.put(INBOX, JSON.stringify({ text: value.slice(0, 5000), at: Date.now() }));
        return json({ ok: true }, 200, cors);
      }
      return json({ error: "method" }, 405, cors);
    }

    // ---------- Notes page (only from your GitHub Pages) ----------
    if (p === "/push" && req.method === "POST") {
      if (!fromPages) return json({ error: "origin not allowed" }, 403, cors);
      const body = await readBody(req);
      const text = String((body && body.text) || "").slice(0, 5000);
      await env.STORE.put(NOTE, JSON.stringify({ text, at: Date.now() }));
      let ntfy;
      if (env.NTFY_TOPIC && body && body.done && text.trim()) {
        if (await env.STORE.get("mute")) ntfy = "muted";
        else ntfy = await notify(env, text, String(body.title || "Notes").slice(0, 40));
      }
      return json({ ok: true, ntfy }, 200, cors);
    }

    if (p === "/inbox" && req.method === "GET") {
      if (!fromPages) return json({ error: "origin not allowed" }, 403, cors);
      return json((await env.STORE.get(INBOX, "json")) || { text: "", at: 0 }, 200, cors);
    }

    // ---------- Admin (your phone only) ----------
    if (p.startsWith("/admin")) {
      if (!env.ADMIN_PASSWORD || req.headers.get("X-Admin-Password") !== env.ADMIN_PASSWORD) {
        return json({ error: "wrong admin password" }, 401, cors);
      }
      const base = url.origin + "/api?" + (ch ? "ch=" + ch + "&" : "") + "key=";

      if (p === "/admin" && req.method === "GET") {
        let key = await getKey(env);
        if (!key) { key = newKey(); await env.STORE.put("api_key", key); }
        return json({ key, url: base + key }, 200, cors);
      }
      if (p === "/admin/reset" && req.method === "POST") {
        const key = newKey();
        await env.STORE.put("api_key", key);
        return json({ key, url: base + key }, 200, cors);
      }
      if (p === "/admin/clear" && req.method === "POST") {
        await env.STORE.delete(NOTE);
        await env.STORE.delete(INBOX);
        return json({ ok: true }, 200, cors);
      }
      if (p === "/admin/mute" && req.method === "POST") {
        const body = await readBody(req);
        if (body && body.on) {
          const ttl = Math.min(Math.max(Number(body.ttl) || 300, 60), 3600);
          await env.STORE.put("mute", "1", { expirationTtl: ttl });
        } else await env.STORE.delete("mute");
        return json({ ok: true, mute: !!(body && body.on) }, 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    }

    return new Response("Notes API OK", { headers: cors });
  },
};

// Sends the notification and tries again if ntfy is busy (429/5xx). NTFY_TOKEN (secret, optional) = ntfy access token.
async function notify(env, text, title) {
  const headers = { Title: title || "Notes", Tags: "memo", Priority: "high" };
  if (env.NTFY_TOKEN) headers.Authorization = "Bearer " + env.NTFY_TOKEN;
  let status = 0;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://ntfy.sh/" + encodeURIComponent(env.NTFY_TOPIC), { method: "POST", headers, body: text.slice(0, 3000) });
      status = r.status;
      if (r.ok) return status;
      if (status !== 429 && status < 500) return status;
    } catch (e) { status = -1; }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  console.log("ntfy failed", status);
  return status;
}

async function getKey(env) {
  return env.STORE.get("api_key");
}

function newKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(b, (x) => chars[x % chars.length]).join("");
}

async function readBody(req) {
  const t = await req.text();
  try { return JSON.parse(t); } catch { return t; }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
