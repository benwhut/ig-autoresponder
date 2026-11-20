import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectToken,
  detectTokenType,
  fetchRecentMedia,
  getTokenStatus,
  refreshToken,
  saveToken,
  sendDirectMessage,
  sendPrivateReply,
} from "../src/meta";
import {
  FACEBOOK_ACCOUNT_ID,
  FACEBOOK_TOKEN,
  adminRequest,
  createTestContext,
  getExecution,
  insertRule,
  installMetaMock,
  jsonResponse,
  login,
  sendComment,
  sendMessage,
  type MetaMock,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let meta: MetaMock;

beforeEach(async () => {
  ctx = await createTestContext({ withAccount: false, withToken: false });
  meta = installMetaMock();
});

afterEach(async () => {
  await ctx.close();
  vi.unstubAllGlobals();
});

describe("token type detection", () => {
  it("uses graph.instagram.com for IGAA tokens", () => {
    expect(detectTokenType("IGAA-abc")).toBe("instagram_graph");
    expect(detectTokenType("  IGAA-abc  ")).toBe("instagram_graph");
  });

  it("uses graph.facebook.com for EAA and other tokens", () => {
    expect(detectTokenType("EAA-abc")).toBe("facebook_graph");
    expect(detectTokenType("EAAB-abc")).toBe("facebook_graph");
    expect(detectTokenType("igaa-lowercase")).toBe("facebook_graph");
  });
});

describe("EAA token validation", () => {
  it("resolves the account through /me/assigned_instagram_accounts", async () => {
    const account = await connectToken(ctx.env, `  ${FACEBOOK_TOKEN}  `);

    expect(account.user_id).toBe(FACEBOOK_ACCOUNT_ID);
    expect(account.username).toBe("businessaccount");
    expect(account.token_type).toBe("facebook_graph");

    const assigned = meta.callsTo("/me/assigned_instagram_accounts");
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.url).toContain(
      "https://graph.facebook.com/v25.0/me/assigned_instagram_accounts",
    );
    expect(meta.callsTo("graph.instagram.com")).toHaveLength(0);
  });

  it("falls back to /me/accounts when no assigned account is returned", async () => {
    vi.unstubAllGlobals();
    meta = installMetaMock((call) => {
      if (call.path.endsWith("/me/assigned_instagram_accounts")) {
        return jsonResponse({ data: [] });
      }
      return undefined;
    });

    const account = await connectToken(ctx.env, FACEBOOK_TOKEN);

    expect(account.user_id).toBe(FACEBOOK_ACCOUNT_ID);
    expect(account.username).toBe("businessaccount");
    expect(account.token_type).toBe("facebook_graph");
    expect(meta.callsTo("/me/accounts")).toHaveLength(1);
  });

  it("stores a non-expiring token when /debug_token reports expires_at = 0", async () => {
    await connectToken(ctx.env, FACEBOOK_TOKEN);

    const row = await ctx.env.DB.prepare(
      "SELECT expires_at FROM system_config WHERE key = 'ig_token'",
    ).first<{ expires_at: string | null }>();
    expect(row?.expires_at).toBeNull();

    const status = await getTokenStatus(ctx.env);
    expect(status.state).toBe("ok");
    expect(status.never_expires).toBe(true);
    expect(status.expires_at).toBeNull();
    expect(status.days_left).toBeNull();
  });

  it("reports Never expires in /health and the admin state", async () => {
    await connectToken(ctx.env, FACEBOOK_TOKEN);

    const health = await ctx.dispatch(new Request("https://example.com/health"));
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as {
      token: { state: string; never_expires: boolean; expires_at: string | null };
    };
    expect(healthBody.token.state).toBe("ok");
    expect(healthBody.token.never_expires).toBe(true);
    expect(healthBody.token.expires_at).toBeNull();

    const cookie = await login(ctx);
    const state = await adminRequest(ctx, "/admin/api/state", { cookie });
    expect(state.status).toBe(200);
    const stateBody = (await state.json()) as { token: { never_expires: boolean } };
    expect(stateBody.token.never_expires).toBe(true);
  });
});

describe("EAA Graph routing", () => {
  it("sends private replies and follow-up DMs to /{ig_user_id}/messages", async () => {
    await connectToken(ctx.env, FACEBOOK_TOKEN);

    await sendPrivateReply(ctx.env, FACEBOOK_TOKEN, FACEBOOK_ACCOUNT_ID, "comment_1", "hello");
    await sendDirectMessage(ctx.env, FACEBOOK_TOKEN, FACEBOOK_ACCOUNT_ID, "user_1", "follow up");

    const messages = meta.callsTo("/messages");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.url).toContain(
      `https://graph.facebook.com/v25.0/${FACEBOOK_ACCOUNT_ID}/messages`,
    );
    expect(messages[1]?.url).toContain(
      `https://graph.facebook.com/v25.0/${FACEBOOK_ACCOUNT_ID}/messages`,
    );
    expect(messages[0]?.body).toMatchObject({
      recipient: { comment_id: "comment_1" },
      message: { text: "hello" },
    });
    expect(messages[1]?.body).toMatchObject({
      recipient: { id: "user_1" },
      message: { text: "follow up" },
    });
  });

  it("syncs media from /{ig_user_id}/media", async () => {
    const media = await fetchRecentMedia(ctx.env, FACEBOOK_TOKEN, FACEBOOK_ACCOUNT_ID, 25);

    expect(media).toHaveLength(2);
    expect(meta.callsTo("/media")[0]?.url).toContain(
      `https://graph.facebook.com/v25.0/${FACEBOOK_ACCOUNT_ID}/media`,
    );
  });

  it("keeps IGAA tokens on /me", async () => {
    await sendPrivateReply(ctx.env, "IGAA-test-token", null, "comment_1", "hello");

    const messages = meta.callsTo("/messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.url).toContain("https://graph.instagram.com/v25.0/me/messages");
  });
});

describe("token refresh", () => {
  it("skips refresh for non-expiring EAA tokens", async () => {
    await connectToken(ctx.env, FACEBOOK_TOKEN);

    const result = await refreshToken(ctx.env, { force: true });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toContain("Business/System User");
    expect(meta.callsTo("/refresh_access_token")).toHaveLength(0);
  });

  it("refreshes an IGAA token when forced", async () => {
    await saveToken(ctx.env, "IGAA-test-token", 60 * 24 * 60);

    const result = await refreshToken(ctx.env, { force: true });

    expect(result.refreshed).toBe(true);
    const refreshCalls = meta.callsTo("/refresh_access_token");
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]?.url).toContain("https://graph.instagram.com/refresh_access_token");
  });
});

describe("EAA end-to-end flow", () => {
  it("sends the private reply and follow-up to /{ig_user_id}/messages", async () => {
    await connectToken(ctx.env, FACEBOOK_TOKEN);
    await insertRule(ctx, { keywords: ["link"] });

    await sendComment(ctx, { commentId: "fb_comment_1", text: "send the link", fromId: "user_1" });

    expect((await getExecution(ctx, "fb_comment_1"))?.state).toBe("awaiting_opt_in");

    const afterComment = meta.callsTo("/messages");
    expect(afterComment).toHaveLength(1);
    expect(afterComment[0]?.url).toContain(
      `https://graph.facebook.com/v25.0/${FACEBOOK_ACCOUNT_ID}/messages`,
    );
    expect(afterComment[0]?.body).toMatchObject({
      recipient: { comment_id: "fb_comment_1" },
    });

    await sendMessage(ctx, { senderId: "user_1", text: "yes" });

    expect((await getExecution(ctx, "fb_comment_1"))?.state).toBe("completed");

    const afterOptIn = meta.callsTo("/messages");
    expect(afterOptIn).toHaveLength(2);
    expect(afterOptIn[1]?.url).toContain(
      `https://graph.facebook.com/v25.0/${FACEBOOK_ACCOUNT_ID}/messages`,
    );
    expect(afterOptIn[1]?.body).toMatchObject({ recipient: { id: "user_1" } });
  });
});
