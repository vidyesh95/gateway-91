# gateway-91 — Country-Restricted Telegram Group Gatekeeper Bot

> **Ready-made Telegram bot that only lets people from one country into a private group — outsiders are automatically blocked.**

A drop-in **Telegram join-gate / gatekeeper bot** that verifies every user's **phone country code** *and* **GPS location** before granting access to a private Telegram group. Built for **India (+91)** out of the box — change one function to restrict to any other country. Runs free on **Cloudflare Workers** with KV storage.

**If you searched for any of these, this is the repo you want:**

> "telegram bot only allow users from my country" · "restrict telegram group by country" · "telegram group block foreigners / outsiders / non-locals" · "telegram country verification bot" · "telegram phone number country gate" · "telegram location verification join request" · "India-only telegram group bot" · "+91 only telegram group" · "members-only telegram bot country filter" · "geofence telegram group" · "telegram approve join request only verified users"

---

## What it does

Outsiders cannot get in. A user only enters the private group if they pass **two checks**:

1. **Phone country** — must share their *own* Telegram phone number, and it must be **+91 (India)**. Forwarded/other-people's contacts are rejected (anti-spoof).
2. **Location** — must share a GPS point that resolves to **real Indian territory** (bounding-box pre-filter + OpenStreetMap reverse-geocode, fail-closed).

Only after both pass does the bot issue an invite link that creates a **join request**. The bot approves the request **only if that exact `user_id` is verified** — so a leaked or forwarded link gets everyone else **declined**.

```
t.me/<YourBot>?start=join
  └─ /start ........... bot asks for phone (request_contact)
       └─ contact ..... must be sender's OWN number AND +91   → ask location
            └─ location  must be inside India                  → mark verified in KV
                 └─ bot sends invite link (creates_join_request: true)
                      └─ user taps → chat_join_request → bot approves
                         ONLY if user_id is verified in KV  (else declined)
```

## Why this design blocks outsiders

- **Phone is verified by Telegram itself** — it's the real number on the account, so the `+91` country gate is strong.
- **Approval is keyed to `user_id`**, checked against KV on every join request. Sharing the link does not share access.
- **Fail-closed** — any geocode error, timeout, or non-IN answer → rejected.

## Tech stack

| Piece | Choice |
|-------|--------|
| Runtime | Cloudflare Workers (serverless, free tier) |
| Framework | [grammY](https://grammy.dev) (Telegram Bot API) |
| Storage | Workers KV (per-user verification state) |
| Geocoding | OpenStreetMap Nominatim reverse geocode |
| Language | TypeScript |

## Quick start

Full step-by-step in **[SETUP.md](SETUP.md)**. Short version:

```sh
npm install
npx wrangler kv namespace create VERIF      # put id in wrangler.jsonc
npx wrangler secret put BOT_TOKEN           # from @BotFather
npx wrangler secret put WEBHOOK_SECRET      # openssl rand -hex 32
npm run deploy
# then open once: https://<your-worker>.workers.dev/registerWebhook?secret=<WEBHOOK_SECRET>
```

Share the **bot deep link** (not the group link): `https://t.me/<YourBot>?start=join`

## Use it for a different country

All rules live in [src/index.ts](src/index.ts):

| Rule | Where | Change to… |
|------|-------|-----------|
| Phone country code | `isIndiaPhone` | swap `91` prefix + digit length |
| Region / geofence | `INDIA` bbox + `isIndiaCoord` | adjust lat/lng bounds; Nominatim `country_code` check |
| Anti-spoof | `contact.user_id !== ctx.from.id` | keep — blocks forwarded contacts |

So this works equally as a **USA-only**, **UK-only**, **Nigeria-only**, **Brazil-only**, etc. Telegram group gate — just edit the country code and bounding box.

## Honest limitations

- **GPS can be spoofed** by a rooted phone / mock-location app. The location check stops casual out-of-region users, not a determined attacker. No server-side fix exists — platform limitation.
- **Location is captured once** at verification, not live-tracked.
- **KV is eventually consistent** — a just-verified user could hit a rare stale read and be declined; tapping again works. Switch to a Durable Object for strong consistency.

See [SETUP.md](SETUP.md#known-limitations-honest) for details.

## Keywords

telegram bot, telegram gatekeeper, telegram join gate, country restriction, geofencing, location verification, phone number verification, +91 india only, members only group, chat_join_request, approve join request, grammy, cloudflare workers, serverless telegram bot, block outsiders, region-locked telegram group, nationality verification, KV storage, typescript telegram bot, anti-spoof contact

## License

MIT — use it, fork it, ship it.
