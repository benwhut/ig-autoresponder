import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectToken } from "../src/meta";
import { drainQueue, enqueueJob } from "../src/queue";
import {
  ACCOUNT_ID,
  APP_SECRET,
  FACEBOOK_ACCOUNT_ID,
  FACEBOOK_TOKEN,
  adminRequest,
  createTestContext,
  getExecution,
  getJob,
  insertRule,
  installMetaMock,
  jsonResponse,
  login,
  sendComment,
  sendMessage,
  signedWebhookRequest,
  type MetaMock,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let meta: MetaMock;

beforeEach(async () => {
  ctx = await createTestContext({ withAccount: false, withToken: false });
  installMetaMock();
  await connectToken(ctx.env, FACEBOOK_TOKEN);
});

afterEach(async () => {
  await ctx.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Returns a fixed `recipient_id` from the private reply, like Meta does. */
function mockPrivateReplyRecipient(recipientId: string | null): MetaMock {
  return installMetaMock((call) => {
    if (call.path.endsWith("/messages") && call.body && "recipient" in call.body) {
      const recipient = call.body.recipient as Record<string, unknown>;
      if (typeof recipient.comment_id === "string") {
        return jsonResponse({
          message_id: "mid_private_reply",
          ...(recipientId === null ? {} : { recipient_id: recipientId }),
        });
      }
    }
    return undefined;
  });
}

describe("private reply recipient capture", () => {
  it("stores Meta's recipient_id on the pending opt-in row", async () => {
    meta = mockPrivateReplyRecipient("igsid_from_meta");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_recip", text: "link", fromId: "comment_from_id" });

    const execution = await getExecution(ctx, "comment_recip");
    expect(execution?.state).toBe("awaiting_opt_in");
    expect(execution?.commenter_igsid).toBe("comment_from_id");
    expect(execution?.recipient_igsid).toBe("igsid_from_meta");
  });

  it("falls back to the commenter id when Meta omits recipient_id", async () => {
    meta = mockPrivateReplyRecipient(null);
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_fallback", text: "link", fromId: "user_fb" });

    const execution = await getExecution(ctx, "comment_fallback");
    expect(execution?.state).toBe("awaiting_opt_in");
    expect(execution?.recipient_igsid).toBe("user_fb");
  });
});

describe("inbound DM opt-in matching", () => {
  it("matches on recipient_id when it differs from the commenter id", async () => {
    meta = mockPrivateReplyRecipient("igsid_sender");
    const rule = await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_match", text: "link", fromId: "comment_from_id" });

    // The inbound event uses messaging.sender.id === the captured recipient_id.
    await sendMessage(ctx, { senderId: "igsid_sender", text: "YES" });

    const execution = await getExecution(ctx, "comment_match");
    expect(execution?.state).toBe("completed");
    expect(execution?.recipient_igsid).toBe("igsid_sender");

    const followup = await getJob(ctx, "comment_match", "followup_dm");
    expect(followup?.status).toBe("done");
    expect(followup?.recipient_igsid).toBe("igsid_sender");

    const messages = meta.callsTo("/messages");
    expect(messages).toHaveLength(2);

    // Step 2 goes to the Facebook Graph business account with recipient.id.
    expect(messages[1]?.method).toBe("POST");
    expect(messages[1]?.url).toContain(
      `https://graph.facebook.com/v25.0/${FACEBOOK_ACCOUNT_ID}/messages`,
    );
    expect(messages[1]?.body).toMatchObject({
      recipient: { id: "igsid_sender" },
      message: { text: rule.followup_dm_text },
    });
  });

  it("still matches when sender.id equals the commenter id", async () => {
    meta = mockPrivateReplyRecipient("other_id");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_commenter", text: "link", fromId: "user_same" });
    await sendMessage(ctx, { senderId: "user_same", text: "yes" });

    expect((await getExecution(ctx, "comment_commenter"))?.state).toBe("completed");
  });

  it("ignores echo events and events without text", async () => {
    meta = mockPrivateReplyRecipient("igsid_echo");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_echo", text: "link", fromId: "user_echo" });

    await sendMessage(ctx, { senderId: "igsid_echo", text: "YES", isEcho: true });
    expect((await getExecution(ctx, "comment_echo"))?.state).toBe("awaiting_opt_in");

    await sendMessage(ctx, { senderId: "igsid_echo", text: "" });
    expect((await getExecution(ctx, "comment_echo"))?.state).toBe("awaiting_opt_in");

    // Only one message (the private reply) has been sent.
    expect(meta.callsTo("/messages")).toHaveLength(1);
  });

  it("logs why an inbound DM matched or was skipped", async () => {
    meta = mockPrivateReplyRecipient("igsid_log");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_log", text: "link", fromId: "user_log" });
    await sendMessage(ctx, { senderId: "someone_else", text: "hello" });
    await sendMessage(ctx, { senderId: "igsid_log", text: "YES" });

    const inbound = log.mock.calls.filter((call) => call[0] === "inbound dm");
    expect(inbound.length).toBeGreaterThanOrEqual(2);

    const skipped = inbound.find(
      (call) => (call[1] as Record<string, unknown>).reason === "no_pending_opt_in",
    );
    expect(skipped?.[1]).toMatchObject({
      senderId: "someone_else",
      matchedSessionId: null,
    });

    const matched = inbound.find(
      (call) => (call[1] as Record<string, unknown>).reason === "matched",
    );
    expect(matched?.[1]).toMatchObject({
      senderId: "igsid_log",
      matchedSessionId: "comment_log",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Alternate webhook shapes (Facebook Graph / Page-linked Instagram)   */
/* ------------------------------------------------------------------ */

async function sendRawWebhook(ctx: TestContext, payload: unknown): Promise<Response> {
  const request = await signedWebhookRequest(APP_SECRET, payload);
  const response = await ctx.dispatch(request);
  await ctx.settle();
  return response;
}

function changesMessagePayload(options: {
  senderId?: string;
  text?: string;
  field?: string;
  nested?: boolean;
}): Record<string, unknown> {
  const event = {
    sender: { id: options.senderId ?? "igsid_sender" },
    recipient: { id: FACEBOOK_ACCOUNT_ID },
    message: { mid: "mid_yes", text: options.text ?? "YES" },
  };

  return {
    object: "instagram",
    entry: [
      {
        id: FACEBOOK_ACCOUNT_ID,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: options.field ?? "messages",
            value: options.nested ? { value: event } : event,
          },
        ],
      },
    ],
  };
}

describe("alternate inbound DM webhook shapes", () => {
  it("handles entry[].changes[] with field = messages", async () => {
    meta = mockPrivateReplyRecipient("igsid_sender");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_changes", text: "link", fromId: "commenter_a" });
    expect((await getExecution(ctx, "comment_changes"))?.state).toBe("awaiting_opt_in");

    const response = await sendRawWebhook(ctx, changesMessagePayload({ senderId: "igsid_sender" }));
    expect(response.status).toBe(200);

    expect((await getExecution(ctx, "comment_changes"))?.state).toBe("completed");
    expect((await getJob(ctx, "comment_changes", "followup_dm"))?.status).toBe("done");

    const messages = meta.callsTo("/messages");
    expect(messages).toHaveLength(2);
    expect(messages[1]?.body).toMatchObject({ recipient: { id: "igsid_sender" } });
  });

  it("handles a changes value nested one level deeper", async () => {
    meta = mockPrivateReplyRecipient("igsid_nested");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_nested", text: "link", fromId: "commenter_b" });
    await sendRawWebhook(
      ctx,
      changesMessagePayload({ senderId: "igsid_nested", nested: true }),
    );

    expect((await getExecution(ctx, "comment_nested"))?.state).toBe("completed");
  });

  it("handles object = page with entry[].messaging[]", async () => {    meta = mockPrivateReplyRecipient("igsid_page");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_page", text: "link", fromId: "commenter_c" });

    await sendRawWebhook(ctx, {
      object: "page",
      entry: [
        {
          id: "page_123",
          time: Math.floor(Date.now() / 1000),
          messaging: [
            {
              sender: { id: "igsid_page" },
              recipient: { id: FACEBOOK_ACCOUNT_ID },
              message: { mid: "mid_page", text: "YES" },
            },
          ],
        },
      ],
    });

    expect((await getExecution(ctx, "comment_page"))?.state).toBe("completed");
  });

  it("handles a flat sender_id/recipient_id/message payload", async () => {
    meta = mockPrivateReplyRecipient("igsid_flat");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_flat", text: "link", fromId: "commenter_e" });

    await sendRawWebhook(ctx, {
      object: "instagram",
      entry: [
        {
          id: FACEBOOK_ACCOUNT_ID,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: "messages",
              value: {
                sender_id: "igsid_flat",
                recipient_id: FACEBOOK_ACCOUNT_ID,
                message: "YES",
              },
            },
          ],
        },
      ],
    });

    expect((await getExecution(ctx, "comment_flat"))?.state).toBe("completed");
  });

  it("records webhook diagnostics for /admin/api/logs", async () => {
    meta = mockPrivateReplyRecipient("igsid_diag");
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "comment_diag", text: "link", fromId: "commenter_d" });
    await sendRawWebhook(ctx, changesMessagePayload({ senderId: "igsid_diag" }));

    const cookie = await login(ctx);
    const response = await adminRequest(ctx, "/admin/api/logs?include_ignored=1", { cookie });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      logs: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
    };

    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.some((event) => event.kind === "received")).toBe(true);
    expect(
      body.events.some(
        (event) =>
          event.kind === "dm" &&
          typeof event.reason === "string" &&
          event.reason.startsWith("matched"),
      ),
    ).toBe(true);
  });
});

describe("cron drain path", () => {
  it("stores recipient_id when the cron drain (not the webhook) sends Step 1", async () => {
    meta = mockPrivateReplyRecipient("igsid_cron");
    const rule = await insertRule(ctx, { keywords: ["link"] });
    const now = new Date().toISOString();

    await ctx.env.DB.prepare(
      `INSERT INTO comment_executions
         (comment_id, media_id, commenter_igsid, commenter_username, comment_text, rule_id, state,
          private_reply_sent_at, opt_in_completed_at, public_reply_status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'matched_queued', NULL, NULL, 'none', NULL, ?, ?)`,
    )
      .bind("comment_cron", "media_1", "commenter_cron", "cronfan", "link", rule.id, now, now)
      .run();

    await enqueueJob(ctx.env, {
      jobType: "private_reply",
      commentId: "comment_cron",
      payload: {
        text: rule.initial_dm_text,
        delivery_mode: "two_step_opt_in",
        rule_id: rule.id,
      },
    });

    const stats = await drainQueue(ctx.env);
    expect(stats.sent).toBe(1);

    const execution = await getExecution(ctx, "comment_cron");
    expect(execution?.state).toBe("awaiting_opt_in");
    expect(execution?.recipient_igsid).toBe("igsid_cron");

    // A second drain must not resend.
    const second = await drainQueue(ctx.env);
    expect(second.claimed).toBe(0);
    expect(meta.callsTo("/messages")).toHaveLength(1);
  });
});

describe("signature failures", () => {
  it("logs and rejects a webhook with a bad signature", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = await signedWebhookRequest("wrong-secret", changesMessagePayload({}));
    const response = await ctx.dispatch(request);

    expect(response.status).toBe(401);
    expect(
      errorLog.mock.calls.some((call) => call[0] === "webhook signature verification failed"),
    ).toBe(true);
  });
});
