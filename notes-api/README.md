# Notes API (Cloudflare Worker)

Gives the Notes page its own API URL with a key: `https://WORKER/api?key=KEY`.
Other apps GET it (Value: `text`) to get what the spectator typed.
No secret is in this folder. The key and the admin password live only in Cloudflare.

## Set up in the Cloudflare dashboard (works on iPhone)
1. Go to dash.cloudflare.com. Make a free account (no card).
2. **Storage & Databases > KV > Create**. Name: `notes-api-store`.
3. **Compute > Workers & Pages > Create > Start with Hello World**. Name: `notes-api`. Tap **Deploy**.
4. Tap **Edit code**. Delete all the code. Paste all of `worker.js` from this folder. Tap **Deploy**.
5. **Settings > Bindings > Add > KV namespace**. Variable name: `STORE`. Namespace: `notes-api-store`.
6. **Settings > Variables and Secrets > Add**:
   - Type Text: `ALLOWED_ORIGINS` = `https://frankiemagic13.github.io`
   - Type Secret: `ADMIN_PASSWORD` = a password you choose
   Tap **Deploy**.
7. Copy the Worker address (`https://notes-api.<you>.workers.dev`).
   Put it in `DEFAULT_WORKER` at the top of `/notes-api.js` (spectator phones need it there).

## Or with Terminal on the Mac
`npx wrangler login`, `npx wrangler kv namespace create STORE` (put the id in wrangler.toml),
`npx wrangler secret put ADMIN_PASSWORD`, `npx wrangler deploy`.

## Use
Notes > Settings > **API**: type the admin password once, tap **Copy URL**, paste it in the other app.
**Reset key** = new URL, the old URL stops at once. **Clear saved note** after a show.
URL options: `&format=text` (only the words), `&field=NAME` (also send the text under NAME).

## Free plan
100,000 requests and 1,000 saves a day. The Notes page saves only 1.5 s after typing stops.

## Notifications (ntfy)
1. Install the free ntfy app on the iPhone. Subscribe to a topic name that is hard to guess.
2. In Cloudflare: notes-api > Settings > Variables and secrets > Add: Secret `NTFY_TOPIC` = that topic name.
3. The Notes page tells the Worker when typing stopped for 4 s; then one notification comes.
One notification comes when the spectator stops typing.
