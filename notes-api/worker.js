// Notes API — Cloudflare Worker
// Gives your Notes page its own API URL with a key, for apps like the one with "API 1 / URL / Value / GET / POST".
//
// Notes page (any phone)  -> POST /push            {text}        saves what the spectator typed
// Other app (GET)         -> GET  /api?key=KEY     -> {"text": "...", "<Value>": "..."}
// Other app (POST)        -> POST /api?key=KEY     {"field": "typed value"}  saves into "inbox"
// Notes page (any phone)  -> GET  /inbox           reads what the other app sent
// Notifications: set NTFY_TOPIC (secret). When the Notes page sends {text, done:true}
//                (typing stopped for 4 s), the note goes to ntfy.sh/<topic> (iPhone ntfy app).
// Your phone (admin)      -> GET  /admin           -> {url, key}      (header X-Admin-Password)
//                            POST /admin/reset     -> new key, old URL stops at once
//                            POST /admin/clear     -> clears saved note + inbox

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

    // ---------- Public API for other apps (key in URL) ----------
    if (p === "/api") {
      const key = await getKey(env);
      if (!key || url.searchParams.get("key") !== key) return json({ error: "bad key" }, 401, cors);

      if (req.method === "GET") {
        const note = (await env.STORE.get("note", "json")) || { text: "", at: 0 };
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
        await env.STORE.put("inbox", JSON.stringify({ text: value.slice(0, 5000), at: Date.now() }));
        return json({ ok: true }, 200, cors);
      }
      return json({ error: "method" }, 405, cors);
    }

    // ---------- Notes page (only from your GitHub Pages) ----------
    if (p === "/push" && req.method === "POST") {
      if (!fromPages) return json({ error: "origin not allowed" }, 403, cors);
      const body = await readBody(req);
      const text = String((body && body.text) || "").slice(0, 5000);
      await env.STORE.put("note", JSON.stringify({ text, at: Date.now() }));
      if (env.NTFY_TOPIC && body && body.done && text.trim()) ctx.waitUntil(notify(env, text));
      return json({ ok: true }, 200, cors);
    }

    if (p === "/inbox" && req.method === "GET") {
      if (!fromPages) return json({ error: "origin not allowed" }, 403, cors);
      return json((await env.STORE.get("inbox", "json")) || { text: "", at: 0 }, 200, cors);
    }

    // ---------- Admin (your phone only) ----------
    if (p.startsWith("/admin")) {
      if (!env.ADMIN_PASSWORD || req.headers.get("X-Admin-Password") !== env.ADMIN_PASSWORD) {
        return json({ error: "wrong admin password" }, 401, cors);
      }
      const base = url.origin + "/api?key=";

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
        await env.STORE.delete("note");
        await env.STORE.delete("inbox");
        return json({ ok: true }, 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    }

    return new Response("Notes API OK", { headers: cors });
  },
};

async function notify(env, text) {
  await fetch("https://ntfy.sh/" + encodeURIComponent(env.NTFY_TOPIC), {
    method: "POST",
    headers: { Title: "Notes", Tags: "memo", Priority: "high" },
    body: text.slice(0, 3000),
  }).catch(() => {});
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
