# gateway-91 — Setup

A Telegram join-gate bot on Cloudflare Workers. Users must verify a **+91 phone number** and a **location inside India** before they are allowed into a private group. Unverified users can never see group content.

## How the gate works

```
t.me/<YourBot>?start=join
  └─ /start ........... bot asks for phone (request_contact)
       └─ contact ..... verify it's the sender's OWN number AND +91  → ask location
            └─ location  verify point is inside India bbox            → mark verified in KV
                 └─ bot sends an invite link that creates a JOIN REQUEST
                      └─ user taps → Telegram sends chat_join_request → bot approves
                         ONLY if that user_id is verified in KV
```

Why a join request instead of a one-time link: the approval is keyed to the user's `user_id`, checked against KV. Even if a verified user forwards the link, anyone else tapping it is **declined** — they have to verify themselves first.

---

## Prerequisites

- A Telegram account that **owns** (or admins) the target group.
- Cloudflare account + `wrangler` (already a dev dependency).

---

## 1. Create the bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **token**.
2. `/setjoingroups` → **Enable** (lets the bot be added to groups).
3. Optional: `/setprivacy` → **Disable** is *not* needed; the bot only reacts to private chats and join requests.

## 2. Configure the group

1. Make the group **Private** (Group → Edit → Group Type → Private). This is what hides content from non-members.
2. Add your bot to the group.
3. Promote the bot to **Admin** with at least:
   - **Invite Users via Link**
   - **Add Members** (needed to approve join requests)

## 3. Get the group chat id

1. With the bot already in the group, send any message in the group.
2. Open in a browser (replace `<TOKEN>`):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Find `"chat":{"id":-100XXXXXXXXXX, ...}`. That negative number is your `GROUP_CHAT_ID`.
4. Put it in [wrangler.jsonc](wrangler.jsonc) under `vars.GROUP_CHAT_ID`.

## 4. Create the KV namespace

```sh
npx wrangler kv namespace create VERIF
```

Copy the returned `id` into [wrangler.jsonc](wrangler.jsonc) → `kv_namespaces[0].id` (replace `PUT_KV_NAMESPACE_ID_HERE`).

## 5. Set secrets

```sh
npx wrangler secret put BOT_TOKEN        # paste the BotFather token
npx wrangler secret put WEBHOOK_SECRET   # paste any long random string
```

> Tip for a random secret: `openssl rand -hex 32`

## 6. Deploy

```sh
npm run deploy
```

Note the deployed URL, e.g. `https://gateway-91.<your-subdomain>.workers.dev`.

## 7. Register the webhook

The bot needs the **non-default** `chat_join_request` update, so don't use a plain `setWebhook`. Two options:

**Option A — built-in helper route** (easiest):

```
https://gateway-91.<your-subdomain>.workers.dev/registerWebhook?secret=<WEBHOOK_SECRET>
```

Open that URL once in a browser. It registers the webhook with the correct `allowed_updates` and secret token.

**Option B — manual curl:**

```sh
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  --data-urlencode "url=https://gateway-91.<your-subdomain>.workers.dev/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["message","chat_join_request"]'
```

Verify:

```sh
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## 8. Share the entry link

Give users the **bot deep link**, not the group link:

```
https://t.me/<YourBot>?start=join
```

---

## Local development

```sh
npm run dev
```

For webhooks against local dev you need a public tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) and point `setWebhook` at the tunnel URL. KV in dev uses a local simulation; verification state won't match production.

---

## Verification rules (where to tweak)

All in [src/index.ts](src/index.ts):

| Rule | Function / constant | Change it to… |
|------|--------------------|----------------|
| Phone country | `isIndiaPhone` | edit the `91` prefix / digit-length check |
| Region | `INDIA` bbox + `inIndia` | adjust lat/lng bounds, or swap in a reverse-geocoder |
| Anti-spoof | `contact.user_id !== ctx.from.id` check | keep — blocks forwarded contacts |

---

## Known limitations (honest)

- **GPS can be spoofed.** Telegram sends whatever point the device reports. A rooted/jailbroken phone or a mock-location app can fake being inside India. The bbox check stops casual/accidental out-of-region users, not a determined spoofer. There is **no server-side fix** for this — it's a platform limitation.
- **Location is a one-time point**, not live tracking. We capture it once at verification.
- **Phone is genuinely verified by Telegram** (it's the number on the account), so the `+91` gate is strong; only VoIP/foreign numbers registered to Telegram could slip past the country check, and those still need a real Telegram account.
- **KV is eventually consistent.** A user who verifies and *immediately* taps the join link could, in rare cases, hit a stale read and be declined. They can just tap again. If this matters, switch `VERIF` to a Durable Object for strong consistency.
