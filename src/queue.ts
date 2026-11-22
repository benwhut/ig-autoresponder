import {
  GraphApiError,
  getAccount,
  getPage,
  getPageToken,
  getToken,
  replyToComment,
  replyToFacebookComment,
  sendDirectMessage,
  sendMessengerMessage,
  sendMessengerPrivateReply,
  sendPrivateReply,
} from "./meta";
import type {
  CommentExecutionRow,
  DeliveryMode,
  Env,
  JobType,
  OutboundJobRow,
  Platform,
  PrivateReplyPayload,
} from "./types";
import { nowIso, toPlatform, truncate } from "./types";

const STALE_PROCESSING_MS = 5 * 60 * 1000;
const CLAIM_BATCH = 10;
const DEFAULT_MAX_JOBS = 20;
const MAX_BACKOFF_SECONDS = 60 * 60;

export interface EnqueueJobInput {
  jobType: JobType;
  commentId: string;
  recipientIgsid?: string | null;
  payload: Record<string, unknown>;
  runAfter?: Date;
  /** Which send API the job must use. Defaults to Instagram. */
  platform?: Platform;
}

/** Credentials resolved once per drain, then reused for every job. */
export interface SendContext {
  instagram: { token: string; igUserId: string | null } | null;
  facebook: { token: string; pageId: string } | null;
}

export async function loadSendContext(env: Env): Promise<SendContext> {
  const [igToken, account, pageToken, page] = await Promise.all([
    getToken(env),
    getAccount(env),
    getPageToken(env),
    getPage(env),
  ]);

  return {
    instagram: igToken ? { token: igToken, igUserId: account?.user_id ?? null } : null,
    facebook: pageToken && page ? { token: pageToken, pageId: page.page_id } : null,
  };
}

function configuredPlatforms(context: SendContext): Platform[] {
  const platforms: Platform[] = [];
  if (context.instagram) platforms.push("instagram");
  if (context.facebook) platforms.push("facebook");
  return platforms;
}

/**
 * Enqueues one job. The unique index on (comment_id, job_type) makes this
 * idempotent, so duplicate webhook deliveries can never double-send.
 */
export async function enqueueJob(env: Env, input: EnqueueJobInput): Promise<boolean> {
  const now = nowIso();
  const result = await env.DB.prepare(
    `INSERT INTO outbound_jobs
       (id, job_type, comment_id, recipient_igsid, platform, payload_json, status, attempts, max_attempts, run_after, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 5, ?, NULL, ?, ?)
     ON CONFLICT(comment_id, job_type) DO NOTHING`,
  )
    .bind(
      crypto.randomUUID(),
      input.jobType,
      input.commentId,
      input.recipientIgsid ?? null,
      input.platform ?? "instagram",
      JSON.stringify(input.payload),
      (input.runAfter ?? new Date()).toISOString(),
      now,
      now,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/** 30s * 2^attempts, capped at one hour. */
export function backoffSeconds(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(30 * 2 ** safeAttempts, MAX_BACKOFF_SECONDS);
}

export interface DrainStats {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  skipped?: "no_token";
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function getExecution(env: Env, commentId: string): Promise<CommentExecutionRow | null> {
  return env.DB.prepare("SELECT * FROM comment_executions WHERE comment_id = ?")
    .bind(commentId)
    .first<CommentExecutionRow>();
}

async function markJobDone(env: Env, jobId: string, now: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE outbound_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now, jobId)
    .run();
}

async function failJob(
  env: Env,
  job: OutboundJobRow,
  now: string,
  error: string,
): Promise<void> {
  const message = truncate(error, 500);
  const statements = [
    env.DB.prepare(
      "UPDATE outbound_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
    ).bind(message, now, job.id),
  ];

  if (job.job_type === "public_reply") {
    statements.push(
      env.DB.prepare(
        "UPDATE comment_executions SET public_reply_status = 'failed', last_error = ?, updated_at = ? WHERE comment_id = ?",
      ).bind(message, now, job.comment_id),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE comment_executions SET state = 'failed', last_error = ?, updated_at = ? WHERE comment_id = ?",
      ).bind(message, now, job.comment_id),
    );
  }

  await env.DB.batch(statements);
}

async function retryJob(
  env: Env,
  job: OutboundJobRow,
  now: string,
  error: string,
): Promise<void> {
  const delay = backoffSeconds(job.attempts) * (1 + Math.random() * 0.1);
  const runAfter = new Date(Date.parse(now) + delay * 1000).toISOString();
  await env.DB.prepare(
    "UPDATE outbound_jobs SET status = 'queued', run_after = ?, last_error = ?, updated_at = ? WHERE id = ?",
  )
    .bind(runAfter, truncate(error, 500), now, job.id)
    .run();
}

type JobOutcome = "sent" | "retried" | "failed";

async function processJob(
  env: Env,
  context: SendContext,
  job: OutboundJobRow,
  now: string,
): Promise<JobOutcome> {
  const payload = parsePayload(job.payload_json);
  const platform = toPlatform(job.platform);

  try {
    if (platform === "facebook") {
      const page = context.facebook;
      if (!page) {
        throw new GraphApiError("Facebook Page is not connected", { status: 400 });
      }

      if (job.job_type === "private_reply") {
        const privatePayload = payload as unknown as PrivateReplyPayload;
        const text = typeof privatePayload.text === "string" ? privatePayload.text : "";
        if (!text.trim()) throw new GraphApiError("Private reply text is empty", { status: 400 });

        const execution = await getExecution(env, job.comment_id);
        if (!execution) {
          throw new GraphApiError("Comment execution row is missing", { status: 400 });
        }

        const { recipientId, messageId } = await sendMessengerPrivateReply(
          env,
          page.token,
          page.pageId,
          job.comment_id,
          text,
        );

        const optInRecipient = recipientId ?? execution.commenter_igsid;
        const deliveryMode: DeliveryMode =
          privatePayload.delivery_mode === "direct_link" ? "direct_link" : "two_step_opt_in";

        console.log("private reply sent", {
          platform,
          commentId: job.comment_id,
          messageId,
          recipientId,
          optInRecipient,
          deliveryMode,
        });

        await finishPrivateReply(env, job, now, optInRecipient, deliveryMode);
        return "sent";
      }

      if (job.job_type === "public_reply") {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (!text.trim()) throw new GraphApiError("Public reply text is empty", { status: 400 });

        await replyToFacebookComment(env, page.token, job.comment_id, text);
        await markPublicReplySent(env, job, now);
        return "sent";
      }

      if (job.job_type === "followup_dm") {
        const text = typeof payload.text === "string" ? payload.text : "";
        const recipient =
          job.recipient_igsid ??
          (typeof payload.recipient_igsid === "string" ? payload.recipient_igsid : "");
        if (!recipient) throw new GraphApiError("Follow-up DM has no recipient", { status: 400 });
        if (!text.trim()) throw new GraphApiError("Follow-up DM text is empty", { status: 400 });

        await sendMessengerMessage(env, page.token, page.pageId, recipient, text);
        await markFollowupSent(env, job, now);
        return "sent";
      }

      throw new GraphApiError(`Unknown job type: ${String(job.job_type)}`, { status: 400 });
    }

    const ig = context.instagram;
    if (!ig) {
      throw new GraphApiError("Instagram token is not configured", { status: 400 });
    }

    if (job.job_type === "private_reply") {
      const privatePayload = payload as unknown as PrivateReplyPayload;
      const text = typeof privatePayload.text === "string" ? privatePayload.text : "";
      if (!text.trim()) throw new GraphApiError("Private reply text is empty", { status: 400 });

      const execution = await getExecution(env, job.comment_id);
      if (!execution) {
        throw new GraphApiError("Comment execution row is missing", { status: 400 });
      }

      const { recipientId, messageId } = await sendPrivateReply(
        env,
        ig.token,
        ig.igUserId,
        job.comment_id,
        text,
      );

      // Meta echoes the Instagram-scoped user id it delivered to. Inbound
      // messaging events identify the same user as `messaging.sender.id`, so
      // persist it for the opt-in handshake (falling back to the commenter id).
      const optInRecipient = recipientId ?? execution.commenter_igsid;
      const deliveryMode: DeliveryMode =
        privatePayload.delivery_mode === "direct_link" ? "direct_link" : "two_step_opt_in";

      console.log("private reply sent", {
        platform,
        commentId: job.comment_id,
        messageId,
        recipientId,
        optInRecipient,
        deliveryMode,
      });

      await finishPrivateReply(env, job, now, optInRecipient, deliveryMode);
      return "sent";
    }

    if (job.job_type === "public_reply") {
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text.trim()) throw new GraphApiError("Public reply text is empty", { status: 400 });

      await replyToComment(env, ig.token, job.comment_id, text);
      await markPublicReplySent(env, job, now);
      return "sent";
    }

    if (job.job_type === "followup_dm") {
      const text = typeof payload.text === "string" ? payload.text : "";
      const recipient =
        job.recipient_igsid ??
        (typeof payload.recipient_igsid === "string" ? payload.recipient_igsid : "");
      if (!recipient) throw new GraphApiError("Follow-up DM has no recipient", { status: 400 });
      if (!text.trim()) throw new GraphApiError("Follow-up DM text is empty", { status: 400 });

      await sendDirectMessage(env, ig.token, ig.igUserId, recipient, text);
      await markFollowupSent(env, job, now);
      return "sent";
    }

    throw new GraphApiError(`Unknown job type: ${String(job.job_type)}`, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof GraphApiError ? error.retryable : true;

    console.error("outbound job failed", {
      platform,
      jobType: job.job_type,
      commentId: job.comment_id,
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      retryable,
      error: message,
    });

    if (retryable && job.attempts < job.max_attempts) {
      await retryJob(env, job, now, message);
      return "retried";
    }

    await failJob(env, job, now, message);
    return "failed";
  }
}

/** Marks the private reply job done and advances the execution state. */
async function finishPrivateReply(
  env: Env,
  job: OutboundJobRow,
  now: string,
  optInRecipient: string | null,
  deliveryMode: DeliveryMode,
): Promise<void> {
  if (deliveryMode === "two_step_opt_in") {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE outbound_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?",
      ).bind(now, job.id),
      env.DB.prepare(
        `UPDATE comment_executions
         SET state = 'awaiting_opt_in', private_reply_sent_at = ?,
             recipient_igsid = COALESCE(?, recipient_igsid),
             last_error = NULL, updated_at = ?
         WHERE comment_id = ?`,
      ).bind(now, optInRecipient, now, job.comment_id),
    ]);
    return;
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE outbound_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?",
    ).bind(now, job.id),
    env.DB.prepare(
      `UPDATE comment_executions
       SET state = 'completed', private_reply_sent_at = ?, opt_in_completed_at = ?,
           recipient_igsid = COALESCE(?, recipient_igsid),
           last_error = NULL, updated_at = ?
       WHERE comment_id = ?`,
    ).bind(now, now, optInRecipient, now, job.comment_id),
  ]);
}

async function markPublicReplySent(env: Env, job: OutboundJobRow, now: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE outbound_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?",
    ).bind(now, job.id),
    env.DB.prepare(
      "UPDATE comment_executions SET public_reply_status = 'sent', updated_at = ? WHERE comment_id = ?",
    ).bind(now, job.comment_id),
  ]);
}

async function markFollowupSent(env: Env, job: OutboundJobRow, now: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE outbound_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?",
    ).bind(now, job.id),
    env.DB.prepare(
      `UPDATE comment_executions
       SET state = 'completed', opt_in_completed_at = COALESCE(opt_in_completed_at, ?),
           last_error = NULL, updated_at = ?
       WHERE comment_id = ?`,
    ).bind(now, now, job.comment_id),
  ]);
}

/**
 * Claims and processes queued jobs. Safe to call from a webhook (via
 * `waitUntil`) and from the 1-minute cron safety net.
 */
export async function drainQueue(
  env: Env,
  options: { maxJobs?: number; now?: Date } = {},
): Promise<DrainStats> {
  const stats: DrainStats = { claimed: 0, sent: 0, failed: 0, retried: 0 };
  const maxJobs = Math.max(1, options.maxJobs ?? DEFAULT_MAX_JOBS);
  const now = options.now ?? new Date();
  const nowString = now.toISOString();

  // Recover jobs whose worker died mid-flight.
  await env.DB.prepare(
    "UPDATE outbound_jobs SET status = 'queued', updated_at = ? WHERE status = 'processing' AND updated_at < ?",
  )
    .bind(nowString, new Date(now.getTime() - STALE_PROCESSING_MS).toISOString())
    .run();

  const context = await loadSendContext(env);
  const platforms = configuredPlatforms(context);
  if (platforms.length === 0) {
    stats.skipped = "no_token";
    return stats;
  }

  const platformFilter = platforms.map(() => "?").join(", ");

  while (stats.claimed < maxJobs) {
    const limit = Math.min(CLAIM_BATCH, maxJobs - stats.claimed);
    const claimed = await env.DB.prepare(
      `UPDATE outbound_jobs
       SET status = 'processing', attempts = attempts + 1, updated_at = ?
       WHERE id IN (
         SELECT id FROM outbound_jobs
         WHERE status = 'queued' AND run_after <= ? AND platform IN (${platformFilter})
         ORDER BY run_after ASC
         LIMIT ?
       )
       RETURNING *`,
    )
      .bind(nowString, nowString, ...platforms, limit)
      .all<OutboundJobRow>();

    const jobs = claimed.results ?? [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      stats.claimed += 1;
      const outcome = await processJob(env, context, job, nowString);
      if (outcome === "sent") stats.sent += 1;
      else if (outcome === "retried") stats.retried += 1;
      else stats.failed += 1;
    }
  }

  return stats;
}

/** Requeues every failed job for a comment (manual admin retry). */
export async function retryFailedJobsForComment(env: Env, commentId: string): Promise<number> {
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE outbound_jobs
     SET status = 'queued', attempts = 0, run_after = ?, last_error = NULL, updated_at = ?
     WHERE comment_id = ? AND status = 'failed'`,
  )
    .bind(now, now, commentId)
    .run();

  await env.DB.prepare(
    `UPDATE comment_executions
     SET last_error = NULL,
         state = CASE WHEN state = 'failed' THEN 'matched_queued' ELSE state END,
         public_reply_status = CASE WHEN public_reply_status = 'failed' THEN 'queued' ELSE public_reply_status END,
         updated_at = ?
     WHERE comment_id = ?`,
  )
    .bind(now, commentId)
    .run();

  return result.meta.changes ?? 0;
}
