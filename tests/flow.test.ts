import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffSeconds, drainQueue } from "../src/queue";
import {
  countRows,
  createTestContext,
  getExecution,
  getJob,
  insertRule,
  installMetaMock,
  jsonResponse,
  sendComment,
  sendMessage,
  type MetaMock,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let meta: MetaMock;

beforeEach(async () => {
  ctx = await createTestContext();
  meta = installMetaMock();
});

afterEach(() => {
  ctx.close();
  vi.unstubAllGlobals();
});

describe("two-step opt-in state machine", () => {
  it("sends the private reply, waits for opt-in, then sends the link", async () => {
    const rule = await insertRule(ctx, { keywords: ["link"] });

    const response = await sendComment(ctx, {
      commentId: "comment_1",
      text: "Can I get the link?",
      fromId: "user_42",
      username: "fan",
    });
    expect(response.status).toBe(200);

    const afterComment = await getExecution(ctx, "comment_1");
    expect(afterComment?.state).toBe("awaiting_opt_in");
    expect(afterComment?.private_reply_sent_at).toBeTruthy();
    expect(afterComment?.opt_in_completed_at).toBeNull();

    const privateJob = await getJob(ctx, "comment_1", "private_reply");
    expect(privateJob?.status).toBe("done");
    expect(privateJob?.attempts).toBe(1);

    const firstMessages = meta.callsTo("/me/messages");
    expect(firstMessages).toHaveLength(1);
    expect(firstMessages[0]?.method).toBe("POST");
    expect(firstMessages[0]?.body).toMatchObject({
      recipient: { comment_id: "comment_1" },
      message: { text: rule.initial_dm_text },
    });

    await sendMessage(ctx, { senderId: "user_42", text: "YES" });

    const afterOptIn = await getExecution(ctx, "comment_1");
    expect(afterOptIn?.state).toBe("completed");
    expect(afterOptIn?.opt_in_completed_at).toBeTruthy();

    const followupJob = await getJob(ctx, "comment_1", "followup_dm");
    expect(followupJob?.status).toBe("done");
    expect(followupJob?.recipient_igsid).toBe("user_42");

    const messages = meta.callsTo("/me/messages");
    expect(messages).toHaveLength(2);
    expect(messages[1]?.body).toMatchObject({
      recipient: { id: "user_42" },
      message: { text: rule.followup_dm_text },
    });
    expect(JSON.stringify(messages[1]?.body)).toContain("https://example.com/guide");
  });

  it("requires an opt-in keyword when one is configured", async () => {
    await insertRule(ctx, { keywords: ["link"], opt_in_keywords: ["yes", "send"] });

    await sendComment(ctx, { commentId: "comment_2", text: "link", fromId: "user_7" });
    expect((await getExecution(ctx, "comment_2"))?.state).toBe("awaiting_opt_in");

    await sendMessage(ctx, { senderId: "user_7", text: "maybe later" });
    expect((await getExecution(ctx, "comment_2"))?.state).toBe("awaiting_opt_in");
    expect(await getJob(ctx, "comment_2", "followup_dm")).toBeNull();

    await sendMessage(ctx, { senderId: "user_7", text: "please SEND it" });
    expect((await getExecution(ctx, "comment_2"))?.state).toBe("completed");
    expect((await getJob(ctx, "comment_2", "followup_dm"))?.status).toBe("done");
  });

  it("accepts any reply when opt-in keywords are empty", async () => {
    await insertRule(ctx, { keywords: ["link"], opt_in_keywords: [] });

    await sendComment(ctx, { commentId: "comment_3", text: "link", fromId: "user_8" });
    await sendMessage(ctx, { senderId: "user_8", text: "ok" });

    expect((await getExecution(ctx, "comment_3"))?.state).toBe("completed");
  });

  it("does not double-send when the user replies twice", async () => {
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_4", text: "link", fromId: "user_5" });
    await sendMessage(ctx, { senderId: "user_5", text: "yes" });
    await sendMessage(ctx, { senderId: "user_5", text: "yes again" });

    expect(meta.callsTo("/me/messages")).toHaveLength(2);
    expect(await countRows(ctx, "outbound_jobs")).toBe(2);
  });

  it("enforces the 24-hour opt-in window", async () => {
    const rule = await insertRule(ctx, { keywords: ["link"] });
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    await ctx.env.DB.prepare(
      `INSERT INTO comment_executions
         (comment_id, media_id, commenter_igsid, commenter_username, comment_text, rule_id, state,
          private_reply_sent_at, opt_in_completed_at, public_reply_status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'awaiting_opt_in', ?, NULL, 'none', NULL, ?, ?)`,
    )
      .bind("comment_old", "media_1", "user_old", "oldfan", "link", rule.id, old, now, now)
      .run();

    await sendMessage(ctx, { senderId: "user_old", text: "YES" });

    expect((await getExecution(ctx, "comment_old"))?.state).toBe("awaiting_opt_in");
    expect(await getJob(ctx, "comment_old", "followup_dm")).toBeNull();

    // Same user, fresh private reply: the opt-in now works.
    await ctx.env.DB.prepare(
      "UPDATE comment_executions SET private_reply_sent_at = ? WHERE comment_id = ?",
    )
      .bind(now, "comment_old")
      .run();

    await sendMessage(ctx, { senderId: "user_old", text: "YES" });
    expect((await getExecution(ctx, "comment_old"))?.state).toBe("completed");
  });
});

describe("direct-link delivery", () => {
  it("completes immediately after the single private reply", async () => {
    await insertRule(ctx, {
      keywords: ["link"],
      delivery_mode: "direct_link",
      initial_dm_text: "Here is your link: https://example.com/direct",
      followup_dm_text: "",
    });

    await sendComment(ctx, { commentId: "comment_direct", text: "link", fromId: "user_3" });

    const execution = await getExecution(ctx, "comment_direct");
    expect(execution?.state).toBe("completed");
    expect(execution?.private_reply_sent_at).toBeTruthy();
    expect(execution?.opt_in_completed_at).toBeTruthy();
    expect(await getJob(ctx, "comment_direct", "followup_dm")).toBeNull();
    expect(meta.callsTo("/me/messages")).toHaveLength(1);
  });
});

describe("public replies", () => {
  it("posts one random variant after the private reply", async () => {
    await insertRule(ctx, {
      keywords: ["link"],
      public_replies: ["Sent!", "Check your DMs!"],
    });

    await sendComment(ctx, { commentId: "comment_public", text: "link", fromId: "user_11" });

    const job = await getJob(ctx, "comment_public", "public_reply");
    expect(job?.status).toBe("queued");
    expect(meta.callsTo("/replies")).toHaveLength(0);

    // Simulate the 3-second delay elapsing.
    await ctx.env.DB.prepare(
      "UPDATE outbound_jobs SET run_after = ? WHERE comment_id = ? AND job_type = 'public_reply'",
    )
      .bind(new Date(Date.now() - 1000).toISOString(), "comment_public")
      .run();

    await drainQueue(ctx.env);

    const doneJob = await getJob(ctx, "comment_public", "public_reply");
    expect(doneJob?.status).toBe("done");
    expect((await getExecution(ctx, "comment_public"))?.public_reply_status).toBe("sent");

    const replies = meta.callsTo("/replies");
    expect(replies).toHaveLength(1);
    const message = (replies[0]?.body as { message?: string } | null)?.message;
    expect(["Sent!", "Check your DMs!"]).toContain(message);
  });
});

describe("retry and backoff", () => {
  it("retries transient errors with exponential backoff", async () => {
    vi.unstubAllGlobals();
    meta = installMetaMock((call) =>
      call.url.includes("/me/messages")
        ? jsonResponse({ error: { message: "temporary failure", code: 2 } }, 500)
        : undefined,
    );

    await insertRule(ctx, { keywords: ["link"] });
    await sendComment(ctx, { commentId: "comment_retry", text: "link", fromId: "user_12" });

    const job = await getJob(ctx, "comment_retry", "private_reply");
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(1);
    expect(String(job?.last_error)).toContain("temporary failure");

    const delayMs = Date.parse(String(job?.run_after)) - Date.now();
    expect(delayMs).toBeGreaterThan(55_000);
    expect(delayMs).toBeLessThan(70_000);

    expect((await getExecution(ctx, "comment_retry"))?.state).toBe("matched_queued");
  });

  it("marks the job and execution failed after max attempts", async () => {
    vi.unstubAllGlobals();
    meta = installMetaMock((call) =>
      call.url.includes("/me/messages")
        ? jsonResponse({ error: { message: "still broken", code: 2 } }, 500)
        : undefined,
    );

    await insertRule(ctx, { keywords: ["link"] });
    await sendComment(ctx, { commentId: "comment_dead", text: "link", fromId: "user_13" });

    await ctx.env.DB.prepare(
      "UPDATE outbound_jobs SET attempts = 4, run_after = ? WHERE comment_id = ? AND job_type = 'private_reply'",
    )
      .bind(new Date(Date.now() - 1000).toISOString(), "comment_dead")
      .run();

    await drainQueue(ctx.env);

    const job = await getJob(ctx, "comment_dead", "private_reply");
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(5);
    expect(String(job?.last_error)).toContain("still broken");
    expect((await getExecution(ctx, "comment_dead"))?.state).toBe("failed");
  });

  it("does not retry permanent 400 errors", async () => {
    vi.unstubAllGlobals();
    meta = installMetaMock((call) =>
      call.url.includes("/me/messages")
        ? jsonResponse(
            {
              error: {
                message: "This message is sent outside of allowed window",
                code: 10,
                error_subcode: 2534022,
              },
            },
            400,
          )
        : undefined,
    );

    await insertRule(ctx, { keywords: ["link"] });
    await sendComment(ctx, { commentId: "comment_perm", text: "link", fromId: "user_14" });

    const job = await getJob(ctx, "comment_perm", "private_reply");
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(1);
    expect((await getExecution(ctx, "comment_perm"))?.state).toBe("failed");
  });

  it("computes backoff as 30s * 2^attempts capped at one hour", () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(3)).toBe(240);
    expect(backoffSeconds(10)).toBe(3600);
  });
});
