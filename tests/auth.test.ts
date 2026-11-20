import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAllLoginFailures } from "../src/auth";
import { getToken } from "../src/meta";
import {
  ADMIN_PASSWORD,
  createTestContext,
  installMetaMock,
  jsonRequest,
  login,
  type MetaMock,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let meta: MetaMock;

beforeEach(async () => {
  resetAllLoginFailures();
  ctx = await createTestContext();
  meta = installMetaMock();
});

afterEach(async () => {
  await ctx.close();
  vi.unstubAllGlobals();
});

describe("admin login", () => {
  it("shows the login page without a session", async () => {
    const response = await ctx.dispatch(new Request("https://example.com/admin"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Admin password");
    expect(html).not.toContain("Automation rules");
  });

  it("rejects a wrong password", async () => {
    const response = await ctx.dispatch(
      jsonRequest("/admin/login", { password: "nope" }, { "cf-connecting-ip": "198.51.100.1" }),
    );
    expect(response.status).toBe(401);
  });

  it("sets a signed HttpOnly session cookie on success", async () => {
    const response = await ctx.dispatch(
      jsonRequest(
        "/admin/login",
        { password: ADMIN_PASSWORD },
        { "cf-connecting-ip": "198.51.100.2" },
      ),
    );
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ig_admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Max-Age=604800");
  });

  it("serves the dashboard with a valid session", async () => {
    const cookie = await login(ctx);
    const response = await ctx.dispatch(
      new Request("https://example.com/admin", { headers: { cookie } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Automation rules");
  });

  it("rejects a tampered session cookie", async () => {
    const cookie = await login(ctx);
    const tampered = `${cookie.slice(0, -2)}xx`;
    const response = await ctx.dispatch(
      new Request("https://example.com/admin/api/state", { headers: { cookie: tampered } }),
    );
    expect(response.status).toBe(401);
  });

  it("requires a session for the admin API", async () => {
    const response = await ctx.dispatch(new Request("https://example.com/admin/api/state"));
    expect(response.status).toBe(401);
  });

  it("throttles repeated failed logins", async () => {
    const ip = "198.51.100.3";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await ctx.dispatch(
        jsonRequest("/admin/login", { password: "wrong" }, { "cf-connecting-ip": ip }),
      );
      expect(response.status).toBe(401);
    }

    const blocked = await ctx.dispatch(
      jsonRequest("/admin/login", { password: ADMIN_PASSWORD }, { "cf-connecting-ip": ip }),
    );
    expect(blocked.status).toBe(429);
  });

  it("clears the cookie on logout", async () => {
    const cookie = await login(ctx);
    const response = await ctx.dispatch(
      new Request("https://example.com/admin/logout", { method: "POST", headers: { cookie } }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("admin API safety", () => {
  it("requires application/json for mutations (CSRF defense)", async () => {
    const cookie = await login(ctx);
    const response = await ctx.dispatch(
      new Request("https://example.com/admin/api/rules", {
        method: "POST",
        headers: { cookie, "content-type": "text/plain" },
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(response.status).toBe(415);
  });

  it("validates rule payloads", async () => {
    const cookie = await login(ctx);
    const response = await ctx.dispatch(
      jsonRequest("/admin/api/rules", { name: "" }, { cookie }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("creates, toggles and deletes a rule", async () => {
    const cookie = await login(ctx);

    const created = await ctx.dispatch(
      jsonRequest(
        "/admin/api/rules",
        {
          name: "Guide rule",
          target_mode: "all_posts",
          match_mode: "any_keyword",
          keywords: ["guide"],
          delivery_mode: "two_step_opt_in",
          initial_dm_text: "Reply YES for the guide",
          followup_dm_text: "https://example.com/guide",
          public_replies: ["Sent!"],
          priority: 5,
          enabled: true,
        },
        { cookie },
      ),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { rule: { id: string; keywords: string[] } };
    expect(createdBody.rule.keywords).toEqual(["guide"]);

    const toggled = await ctx.dispatch(
      jsonRequest(
        `/admin/api/rules/${createdBody.rule.id}/toggle`,
        { enabled: false },
        { cookie },
      ),
    );
    expect(toggled.status).toBe(200);

    const list = await ctx.dispatch(
      new Request("https://example.com/admin/api/rules", { headers: { cookie } }),
    );
    const listBody = (await list.json()) as { rules: Array<{ enabled: boolean }> };
    expect(listBody.rules[0]?.enabled).toBe(false);

    const deleted = await ctx.dispatch(
      new Request(`https://example.com/admin/api/rules/${createdBody.rule.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(deleted.status).toBe(200);
  });
});

describe("token management", () => {
  it("validates the token, stores it encrypted, and never writes plaintext", async () => {
    const cookie = await login(ctx);
    const token = "IGAA-secret-token-value-abcdefghijklmnop";

    const response = await ctx.dispatch(
      jsonRequest("/admin/api/token", { token }, { cookie }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { account: { username: string } };
    expect(body.account.username).toBe("testaccount");

    const row = await ctx.env.DB.prepare(
      "SELECT value_encrypted FROM system_config WHERE key = 'ig_token'",
    ).first<{ value_encrypted: string }>();
    expect(row?.value_encrypted).toMatch(/^v1\./);
    expect(row?.value_encrypted).not.toContain(token);

    expect(await getToken(ctx.env)).toBe(token);
  });

  it("surfaces Meta validation errors", async () => {
    vi.unstubAllGlobals();
    meta = installMetaMock((call) =>
      call.path.endsWith("/me")
        ? new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
        : undefined,
    );

    const cookie = await login(ctx);
    const response = await ctx.dispatch(
      jsonRequest("/admin/api/token", { token: "IGAA-bad-token-value-1234567890" }, { cookie }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Invalid OAuth access token");
  });

  it("syncs recent media into the cache", async () => {
    const cookie = await login(ctx);
    const response = await ctx.dispatch(
      jsonRequest("/admin/api/media/sync", {}, { cookie }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { synced: number; media: Array<{ media_id: string }> };
    expect(body.synced).toBe(2);
    expect(body.media.map((item) => item.media_id)).toEqual(["media_2", "media_1"]);
  });
});
