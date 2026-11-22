import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectToken } from "../src/meta";
import {
  FACEBOOK_ACCOUNT_ID,
  FACEBOOK_TOKEN,
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
