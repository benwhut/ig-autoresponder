import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectPage, connectToken, savePage, savePageToken } from "../src/meta";
import {
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
  sendFacebookComment,
  sendFacebookMessage,
  type MetaMock,
  type TestContext,
} from "./helpers";

const PAGE_ID = "page_1";

let ctx: TestContext;
let meta: MetaMock;

beforeEach(async () => {
  ctx = await createTestContext({ withAccount: false, withToken: false });
  meta = installMetaMock();
  await connectToken(ctx.env, FACEBOOK_TOKEN);
  await savePage(ctx.env, { page_id: PAGE_ID, name: "Test Page" });
});

afterEach(async () => {
  await ctx.close();
  vi.unstubAllGlobals();
});

describe("Facebook Page comments", () => {
  it("sends a Messenger private reply for a Facebook comment", async () => {
    const rule = await insertRule(ctx, { keywords: ["link"], platform: "both" });

    const response = await sendFacebookComment(ctx, {
      commentId: "fb_comment_1",
      postId: "page_1_111",
      text: "send the link",
      fromId: "psid_1",
      name: "FB Fan",
    });

    expect(response.status).toBe(200);
    const execution = await getExecution(ctx, "fb_comment_1");
    expect(execution?.state).toBe("awaiting_opt_in");
    expect(execution?.platform).toBe("facebook");
    expect(execution?.media_id).toBe("page_1_111");

    const messages = meta.callsTo("/messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.url).toContain(`/${PAGE_ID}/messages`);
    expect(messages[0]?.body).toMatchObject({
      recipient: { comment_id: "fb_comment_1" },
      message: { text: rule.initial_dm_text },
    });
  });

  it("stores the PSID returned by the private reply", async () => {
    vi.unstubAllGlobals();
    meta = installMetaMock((call) => {
      if (call.path.endsWith("/messages")) {
        const body = call.body as { recipient?: { comment_id?: string; id?: string } } | null;
        if (body?.recipient?.comment_id) {
          return jsonResponse({ message_id: "mid_private", recipient_id: "psid_1" });
        }
        return jsonResponse({
          message_id: "mid_followup",
          recipient_id: body?.recipient?.id ?? "psid_1",
        });
      }
      return undefined;
    });

    const rule = await insertRule(ctx, { keywords: ["link"], platform: "facebook" });
    await sendFacebookComment(ctx, { commentId: "fb_comment_psid", fromId: "psid_1" });

    const execution = await getExecution(ctx, "fb_comment_psid");
    expect(execution?.recipient_igsid).toBe("psid_1");
    expect(execution?.state).toBe("awaiting_opt_in");

    await sendFacebookMessage(ctx, { senderId: "psid_1", text: "YES" });

    expect((await getExecution(ctx, "fb_comment_psid"))?.state).toBe("completed");
    const job = await getJob(ctx, "fb_comment_psid", "followup_dm");
    expect(job?.status).toBe("done");
    expect(job?.platform).toBe("facebook");

    const messages = meta.callsTo("/messages");
    expect(messages).toHaveLength(2);
    expect(messages[1]?.body).toMatchObject({
      recipient: { id: "psid_1" },
      messaging_type: "RESPONSE",
      message: { text: rule.followup_dm_text },
    });
  });

  it("posts a public reply under the Facebook comment", async () => {
    await insertRule(ctx, {
      keywords: ["link"],
      platform: "facebook",
      public_replies: ["Sent you a DM!"],
    });

    await sendFacebookComment(ctx, { commentId: "fb_comment_public", fromId: "psid_2" });

    const job = await getJob(ctx, "fb_comment_public", "public_reply");
    expect(job?.status).toBe("queued");
    expect(job?.platform).toBe("facebook");

    await ctx.env.DB.prepare(
      "UPDATE outbound_jobs SET run_after = ? WHERE comment_id = ? AND job_type = 'public_reply'",
    )
      .bind(new Date(Date.now() - 1000).toISOString(), "fb_comment_public")
      .run();

    const { drainQueue } = await import("../src/queue");
    await drainQueue(ctx.env);

    const comments = meta.callsTo("/comments");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.url).toContain("/fb_comment_public/comments");
    expect(comments[0]?.body).toMatchObject({ message: "Sent you a DM!" });
  });

  it("handles a Facebook comment delivered as field changes/comments", async () => {
    await insertRule(ctx, { keywords: ["link"], platform: "facebook" });

    const request = await import("./helpers").then((helpers) =>
      helpers.signedWebhookRequest("test-app-secret", {
        object: "page",
        entry: [
          {
            id: PAGE_ID,
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: "comments",
                value: {
                  item: "comment",
                  verb: "add",
                  comment_id: "fb_comment_changes",
                  post_id: "page_1_222",
                  from: { id: "psid_3", name: "Changes Fan" },
                  message: "link please",
                },
              },
            ],
          },
        ],
      }),
    );

    const response = await ctx.dispatch(request);
    await ctx.settle();
    expect(response.status).toBe(200);
    expect((await getExecution(ctx, "fb_comment_changes"))?.state).toBe("awaiting_opt_in");
  });

  it("ignores Facebook comment replies", async () => {
    await insertRule(ctx, { keywords: ["link"], platform: "facebook" });
    await sendFacebookComment(ctx, {
      commentId: "fb_comment_reply",
      fromId: "psid_4",
      parentId: "fb_parent",
    });

    const execution = await getExecution(ctx, "fb_comment_reply");
    expect(execution?.state).toBe("ignored");
    expect(execution?.last_error).toBe("reply_to_comment");
  });
});

describe("platform targeting", () => {
  it("does not match an Instagram-only rule on a Facebook comment", async () => {
    await insertRule(ctx, { keywords: ["link"], platform: "instagram" });
    await sendFacebookComment(ctx, { commentId: "fb_instagram_only", fromId: "psid_5" });

    const execution = await getExecution(ctx, "fb_instagram_only");
    expect(execution?.state).toBe("ignored");
    expect(execution?.last_error).toBe("no_matching_rule");
    expect(meta.callsTo("/messages")).toHaveLength(0);
  });

  it("does not match a Facebook-only rule on an Instagram comment", async () => {
    await insertRule(ctx, { keywords: ["link"], platform: "facebook" });
    await sendComment(ctx, { commentId: "ig_facebook_only", fromId: "igsid_6" });

    const execution = await getExecution(ctx, "ig_facebook_only");
    expect(execution?.state).toBe("ignored");
    expect(execution?.last_error).toBe("no_matching_rule");
    expect(meta.callsTo("/messages")).toHaveLength(0);
  });

  it("matches a specific Facebook post id, including the bare form", async () => {
    await insertRule(ctx, {
      keywords: ["link"],
      platform: "facebook",
      target_mode: "specific_posts",
      media_ids: ["page_1_333"],
    });

    await sendFacebookComment(ctx, {
      commentId: "fb_specific",
      postId: "page_1_333",
      fromId: "psid_7",
    });
    expect((await getExecution(ctx, "fb_specific"))?.state).toBe("awaiting_opt_in");

    await sendFacebookComment(ctx, {
      commentId: "fb_specific_bare",
      postId: "333",
      fromId: "psid_8",
    });
    expect((await getExecution(ctx, "fb_specific_bare"))?.state).toBe("awaiting_opt_in");
  });
});

describe("Facebook Page admin", () => {
  it("connects the Page from the main token", async () => {
    const page = await connectPage(ctx.env);
    expect(page.page_id).toBe(PAGE_ID);
    expect(page.name).toBeTruthy();
  });

  it("reports the Page in /admin/api/state", async () => {
    const cookie = await login(ctx);
    const response = await adminRequest(ctx, "/admin/api/state", { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      page: { page_id: string } | null;
      page_token: string | null;
    };
    expect(body.page?.page_id).toBe(PAGE_ID);
    expect(body.page_token).toBeNull();
  });

  it("marks a dedicated Page token as configured", async () => {
    await savePageToken(ctx.env, FACEBOOK_TOKEN);
    const cookie = await login(ctx);
    const response = await adminRequest(ctx, "/admin/api/state", { cookie });
    const body = (await response.json()) as { page_token: string | null };
    expect(body.page_token).toBe("configured");
  });

  it("syncs Facebook Page posts into the media cache", async () => {
    const cookie = await login(ctx);
    const response = await adminRequest(ctx, "/admin/api/media/sync", {
      method: "POST",
      body: {},
      cookie,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { facebook: number; media: Array<Record<string, unknown>> };
    expect(body.facebook).toBe(1);

    const facebook = body.media.filter((item) => item.platform === "facebook");
    expect(facebook).toHaveLength(1);
    expect(facebook[0]?.media_id).toBe("page_1_111");
  });
});
