import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import { app } from "../src/index";
import { saveAccount, saveToken, signWebhookBody } from "../src/meta";
import type { Env, Rule } from "../src/types";
import { D1Sqlite } from "./d1";

export const ACCOUNT_ID = "17841400000000001";
export const TEST_TOKEN = "IGQVJ-test-token-value";
export const APP_SECRET = "test-app-secret";
export const VERIFY_TOKEN = "test-verify-token";
export const ADMIN_PASSWORD = "test-admin-password";
export const SESSION_SECRET = "test-session-secret";
export const ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

export interface TestContext {
  env: Env;
  db: D1Database;
  sqlite: DatabaseSync;
  waits: Promise<unknown>[];
  dispatch(request: Request): Promise<Response>;
  settle(): Promise<void>;
  close(): void;
}

export async function createTestContext(
  options: { withAccount?: boolean; withToken?: boolean } = {},
): Promise<TestContext> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const db = new D1Sqlite(sqlite) as unknown as D1Database;

  const env: Env = {
    DB: db,
    IG_APP_SECRET: APP_SECRET,
    WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    ADMIN_PASSWORD,
    SESSION_SECRET,
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    GRAPH_API_VERSION: "v25.0",
  };

  const ctx: TestContext = {
    env,
    db,
    sqlite,
    waits: [],
    async dispatch(request: Request): Promise<Response> {
      const executionCtx = {
        waitUntil(promise: Promise<unknown>) {
          ctx.waits.push(promise);
        },
        passThroughOnException() {
          /* noop */
        },
        props: {},
      } as unknown as ExecutionContext;
      return app.fetch(request, env, executionCtx);
    },
    async settle(): Promise<void> {
      const pending = ctx.waits.splice(0);
      await Promise.allSettled(pending);
    },
    close(): void {
      sqlite.close();
    },
  };

  if (options.withAccount !== false) {
    await saveAccount(env, { user_id: ACCOUNT_ID, username: "testaccount" });
  }
  if (options.withToken !== false) {
    await saveToken(env, TEST_TOKEN);
  }

  return ctx;
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

export async function signedWebhookRequest(secret: string, payload: unknown): Promise<Request> {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = await signWebhookBody(secret, raw);
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body: raw,
  });
}

export function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function commentPayload(options: {
  commentId?: string;
  text?: string;
  mediaId?: string;
  fromId?: string;
  username?: string;
  parentId?: string;
}): Record<string, unknown> {
  const value: Record<string, unknown> = {
    id: options.commentId ?? "comment_1",
    text: options.text ?? "send the link",
    media: { id: options.mediaId ?? "media_1", media_product_type: "REELS" },
    from: { id: options.fromId ?? "user_1", username: options.username ?? "fan" },
  };
  if (options.parentId) value.parent_id = options.parentId;

  return {
    object: "instagram",
    entry: [
      {
        id: ACCOUNT_ID,
        time: Math.floor(Date.now() / 1000),
        changes: [{ field: "comments", value }],
      },
    ],
  };
}

export function messagePayload(options: {
  senderId?: string;
  text?: string;
  isEcho?: boolean;
  mid?: string;
}): Record<string, unknown> {
  return {
    object: "instagram",
    entry: [
      {
        id: ACCOUNT_ID,
        time: Math.floor(Date.now() / 1000),
        messaging: [
          {
            sender: { id: options.senderId ?? "user_1" },
            recipient: { id: ACCOUNT_ID },
            timestamp: Date.now(),
            message: {
              mid: options.mid ?? `mid_${Math.random().toString(36).slice(2)}`,
              text: options.text ?? "yes",
              ...(options.isEcho ? { is_echo: true } : {}),
            },
          },
        ],
      },
    ],
  };
}

export async function sendComment(
  ctx: TestContext,
  options: Parameters<typeof commentPayload>[0] = {},
): Promise<Response> {
  const request = await signedWebhookRequest(APP_SECRET, commentPayload(options));
  const response = await ctx.dispatch(request);
  await ctx.settle();
  return response;
}

export async function sendMessage(
  ctx: TestContext,
  options: Parameters<typeof messagePayload>[0] = {},
): Promise<Response> {
  const request = await signedWebhookRequest(APP_SECRET, messagePayload(options));
  const response = await ctx.dispatch(request);
  await ctx.settle();
  return response;
}

export async function login(ctx: TestContext, ip = "203.0.113.10"): Promise<string> {
  const response = await ctx.dispatch(
    jsonRequest("/admin/login", { password: ADMIN_PASSWORD }, { "cf-connecting-ip": ip }),
  );
  if (response.status !== 200) throw new Error(`Login failed with status ${response.status}`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] as string;
}

export async function adminRequest(
  ctx: TestContext,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return ctx.dispatch(
    new Request(`https://example.com${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Database fixtures                                                   */
/* ------------------------------------------------------------------ */

export async function insertRule(ctx: TestContext, overrides: Partial<Rule> = {}): Promise<Rule> {
  const now = new Date().toISOString();
  const rule: Rule = {
    id: crypto.randomUUID(),
    name: "Test rule",
    target_mode: "all_posts",
    media_ids: [],
    match_mode: "any_keyword",
    keywords: ["link"],
    delivery_mode: "two_step_opt_in",
    initial_dm_text: "Want the link? Reply YES and I’ll send it.",
    opt_in_keywords: [],
    followup_dm_text: "Here you go: https://example.com/guide",
    public_replies: [],
    priority: 0,
    enabled: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };

  await ctx.env.DB.prepare(
    `INSERT INTO rules
       (id, name, target_mode, media_ids_json, match_mode, keywords_json, delivery_mode,
        initial_dm_text, opt_in_keywords_json, followup_dm_text, public_replies_json,
        priority, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      rule.id,
      rule.name,
      rule.target_mode,
      JSON.stringify(rule.media_ids),
      rule.match_mode,
      JSON.stringify(rule.keywords),
      rule.delivery_mode,
      rule.initial_dm_text,
      JSON.stringify(rule.opt_in_keywords),
      rule.followup_dm_text,
      JSON.stringify(rule.public_replies),
      rule.priority,
      rule.enabled ? 1 : 0,
      rule.created_at,
      rule.updated_at,
    )
    .run();

  return rule;
}

export async function getExecution(
  ctx: TestContext,
  commentId: string,
): Promise<Record<string, unknown> | null> {
  return ctx.env.DB.prepare("SELECT * FROM comment_executions WHERE comment_id = ?")
    .bind(commentId)
    .first<Record<string, unknown>>();
}

export async function getJob(
  ctx: TestContext,
  commentId: string,
  jobType: string,
): Promise<Record<string, unknown> | null> {
  return ctx.env.DB.prepare(
    "SELECT * FROM outbound_jobs WHERE comment_id = ? AND job_type = ?",
  )
    .bind(commentId, jobType)
    .first<Record<string, unknown>>();
}

export async function countRows(
  ctx: TestContext,
  table: "comment_executions" | "outbound_jobs" | "rules",
): Promise<number> {
  const row = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/* ------------------------------------------------------------------ */
/* Meta API mock                                                       */
/* ------------------------------------------------------------------ */

export interface MetaCall {
  url: string;
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface MetaMock {
  calls: MetaCall[];
  callsTo(fragment: string): MetaCall[];
  fetchMock: ReturnType<typeof vi.fn>;
}

export function installMetaMock(
  handler?: (call: MetaCall) => Response | undefined,
): MetaMock {
  const calls: MetaCall[] = [];

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String((input as Request).url);
    const parsed = new URL(url);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call: MetaCall = {
      url,
      path: parsed.pathname,
      method: init?.method ?? "GET",
      body,
    };
    calls.push(call);

    const custom = handler?.(call);
    if (custom) return custom;

    if (call.path === "/refresh_access_token") {
      return jsonResponse({ access_token: "refreshed-token", expires_in: 5_184_000 });
    }
    if (call.path.endsWith("/me/media")) {
      return jsonResponse({
        data: [
          {
            id: "media_1",
            caption: "First post",
            media_type: "VIDEO",
            media_product_type: "REELS",
            permalink: "https://instagram.com/p/one",
            thumbnail_url: "https://cdn.example.com/one.jpg",
            timestamp: "2026-11-01T10:00:00+0000",
          },
          {
            id: "media_2",
            caption: "Second post",
            media_type: "IMAGE",
            media_url: "https://cdn.example.com/two.jpg",
            permalink: "https://instagram.com/p/two",
            timestamp: "2026-11-02T10:00:00+0000",
          },
        ],
      });
    }
    if (call.path.endsWith("/me/messages")) {
      return jsonResponse({ message_id: `mid_${calls.length}`, recipient_id: "user_1" });
    }
    if (call.path.endsWith("/replies")) {
      return jsonResponse({ id: `reply_${calls.length}` });
    }
    if (call.path.endsWith("/me")) {
      return jsonResponse({ user_id: ACCOUNT_ID, username: "testaccount" });
    }
    return jsonResponse({});
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    calls,
    callsTo(fragment: string) {
      return calls.filter((call) => call.url.includes(fragment));
    },
    fetchMock,
  };
}
