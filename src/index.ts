import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import { dashboardPage, loginPage } from "./admin-ui";
import {
  SESSION_COOKIE,
  checkLoginThrottle,
  checkPassword,
  clearSessionCookie,
  issueSession,
  parseCookies,
  recordLoginFailure,
  resetLoginFailures,
  sessionCookie,
  verifySession,
} from "./auth";
import { findMatchingKeyword, pickRule } from "./matcher";
import {
  GraphApiError,
  cacheMedia,
  connectToken,
  fetchRecentMedia,
  getAccount,
  getToken,
  getTokenStatus,
  refreshToken,
  timingSafeEqualString,
  verifyWebhookSignature,
} from "./meta";
import { drainQueue, enqueueJob, retryFailedJobsForComment } from "./queue";
import {
  EXECUTION_STATES,
  ruleInputSchema,
  toRule,
  tokenInputSchema,
} from "./types";
import type {
  CommentExecutionRow,
  Env,
  ExecutionState,
  MediaRow,
  RuleRow,
} from "./types";

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

const app = new Hono<AppEnv>();

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function useSecureCookie(c: AppContext): boolean {
  return !isLocalHost(new URL(c.req.url).hostname);
}

async function readSession(c: AppContext) {
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  return verifySession(c.env, cookies[SESSION_COOKIE]);
}

function zodMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) =>
        issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      )
      .join("; ");
  }
  return error instanceof Error ? error.message : "Invalid request";
}

function adminError(c: AppContext, error: unknown) {
  if (error instanceof GraphApiError) return c.json({ error: error.message }, 400);
  if (error instanceof z.ZodError) return c.json({ error: zodMessage(error) }, 400);
  if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
  if (error instanceof Error && /TOKEN_ENCRYPTION_KEY|SESSION_SECRET|not configured/.test(error.message)) {
    return c.json({ error: error.message }, 500);
  }
  throw error;
}

const PAGE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readSession(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await next();
};

const requireJsonBody: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return c.json({ error: "Expected application/json" }, 415);
    }
  }
  await next();
};

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
});

app.use("/admin/api/*", requireAdmin);
app.use("/admin/api/*", requireJsonBody);

/* ------------------------------------------------------------------ */
/* Public routes                                                       */
/* ------------------------------------------------------------------ */

app.get("/", (c) => c.redirect("/admin"));

app.get("/health", async (c) => {
  try {
    const [token, queue] = await Promise.all([
      getTokenStatus(c.env),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_jobs WHERE status = 'queued'").first<{
        n: number;
      }>(),
    ]);
    return c.json({ ok: true, token, queued_jobs: queue?.n ?? 0 });
  } catch (error) {
    console.error("Health check failed", error);
    return c.json({ ok: false }, 500);
  }
});

/* ------------------------------------------------------------------ */
/* Webhook verification (GET)                                          */
/* ------------------------------------------------------------------ */

app.get("/webhook", async (c) => {
  const mode = c.req.query("hub.mode");
  const verifyToken = c.req.query("hub.verify_token") ?? "";
  const challenge = c.req.query("hub.challenge") ?? "";
  const expected = c.env.WEBHOOK_VERIFY_TOKEN ?? "";

  if (
    mode === "subscribe" &&
    expected.length > 0 &&
    (await timingSafeEqualString(verifyToken, expected))
  ) {
    return c.text(challenge, 200);
  }
  return c.text("Forbidden", 403);
});

/* ------------------------------------------------------------------ */
/* Webhook ingestion (POST)                                            */
/* ------------------------------------------------------------------ */

app.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;

  if (!(await verifyWebhookSignature(rawBody, signature, c.env.IG_APP_SECRET ?? ""))) {
    return c.text("Invalid signature", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.text("Invalid JSON", 400);
  }

  try {
    await processWebhook(c.env, asObject(payload));
  } catch (error) {
    console.error("Webhook processing failed", error);
    return c.text("Processing error", 500);
  }

  // Send DMs in ~1s instead of waiting for the 1-minute cron tick.
  c.executionCtx.waitUntil(
    drainQueue(c.env)
      .then((stats) => {
        if (stats.claimed > 0) console.log("inline queue drain", stats);
      })
      .catch((error) => console.error("inline queue drain failed", error)),
  );

  return c.text("EVENT_RECEIVED", 200);
});

async function processWebhook(env: Env, payload: Record<string, unknown>): Promise<void> {
  if (payload.object !== "instagram") return;

  const account = await getAccount(env);
  const configuredOwner = account?.user_id ?? null;
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const rawEntry of entries) {
    const entry = asObject(rawEntry);
    const ownerId = configuredOwner ?? (asString(entry.id) || null);

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = asObject(rawChange);
      if (change.field === "comments") {
        await handleComment(env, asObject(change.value), ownerId);
      }
    }

    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of messaging) {
      await handleMessage(env, asObject(rawEvent), ownerId);
    }
  }
}

async function recordIgnored(
  env: Env,
  input: {
    commentId: string;
    mediaId: string;
    commenterIgsid: string;
    username: string | null;
    text: string;
    reason: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO comment_executions
       (comment_id, media_id, commenter_igsid, commenter_username, comment_text, rule_id, state,
        private_reply_sent_at, opt_in_completed_at, public_reply_status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'ignored', NULL, NULL, 'none', ?, ?, ?)
     ON CONFLICT(comment_id) DO NOTHING`,
  )
    .bind(
      input.commentId,
      input.mediaId,
      input.commenterIgsid,
      input.username,
      input.text,
      input.reason,
      now,
      now,
    )
    .run();
}

async function handleComment(
  env: Env,
  value: Record<string, unknown>,
  ownerId: string | null,
): Promise<void> {
  const commentId = asString(value.id);
  if (!commentId) return;

  const from = asObject(value.from);
  const commenterIgsid = asString(from.id);
  const username = asString(from.username) || null;
  const text = typeof value.text === "string" ? value.text : "";
  const mediaId = asString(asObject(value.media).id);
  const parentId = asString(value.parent_id);

  // Ignore the account's own comments (echo / loop prevention).
  if (!commenterIgsid || (ownerId !== null && commenterIgsid === ownerId)) return;

  // Only top-level comments trigger automations.
  if (parentId) {
    await recordIgnored(env, {
      commentId,
      mediaId,
      commenterIgsid,
      username,
      text,
      reason: "reply_to_comment",
    });
    return;
  }

  // Strict idempotency: a duplicate webhook delivery is a no-op.
  const existing = await env.DB.prepare(
    "SELECT comment_id FROM comment_executions WHERE comment_id = ?",
  )
    .bind(commentId)
    .first();
  if (existing) return;

  const ruleRows = await env.DB.prepare("SELECT * FROM rules WHERE enabled = 1").all<RuleRow>();
  const rules = (ruleRows.results ?? []).map(toRule);
  const rule = pickRule(rules, mediaId, text);

  if (!rule) {
    await recordIgnored(env, {
      commentId,
      mediaId,
      commenterIgsid,
      username,
      text,
      reason: "no_matching_rule",
    });
    return;
  }

  const now = new Date();
  const nowString = now.toISOString();
  const publicVariants = rule.public_replies.filter((reply) => reply.trim().length > 0);
  const chosenPublicReply =
    publicVariants.length > 0
      ? (publicVariants[Math.floor(Math.random() * publicVariants.length)] as string)
      : null;

  const statements = [
    env.DB.prepare(
      `INSERT INTO comment_executions
         (comment_id, media_id, commenter_igsid, commenter_username, comment_text, rule_id, state,
          private_reply_sent_at, opt_in_completed_at, public_reply_status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'matched_queued', NULL, NULL, ?, NULL, ?, ?)
       ON CONFLICT(comment_id) DO NOTHING`,
    ).bind(
      commentId,
      mediaId,
      commenterIgsid,
      username,
      text,
      rule.id,
      chosenPublicReply ? "queued" : "none",
      nowString,
      nowString,
    ),
    env.DB.prepare(
      `INSERT INTO outbound_jobs
         (id, job_type, comment_id, recipient_igsid, payload_json, status, attempts, max_attempts,
          run_after, last_error, created_at, updated_at)
       VALUES (?, 'private_reply', ?, NULL, ?, 'queued', 0, 5, ?, NULL, ?, ?)
       ON CONFLICT(comment_id, job_type) DO NOTHING`,
    ).bind(
      crypto.randomUUID(),
      commentId,
      JSON.stringify({
        text: rule.initial_dm_text,
        delivery_mode: rule.delivery_mode,
        rule_id: rule.id,
      }),
      nowString,
      nowString,
      nowString,
    ),
  ];

  if (chosenPublicReply) {
    const publicRunAfter = new Date(now.getTime() + 3000).toISOString();
    statements.push(
      env.DB.prepare(
        `INSERT INTO outbound_jobs
           (id, job_type, comment_id, recipient_igsid, payload_json, status, attempts, max_attempts,
            run_after, last_error, created_at, updated_at)
         VALUES (?, 'public_reply', ?, NULL, ?, 'queued', 0, 5, ?, NULL, ?, ?)
         ON CONFLICT(comment_id, job_type) DO NOTHING`,
      ).bind(
        crypto.randomUUID(),
        commentId,
        JSON.stringify({ text: chosenPublicReply }),
        publicRunAfter,
        nowString,
        nowString,
      ),
    );
  }

  await env.DB.batch(statements);
}

async function handleMessage(
  env: Env,
  event: Record<string, unknown>,
  ownerId: string | null,
): Promise<void> {
  const message = asObject(event.message);
  const sender = asObject(event.sender);
  const senderId = asString(sender.id);
  const recipientId = asString(asObject(event.recipient).id);
  const text = typeof message.text === "string" ? message.text : "";

  // Only echoes and non-text events are ignored outright.
  if (message.is_echo === true) {
    console.log("inbound dm", {
      senderId,
      recipientId,
      text,
      matchedSessionId: null,
      reason: "echo",
    });
    return;
  }

  if (!text.trim()) {
    console.log("inbound dm", {
      senderId,
      recipientId,
      text,
      matchedSessionId: null,
      reason: "no_text",
    });
    return;
  }

  // Ignore messages sent by the account itself (loop prevention).
  if (!senderId || (ownerId !== null && senderId === ownerId)) {
    console.log("inbound dm", {
      senderId,
      recipientId,
      text,
      matchedSessionId: null,
      reason: senderId ? "self" : "no_sender",
    });
    return;
  }

  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // The Step 1 private reply response carries Meta's `recipient_id`, which is
  // the same id that arrives here as `messaging.sender.id`. Match on either it
  // or the commenter id from `from.id`, so the handshake works for both.
  const row = await env.DB.prepare(
    `SELECT ce.*, r.opt_in_keywords_json AS rule_opt_in_keywords_json,
            r.followup_dm_text AS rule_followup_dm_text
     FROM comment_executions ce
     LEFT JOIN rules r ON r.id = ce.rule_id
     WHERE (ce.recipient_igsid = ? OR ce.commenter_igsid = ?)
       AND ce.state = 'awaiting_opt_in'
       AND ce.private_reply_sent_at IS NOT NULL
       AND ce.private_reply_sent_at >= ?
     ORDER BY ce.private_reply_sent_at DESC
     LIMIT 1`,
  )
    .bind(senderId, senderId, threshold)
    .first<
      CommentExecutionRow & {
        rule_opt_in_keywords_json: string | null;
        rule_followup_dm_text: string | null;
      }
    >();

  if (!row) {
    console.log("inbound dm", {
      senderId,
      recipientId,
      text,
      matchedSessionId: null,
      reason: "no_pending_opt_in",
    });
    return;
  }

  const optInKeywords = parseStringArray(row.rule_opt_in_keywords_json);
  if (optInKeywords.length > 0 && !findMatchingKeyword(text, optInKeywords)) {
    console.log("inbound dm", {
      senderId,
      recipientId,
      text,
      matchedSessionId: row.comment_id,
      reason: "keyword_mismatch",
    });
    return;
  }

  console.log("inbound dm", {
    senderId,
    recipientId,
    text,
    matchedSessionId: row.comment_id,
    reason: "matched",
  });

  const now = new Date().toISOString();
  const followupText = (row.rule_followup_dm_text ?? "").trim();

  if (!followupText) {
    await env.DB.prepare(
      `UPDATE comment_executions
       SET state = 'failed', last_error = ?, updated_at = ?
       WHERE comment_id = ? AND state = 'awaiting_opt_in'`,
    )
      .bind("Rule was deleted or has no follow-up message", now, row.comment_id)
      .run();
    return;
  }

  // Atomic transition: only one inbound DM can complete the opt-in.
  const updated = await env.DB.prepare(
    `UPDATE comment_executions
     SET state = 'completed', opt_in_completed_at = ?,
         recipient_igsid = COALESCE(recipient_igsid, ?), updated_at = ?
     WHERE comment_id = ? AND state = 'awaiting_opt_in'`,
  )
    .bind(now, senderId, now, row.comment_id)
    .run();

  if ((updated.meta.changes ?? 0) !== 1) return;

  // Step 2: POST /{ig_user_id}/messages with recipient.id = senderId.
  await enqueueJob(env, {
    jobType: "followup_dm",
    commentId: row.comment_id,
    recipientIgsid: senderId,
    payload: { text: followupText },
    runAfter: new Date(),
  });
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Admin pages                                                         */
/* ------------------------------------------------------------------ */

app.get("/admin", async (c) => {
  const session = await readSession(c);
  if (!session) {
    return c.html(loginPage({ error: c.req.query("error") === "1" }), 200, PAGE_HEADERS);
  }
  return c.html(dashboardPage(), 200, PAGE_HEADERS);
});

app.post("/admin/login", async (c) => {
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  const isJson = contentType.includes("application/json");

  let password = "";
  try {
    if (isJson) {
      password = z.object({ password: z.string().max(512) }).parse(await c.req.json()).password;
    } else {
      const form = await c.req.parseBody();
      password = typeof form.password === "string" ? form.password : "";
    }
  } catch {
    password = "";
  }

  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";

  const decision = checkLoginThrottle(ip);
  if (!decision.allowed) {
    const message = `Too many attempts. Try again in ${Math.ceil(decision.retryAfterSeconds / 60)} minute(s).`;
    if (isJson) return c.json({ error: message }, 429);
    return c.text(message, 429, { "Retry-After": String(decision.retryAfterSeconds) });
  }

  const ok = password.length > 0 && (await checkPassword(c.env, password));

  if (!ok) {
    recordLoginFailure(ip);
    if (isJson) return c.json({ error: "Incorrect password" }, 401);
    return c.redirect("/admin?error=1", 303);
  }

  resetLoginFailures(ip);
  let session: { value: string; maxAge: number };
  try {
    session = await issueSession(c.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a session";
    if (isJson) return c.json({ error: message }, 500);
    return c.text(message, 500);
  }
  c.header("Set-Cookie", sessionCookie(session.value, session.maxAge, useSecureCookie(c)));
  if (isJson) return c.json({ ok: true });
  return c.redirect("/admin", 303);
});

app.post("/admin/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie(useSecureCookie(c)));
  return c.redirect("/admin", 303);
});

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

app.get("/admin/api/state", async (c) => {
  const [account, token, statsRows, queueRows] = await Promise.all([
    getAccount(c.env),
    getTokenStatus(c.env),
    c.env.DB.prepare(
      "SELECT state, COUNT(*) AS n FROM comment_executions GROUP BY state",
    ).all<{ state: string; n: number }>(),
    c.env.DB.prepare(
      "SELECT status, COUNT(*) AS n FROM outbound_jobs GROUP BY status",
    ).all<{ status: string; n: number }>(),
  ]);

  const stats: Record<string, number> = {};
  for (const row of statsRows.results ?? []) stats[row.state] = Number(row.n);
  const queue: Record<string, number> = {};
  for (const row of queueRows.results ?? []) queue[row.status] = Number(row.n);

  return c.json({ account, token, stats, queue });
});

app.post("/admin/api/token", async (c) => {
  try {
    const body = tokenInputSchema.parse(await c.req.json());
    const account = await connectToken(c.env, body.token);
    return c.json({ account });
  } catch (error) {
    return adminError(c, error);
  }
});

app.post("/admin/api/token/refresh", async (c) => {
  try {
    const result = await refreshToken(c.env, { force: true });
    return c.json(result);
  } catch (error) {
    return adminError(c, error);
  }
});

app.get("/admin/api/rules", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM rules ORDER BY priority DESC, updated_at DESC",
  ).all<RuleRow>();
  return c.json({ rules: (rows.results ?? []).map(toRule) });
});

app.post("/admin/api/rules", async (c) => {
  let body;
  try {
    body = ruleInputSchema.parse(await c.req.json());
  } catch (error) {
    return c.json({ error: zodMessage(error) }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO rules
       (id, name, target_mode, media_ids_json, match_mode, keywords_json, delivery_mode,
        initial_dm_text, opt_in_keywords_json, followup_dm_text, public_replies_json,
        priority, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.name,
      body.target_mode,
      JSON.stringify(body.media_ids),
      body.match_mode,
      JSON.stringify(body.keywords),
      body.delivery_mode,
      body.initial_dm_text,
      JSON.stringify(body.opt_in_keywords),
      body.followup_dm_text,
      JSON.stringify(body.public_replies),
      body.priority,
      body.enabled ? 1 : 0,
      now,
      now,
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(id)
    .first<RuleRow>();
  return c.json({ rule: row ? toRule(row) : null }, 201);
});

app.put("/admin/api/rules/:id", async (c) => {
  const id = c.req.param("id");
  let body;
  try {
    body = ruleInputSchema.parse(await c.req.json());
  } catch (error) {
    return c.json({ error: zodMessage(error) }, 400);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE rules SET
       name = ?, target_mode = ?, media_ids_json = ?, match_mode = ?, keywords_json = ?,
       delivery_mode = ?, initial_dm_text = ?, opt_in_keywords_json = ?, followup_dm_text = ?,
       public_replies_json = ?, priority = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.name,
      body.target_mode,
      JSON.stringify(body.media_ids),
      body.match_mode,
      JSON.stringify(body.keywords),
      body.delivery_mode,
      body.initial_dm_text,
      JSON.stringify(body.opt_in_keywords),
      body.followup_dm_text,
      JSON.stringify(body.public_replies),
      body.priority,
      body.enabled ? 1 : 0,
      now,
      id,
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Rule not found" }, 404);

  const row = await c.env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(id)
    .first<RuleRow>();
  return c.json({ rule: row ? toRule(row) : null });
});

app.delete("/admin/api/rules/:id", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Rule not found" }, 404);
  return c.json({ ok: true });
});

app.post("/admin/api/rules/:id/toggle", async (c) => {
  const id = c.req.param("id");
  let enabled: boolean;
  try {
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    enabled = body.enabled;
  } catch (error) {
    return c.json({ error: zodMessage(error) }, 400);
  }

  const result = await c.env.DB.prepare(
    "UPDATE rules SET enabled = ?, updated_at = ? WHERE id = ?",
  )
    .bind(enabled ? 1 : 0, new Date().toISOString(), id)
    .run();

  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Rule not found" }, 404);
  return c.json({ ok: true, enabled });
});

app.post("/admin/api/media/sync", async (c) => {
  try {
    const token = await getToken(c.env);
    if (!token) return c.json({ error: "No Instagram token configured" }, 400);

    const account = await getAccount(c.env);
    const items = await fetchRecentMedia(c.env, token, account?.user_id ?? null, 25);
    await cacheMedia(c.env, items);

    const rows = await c.env.DB.prepare(
      "SELECT * FROM media_cache ORDER BY timestamp DESC LIMIT 100",
    ).all<MediaRow>();

    return c.json({ synced: items.length, media: rows.results ?? [] });
  } catch (error) {
    return adminError(c, error);
  }
});

app.get("/admin/api/media", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM media_cache ORDER BY timestamp DESC LIMIT 100",
  ).all<MediaRow>();
  return c.json({ media: rows.results ?? [] });
});

app.get("/admin/api/logs", async (c) => {
  const state = c.req.query("state") ?? "";
  const search = (c.req.query("q") ?? "").trim();
  const includeIgnored = c.req.query("include_ignored") === "1";
  const limitRaw = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 100;

  const where: string[] = [];
  const params: unknown[] = [];

  if (state && EXECUTION_STATES.includes(state as ExecutionState)) {
    where.push("ce.state = ?");
    params.push(state);
  } else if (!includeIgnored) {
    where.push("ce.state != 'ignored'");
  }

  if (search) {
    where.push(
      "(ce.comment_text LIKE ? OR ce.commenter_username LIKE ? OR ce.comment_id LIKE ? OR ce.commenter_igsid LIKE ?)",
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const sql = `
    SELECT ce.*, r.name AS rule_name,
      (SELECT j.status FROM outbound_jobs j
        WHERE j.comment_id = ce.comment_id AND j.status IN ('queued', 'processing', 'failed')
        ORDER BY j.updated_at DESC LIMIT 1) AS job_status,
      (SELECT j.id FROM outbound_jobs j
        WHERE j.comment_id = ce.comment_id AND j.status IN ('queued', 'processing', 'failed')
        ORDER BY j.updated_at DESC LIMIT 1) AS job_id
    FROM comment_executions ce
    LEFT JOIN rules r ON r.id = ce.rule_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ce.created_at DESC
    LIMIT ?`;

  params.push(limit);

  const rows = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<CommentExecutionRow & { rule_name: string | null; job_status: string | null; job_id: string | null }>();

  return c.json({ logs: rows.results ?? [] });
});

app.post("/admin/api/comments/:commentId/retry", async (c) => {
  const commentId = c.req.param("commentId");
  const requeued = await retryFailedJobsForComment(c.env, commentId);

  if (requeued > 0) {
    c.executionCtx.waitUntil(
      drainQueue(c.env).catch((error) => console.error("retry drain failed", error)),
    );
  }

  return c.json({ requeued });
});

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

app.notFound((c) => c.text("Not found", 404));

app.onError((error, c) => {
  console.error("Unhandled request error", error);
  if (c.req.path.startsWith("/admin/api/")) {
    return c.json({ error: "Internal server error" }, 500);
  }
  return c.text("Internal server error", 500);
});

/* ------------------------------------------------------------------ */
/* Scheduled handler                                                   */
/* ------------------------------------------------------------------ */

async function scheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const tasks: Promise<unknown>[] = [
    drainQueue(env, { maxJobs: 25 })
      .then((stats) => {
        if (stats.claimed > 0) console.log("cron queue drain", stats);
      })
      .catch((error) => console.error("cron queue drain failed", error)),
  ];

  if (event.cron === "0 6 * * *") {
    tasks.push(
      refreshToken(env)
        .then((result) => {
          if (result.refreshed) console.log("Instagram token refreshed", result.expires_at);
          else console.log("Instagram token refresh skipped:", result.reason);
        })
        .catch((error) => console.error("Instagram token refresh failed", error)),
    );
  }

  ctx.waitUntil(Promise.allSettled(tasks));
}

export { app };
export default { fetch: app.fetch, scheduled };
