import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_ID,
  APP_SECRET,
  VERIFY_TOKEN,
  countRows,
  createTestContext,
  getExecution,
  getJob,
  insertRule,
  installMetaMock,
  sendComment,
  sendMessage,
  signedWebhookRequest,
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

function handshake(query: string): Request {
  return new Request(`https://example.com/webhook?${query}`, { method: "GET" });
}

describe("webhook verification (GET)", () => {
  it("returns the challenge when mode and verify token are correct", async () => {
    const response = await ctx.dispatch(
      handshake(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("rejects a wrong verify token", async () => {
    const response = await ctx.dispatch(
      handshake("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123"),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a missing mode", async () => {
    const response = await ctx.dispatch(
      handshake(`hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`),
    );
    expect(response.status).toBe(403);
  });
});

describe("webhook signature verification (POST)", () => {
  it("rejects a body signed with the wrong app secret", async () => {
    const request = await signedWebhookRequest("wrong-secret", {
      object: "instagram",
      entry: [],
    });
    const response = await ctx.dispatch(request);
    expect(response.status).toBe(401);
  });

  it("rejects a missing signature header", async () => {
    const response = await ctx.dispatch(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ object: "instagram", entry: [] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed body", async () => {
    const request = await signedWebhookRequest(APP_SECRET, { object: "instagram", entry: [] });
    const response = await ctx.dispatch(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("EVENT_RECEIVED");
  });
});

describe("echo and loop prevention", () => {
  it("ignores comments written by the account itself", async () => {
    const response = await sendComment(ctx, {
      commentId: "echo_comment",
      fromId: ACCOUNT_ID,
      text: "link",
    });
    expect(response.status).toBe(200);
    expect(await countRows(ctx, "comment_executions")).toBe(0);
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });

  it("ignores messages flagged as echo", async () => {
    await sendMessage(ctx, { senderId: ACCOUNT_ID, text: "yes", isEcho: true });
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });

  it("ignores messages sent by the account without the echo flag", async () => {
    await sendMessage(ctx, { senderId: ACCOUNT_ID, text: "yes" });
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });
});

describe("comment ingestion", () => {
  it("ignores replies to other comments", async () => {
    await sendComment(ctx, {
      commentId: "reply_comment",
      parentId: "parent_comment",
      text: "link",
    });
    const execution = await getExecution(ctx, "reply_comment");
    expect(execution?.state).toBe("ignored");
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });

  it("records unmatched comments as ignored without sending anything", async () => {
    await sendComment(ctx, { commentId: "unmatched", text: "hello there" });
    const execution = await getExecution(ctx, "unmatched");
    expect(execution?.state).toBe("ignored");
    expect(execution?.last_error).toBe("no_matching_rule");
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });

  it("is idempotent for duplicate comment webhook deliveries", async () => {
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "dup_comment", text: "send the link", fromId: "user_9" });
    const first = await getExecution(ctx, "dup_comment");
    expect(first?.state).toBe("awaiting_opt_in");

    const response = await sendComment(ctx, {
      commentId: "dup_comment",
      text: "send the link",
      fromId: "user_9",
    });
    expect(response.status).toBe(200);

    expect(await countRows(ctx, "comment_executions")).toBe(1);
    expect(await countRows(ctx, "outbound_jobs")).toBe(1);
    expect(meta.callsTo("/me/messages")).toHaveLength(1);

    const job = await getJob(ctx, "dup_comment", "private_reply");
    expect(job?.status).toBe("done");
  });

  it("only creates one public reply job when variants are configured", async () => {
    await insertRule(ctx, {
      keywords: ["link"],
      public_replies: ["Sent!", "Check your DMs!"],
    });

    await sendComment(ctx, { commentId: "public_comment", text: "link", fromId: "user_10" });

    const execution = await getExecution(ctx, "public_comment");
    expect(execution?.public_reply_status).toBe("queued");

    const job = await getJob(ctx, "public_comment", "public_reply");
    expect(job?.status).toBe("queued");
    expect(Date.parse(String(job?.run_after))).toBeGreaterThan(Date.now() - 1000);
  });
});

describe("inbound messages", () => {
  it("does nothing when the sender has no pending opt-in", async () => {
    await sendMessage(ctx, { senderId: "stranger", text: "yes" });
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });

  it("ignores messages that only contain attachments", async () => {
    const request = await signedWebhookRequest(APP_SECRET, {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT_ID,
          messaging: [
            {
              sender: { id: "user_1" },
              recipient: { id: ACCOUNT_ID },
              message: { mid: "mid_attachment", attachments: [{ type: "image" }] },
            },
          ],
        },
      ],
    });
    const response = await ctx.dispatch(request);
    await ctx.settle();
    expect(response.status).toBe(200);
    expect(await countRows(ctx, "outbound_jobs")).toBe(0);
  });
});
