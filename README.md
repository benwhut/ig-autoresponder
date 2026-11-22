# Instagram Comment → DM Autoresponder

A single-tenant, zero-cost Instagram comment autoresponder that runs entirely on **Cloudflare Workers + D1 + Cron Triggers**, with a password-protected admin dashboard served by the Worker itself.

When someone comments a keyword on your post or reel, the Worker sends a private reply. In the default **two-step opt-in** mode it asks the user to reply first, then delivers the clean `https://` link in a second DM — so the link is clickable even when the first message lands in Message Requests. A **direct link** mode sends everything in the first private reply.

No Facebook Page is required for the Instagram Login (`IGAA…`) flow; Meta Business/System User (`EAA…`) tokens are also supported. No OAuth SaaS onboarding, no Redis, no external queue, no third-party hosting.

---

## What it does

- **Webhook ingestion** — `GET /webhook` verification + `POST /webhook` with `X-Hub-Signature-256` HMAC verification.
- **Rule matching** — keywords are matched as whole words/phrases, case- and punctuation-insensitive. Rules can target **all posts** or **specific posts/reels**.
- **Rule precedence** — post-specific rules always beat global rules; then `priority DESC`, then `updated_at DESC`.
- **Two delivery modes** — `two_step_opt_in` (default) and `direct_link`.
- **Optional public comment replies** — a random variant from a list, posted 3 seconds after the private reply.
- **D1 job queue** — idempotent enqueue, atomic claim, exponential backoff, 1-minute cron safety net, plus an inline drain on webhook receipt so DMs go out in ~1–2 seconds.
- **Encrypted token storage** — the Instagram token (IGAA… or EAA…) is encrypted with AES-256-GCM (Web Crypto) before it touches D1.
- **Token host auto-detection** — `IGAA…` tokens use `graph.instagram.com`; `EAA…` Business/System User tokens use `graph.facebook.com` and are resolved to an Instagram business account.
- **Zero-touch token refresh** — a daily cron refreshes 60-day IGAA tokens when they have less than 30 days left. Non-expiring EAA System User tokens are left alone and shown as “Never expires”.
- **Admin dashboard** — rules CRUD, post sync + visual picker, token health/rotation, searchable delivery logs, failed-job retry.

---

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Cloudflare Workers (free plan) |
| Router | Hono (small, no Node dependencies) |
| Database | Cloudflare D1 (SQLite) |
| Validation | Zod |
| Tests | Vitest + Node's built-in `node:sqlite` as a D1-compatible adapter |
| UI | One self-contained HTML document with inline CSS/vanilla JS, no CDN |

```
.
├── wrangler.toml
├── .dev.vars.example
├── migrations/
│   ├── 0001_init.sql
│   ├── 0002_recipient_igsid.sql
│   └── 0003_webhook_events.sql
├── src/
│   ├── index.ts          # HTTP router, webhook, admin API, scheduled handler
│   ├── meta.ts           # HMAC, Graph API client, AES-GCM token storage, refresh
│   ├── matcher.ts        # keyword matching + rule precedence
│   ├── queue.ts          # D1 job queue, claim, retry/backoff, state transitions
│   ├── auth.ts           # admin session cookie + login throttle
│   ├── admin-ui.ts       # self-contained dashboard HTML/CSS/JS
│   └── types.ts          # shared interfaces + Zod schemas
├── tests/
│   ├── webhook.test.ts
│   ├── matcher.test.ts
│   ├── flow.test.ts
│   ├── meta.test.ts
│   ├── inbound-dm.test.ts
│   ├── auth.test.ts
│   ├── ui.test.ts
│   ├── helpers.ts
│   └── d1.ts
└── README.md
```

---

## 1. Meta app setup

You need an **Instagram professional account** (Business or Creator). No Facebook Page is required.

1. Open <https://developers.facebook.com/apps> → **Create app** → **Business** → give it a name.
2. In the app dashboard, add the **Instagram** product → **API setup with Instagram business login**.
3. Request/confirm these permissions:
   - `instagram_business_basic`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`
4. Generate the token:
   - Instagram → **API setup with Instagram business login** → **Generate access tokens**
   - Log in with the Instagram account and authorize.
   - Copy the **long-lived Instagram User Access Token** (starts with `IGAA…`, valid ~60 days).
   - Alternatively, paste a **Meta Business / System User Access Token** (starts with `EAA…`). The Worker detects the prefix: `IGAA…` uses `graph.instagram.com`, anything else uses `graph.facebook.com`. EAA tokens are resolved to an Instagram business account via `/me/assigned_instagram_accounts` (falling back to `/me/accounts`), and System User tokens that never expire are stored without an expiry date.
5. Copy the **Instagram App Secret**:
   - Instagram product → **API setup with Instagram business login** → **App secret**
   - This is the secret Meta uses to sign Instagram webhook payloads. It is usually *not* the Facebook App Secret under App settings → Basic.
6. Configure the webhook **after deploying the Worker** (step 3):
   - Instagram → **Webhooks** → **Callback URL**: `https://<your-worker>.workers.dev/webhook`
   - **Verify token**: the same value you set for `WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **`comments`** and **`messages`** fields.

### Development mode vs. Live

While the app is in **Development** mode, only Instagram accounts with a role on the app can use it:

- App dashboard → **App roles** → **Roles** → **Instagram testers** → add your Instagram username.
- Accept the tester invite from the Instagram account (Settings → Apps and websites → Tester invites).

For use by accounts you do not own, request **Advanced Access** for the three permissions in **App Review** and switch the app to **Live**. This project is intentionally single-tenant, so the simplest setup is your own professional account + Development mode.

---

## 2. Cloudflare setup

### Create the D1 database

```bash
npm install
npx wrangler login
npx wrangler d1 create ig_autoresponder
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ig_autoresponder"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "migrations"
```

### Apply the schema

```bash
npx wrangler d1 migrations apply DB --remote
```

(Applies every file in `migrations/` in order, including `0002_recipient_igsid.sql` (opt-in recipient id) and `0003_webhook_events.sql` (webhook diagnostics).)

### Set secrets

```bash
npx wrangler secret put IG_APP_SECRET
npx wrangler secret put WEBHOOK_VERIFY_TOKEN
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

Generate values:

```bash
openssl rand -hex 32       # WEBHOOK_VERIFY_TOKEN
openssl rand -hex 32       # SESSION_SECRET
openssl rand -base64 32    # TOKEN_ENCRYPTION_KEY (must decode to exactly 32 bytes)
```

`TOKEN_ENCRYPTION_KEY` must be exactly 32 bytes, base64 encoded. If you lose or change it, the stored token can no longer be decrypted — paste a new token in the dashboard.

`GRAPH_API_VERSION` is a plain variable in `wrangler.toml` (default `v25.0`).

### Deploy

```bash
npx wrangler deploy
```

### First-run checklist

1. Open `https://<your-worker>.workers.dev/admin` and sign in with `ADMIN_PASSWORD`.
2. Click **Set token**, paste the token, and save. `IGAA…` tokens are validated with `GET /me` on `graph.instagram.com`; `EAA…` tokens are resolved to an Instagram business account on `graph.facebook.com`. The account id/username and token type are stored and the token is encrypted.
3. Go to **Posts** → **Sync recent posts** (pulls the latest 25 posts/reels via `GET /{ig_user_id}/media` on Facebook Graph, or `GET /me/media` on Instagram Graph).
4. Create a rule:
   - Target: **All posts** or **Selected posts**
   - Trigger: **Specific keywords** (e.g. `link`, `guide`, `pdf`) or **Any comment**
   - Delivery: **Two-step opt-in** (recommended) or **Direct link**
   - Step 1 message, Step 2 link message, optional opt-in keywords
   - Optional public reply variants
5. Set the Meta webhook callback to `https://<your-worker>.workers.dev/webhook`, subscribe to `comments` and `messages`, then comment on a post to test.

---

## 3. Local development

```bash
cp .dev.vars.example .dev.vars
# fill in the five values; keep GRAPH_API_VERSION=v25.0

npm run db:migrate:local
npm run dev
```

Open <http://localhost:8787/admin>.

`wrangler dev` reads `.dev.vars`. Local D1 state lives in `.wrangler/state` and is safe to delete to start fresh.

### Testing webhooks locally

Expose the local server with a tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
```

Use the tunnel URL as the Meta callback (`https://<tunnel>.trycloudflare.com/webhook`).

To send a signed webhook manually:

```bash
BODY='{"object":"instagram","entry":[]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$IG_APP_SECRET" | awk '{print $2}')"

curl -i -X POST http://localhost:8787/webhook \
  -H 'content-type: application/json' \
  -H "x-hub-signature-256: $SIG" \
  --data "$BODY"
```

A valid request returns `EVENT_RECEIVED`. A bad signature returns `401` and logs `webhook signature verification failed`.

### Webhook payload shapes

Meta delivers Instagram DMs in two shapes; the Worker normalises both into one handler:

| Shape | Typical source | Event object |
| --- | --- | --- |
| `entry[].messaging[]` | Instagram Login, some Page-linked deliveries | `{ sender, recipient, message }` |
| `entry[].changes[]` with `field: "messages"` | Facebook Graph / Page-linked Instagram | `{ value: { sender, recipient, message } }` |

`object` may be `"instagram"` or `"page"`. Comments continue to arrive as `entry[].changes[]` with `field: "comments"`.

Every delivery logs `webhook received <json>` and each DM decision logs `inbound dm { senderId, recipientId, text, matchedSessionId, reason, source, entryId }`. Recent payloads and decisions are stored in `webhook_events` and returned by `GET /admin/api/logs` as `events` (last 50, pruned after 7 days), so you can inspect them without `wrangler tail`.

---

## 4. How matching works

For every top-level comment (replies to comments are ignored):

1. Ignore comments written by the account itself.
2. If `comment_id` already exists in `comment_executions`, stop — webhook retries are no-ops.
3. Resolve the rule:
   - Enabled rules that target this exact `media_id`, sorted by `priority DESC, updated_at DESC`
   - Then enabled `all_posts` rules, same ordering
4. Match the comment text:
   - `any_keyword`: normalized text must contain the keyword/phrase as whole words
   - `any_comment`: every top-level comment matches
5. Insert the execution row + `private_reply` job (+ `public_reply` job with `run_after = now + 3s` if variants exist) in one D1 batch.

Keyword normalization lowercases, applies Unicode NFKC, and replaces punctuation runs with spaces:

- `link` matches `send the link!`, `LINK`, `#link`
- `link` does **not** match `blinking`, `hyperlink`, `linked`
- `free guide` matches `send me the FREE GUIDE!!`, not `free guides`

---

## 5. Delivery modes

### Two-step opt-in (default)

1. Comment matches → private reply with `initial_dm_text` (no link, just “reply YES”).
2. Meta’s response (`{ recipient_id, message_id }`) is captured and stored as `recipient_igsid` next to the comment’s `commenter_igsid`. Execution state becomes `awaiting_opt_in`; `private_reply_sent_at` is recorded.
3. When the user DMs you within 24 hours, the inbound `messaging.sender.id` is matched against **either** `recipient_igsid` or `commenter_igsid` (they are usually the same, but not guaranteed):
   - If `opt_in_keywords` is empty, any text reply counts.
   - Otherwise the reply must contain one of the keywords as a whole word.
   - Echoes (`message.is_echo === true`) and textless events are ignored. Each decision logs `inbound dm { senderId, recipientId, text, matchedSessionId, reason }` for `wrangler tail`.
4. The execution becomes `completed` and a `followup_dm` job sends `followup_dm_text` with the clean link via `POST /{ig_user_id}/messages` and `{ recipient: { id: senderId } }`.

This is the recommended mode: the first DM can land in Message Requests (where links are not clickable), but the user’s reply opens a normal 24-hour messaging window, so the second DM is fully interactive.

### Direct link

The first private reply contains the link and the execution is marked `completed` immediately.

Meta limits private replies to **one per comment** and **7 days after the comment**. The queue sends immediately, so this is not usually an issue.

---

## 6. Token lifecycle

### Host selection

The token prefix picks the Graph host:

| Prefix | Host | Account resolution |
| --- | --- | --- |
| `IGAA…` | `https://graph.instagram.com` | `GET /me?fields=user_id,username` |
| `EAA…` (or anything else) | `https://graph.facebook.com` | `GET /me/assigned_instagram_accounts?fields=id,username`, then `GET /me/accounts?fields=instagram_business_account{id,username}` |

For Facebook Graph tokens the Worker sends media sync, private replies and follow-up DMs to `/{ig_user_id}/…` instead of `/me/…`. Public comment replies always use `POST /{comment_id}/replies`.

### Storage and refresh

- The token is stored in `system_config` as AES-256-GCM ciphertext: `v1.<iv>.<ciphertext>`.
- `IGAA…` tokens get `expires_at = now + 60 days`. `EAA…` tokens are inspected with `GET /debug_token`; when `data.expires_at` is `0` or missing (System User tokens), `expires_at` is stored as `null` and the dashboard shows **Never expires**.
- The daily cron (`0 6 * * *`) calls `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` only when:
  - the token is an `IGAA…` (Instagram Graph) token, **and**
  - `expires_at` is set, **and**
  - the token expires in less than 30 days, **and**
  - the token was stored at least 24 hours ago (Meta rejects younger tokens).
- EAA… Business/System User tokens are never refreshed by the Worker; they are managed in Meta Business Suite. The **Refresh token** button explains this instead of calling Meta.
- The **Refresh token** button forces an IGAA refresh immediately. Meta may reject it if the token is less than 24 hours old; the error is shown in the dashboard.

The queue cron runs every minute (`* * * * *`) as a safety net for retries and the delayed public reply. Both cron expressions are in `wrangler.toml`.

---

## 7. Queue, retries and errors

`outbound_jobs` is a D1-backed queue:

- Atomic claim with `UPDATE ... RETURNING`, so two Workers cannot process the same job.
- `attempts` increments on claim; `max_attempts = 5`.
- Retryable errors (HTTP 429, 5xx, network failures, Meta temporary codes `1, 2, 4, 17, 32, 341, 613`) are retried with `30s * 2^attempts` (capped at 1 hour, ±10% jitter).
- Permanent 4xx errors (expired window, already replied, deleted comment, invalid token) mark the job `failed` and record Meta’s message in `last_error`.
- Jobs stuck in `processing` for more than 5 minutes are reclaimed on the next drain.
- The Activity tab shows failures and a **Retry** button that requeues all failed jobs for that comment.

Private reply failures set the execution to `failed`. Public reply failures only change `public_reply_status`. Follow-up failures mark the execution `failed` so it is visible.

---

## 8. Admin dashboard

- `/admin` — login page when signed out, dashboard when signed in.
- Session: HMAC-SHA256 signed cookie, `HttpOnly`, `SameSite=Strict`, `Secure` (omitted on localhost), 7 days.
- Failed logins: 5 attempts per 10 minutes → 15-minute lockout (in-memory, per Worker isolate).
- Mutating admin API routes require `Content-Type: application/json` as a CSRF defense.
- All `/admin/api/*` routes return `401` without a valid session.
- Dashboard pages send a strict CSP with no external origins.

### API summary

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Token status + queued job count |
| `GET` | `/webhook` | Meta verification handshake |
| `POST` | `/webhook` | Signed event ingestion |
| `POST` | `/admin/login` | Password login (form or JSON) |
| `POST` | `/admin/logout` | Clear session |
| `GET` | `/admin/api/state` | Account, token health, counts |
| `POST` | `/admin/api/token` | Validate + store a new token |
| `POST` | `/admin/api/token/refresh` | Force a refresh |
| `GET/POST` | `/admin/api/rules` | List / create rules |
| `PUT/DELETE` | `/admin/api/rules/:id` | Update / delete |
| `POST` | `/admin/api/rules/:id/toggle` | Enable / pause |
| `POST` | `/admin/api/media/sync` | Pull latest 25 posts |
| `GET` | `/admin/api/media` | Cached posts |
| `GET` | `/admin/api/logs` | Search/filter executions |
| `POST` | `/admin/api/comments/:id/retry` | Requeue failed jobs |

---

## 9. Free-tier footprint

- Workers: 100k requests/day. A busy account with 1,000 comments/day uses a few thousand requests including the 1,440 daily cron ticks.
- D1 reads: 5M/day. One comment costs roughly 4 reads (account, duplicate check, rules, insert checks) plus the queue claim.
- D1 writes: 100k/day. One matched comment costs ~5 writes (execution + jobs + queue updates); unmatched comments cost 1.
- No paid queues, KV, R2, or external services.

The schema intentionally keeps rows small; prune `comment_executions` periodically if you process a very high volume:

```sql
DELETE FROM comment_executions WHERE created_at < datetime('now', '-90 days');
```

---

## 10. Security notes

- Webhook requests are rejected unless `X-Hub-Signature-256` matches `HMAC-SHA256(IG_APP_SECRET, rawBody)` (constant-time compare).
- The verify-token handshake uses a constant-time comparison of SHA-256 digests.
- The admin password is compared the same way.
- The Instagram token is encrypted at rest with AES-256-GCM and a random 12-byte IV per write.
- Session cookies are signed, not encrypted — they contain only `{sub, iat, exp}`.
- The dashboard uses no CDNs, no external fonts, and escapes all user/Meta-provided text.
- Keep `/admin` behind a strong password. For extra protection, put Cloudflare Access in front of `/admin*`.

---

## 11. Scripts

```bash
npm run dev              # wrangler dev
npm test                 # vitest run
npm run test:watch       # vitest
npm run typecheck        # tsc --noEmit
npm run deploy           # wrangler deploy
npm run db:migrate:local # apply schema to local D1
npm run db:migrate:remote
```

The test suite uses Node's built-in SQLite through a small D1 adapter, so it exercises real SQL (`ON CONFLICT`, `RETURNING`, batches) without downloading a Workers runtime. 86 tests cover:

- HMAC signature verification, handshake, echo filtering, duplicate comment idempotency
- whole-word/phrase keyword matching, post-specific vs. global precedence, priority ordering
- two-step opt-in transitions, opt-in keywords, 24-hour window, duplicate DM suppression
- private-reply `recipient_id` capture, inbound DM matching on either id, structured skip/match logs
- both DM webhook shapes (`entry[].messaging[]` and `entry[].changes[]` with `field: "messages"`), `object: "page"` deliveries
- cron-drain Step 1 capture, `/admin/api/logs` webhook events, signature-failure logging
- direct-link mode, public reply variants, retry/backoff, permanent-error handling
- login throttling, session tampering, CSRF guard, token encryption at rest, media sync
- EAA token resolution (`/me/assigned_instagram_accounts`, `/me/accounts` fallback), `/{ig_user_id}/messages` routing, non-expiring System User tokens
- dashboard script syntax + no external dependencies

---

## 12. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `GET /webhook` returns 403 | `WEBHOOK_VERIFY_TOKEN` does not match the Meta webhook config |
| `POST /webhook` returns 401 | Wrong `IG_APP_SECRET` (use the **Instagram App Secret**), or a proxy changed the body |
| No webhook events | Subscribe to `comments` and `messages`; app must be Live or the account added as an Instagram tester; account must be professional |
| No DMs sent | Check Activity → error. Common: token missing/expired, private reply already used, comment older than 7 days, 24-hour window closed |
| Step 1 arrives but replying “YES” does nothing | Check `wrangler tail` for `inbound dm`. `reason: "no_pending_opt_in"` means the reply did not match the 24-hour session; `reason: "no_text"`/`"echo"` means Meta sent a non-text or echo event. Recent payloads are in `GET /admin/api/logs` under `events` (run migration `0003`) |
| `/admin/api/logs` has no `events` | Apply `npx wrangler d1 migrations apply DB --remote` for `0003_webhook_events.sql` |
| Links are not clickable | Expected for the first DM to non-followers. Use two-step opt-in |
| Token refresh returns 400 | Token is less than 24 hours old, already refreshed, or invalid. Paste a new token |
| “Business/System User tokens do not support refresh” | Expected for EAA tokens. Manage them in Meta Business Suite; the Worker does not refresh them |
| “No Instagram Business account was found” | The EAA token cannot see an Instagram professional account. Check the token's assets/permissions in Meta Business Suite |
| `no such table` | Run `wrangler d1 migrations apply DB --remote` |
| `TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes` | Regenerate with `openssl rand -base64 32` |
| Login redirects back to the form | Cookies blocked, `SESSION_SECRET` changed, or accessing over plain HTTP on a non-localhost host |
| Admin API returns 415 | Send `Content-Type: application/json` |
| Public reply arrives late | It is scheduled at +3s and sent by the 1-minute cron, so allow up to ~60s |
| Token shows “expired” | Paste a fresh token in **Set token** |

### Changing the Graph API version

If Meta retires `v25.0`, update the `GRAPH_API_VERSION` variable in `wrangler.toml` and redeploy. The refresh endpoint is unversioned by design.

### Limitations

- Single tenant: one Instagram account per deployment.
- The login throttle is in-memory per Worker isolate; it is a basic speed bump, not a distributed rate limiter.
- Media cache is refreshed manually (or by the dashboard’s sync button); old cached posts remain selectable.
- Instagram API rate limits and messaging policies still apply.
- Public replies are sent by the cron, so their timing is approximate.

---

## License

Private project. Use at your own risk; Instagram/Meta platform policies apply.
