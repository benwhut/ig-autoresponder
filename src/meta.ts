import type { AccountInfo, Env, MediaRow, PageAccountInfo, TokenType } from "./types";
import { isoPlusSeconds, nowIso } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64Decode(input: string): Uint8Array {
  const binary = atob(input.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += (bytes[i] as number).toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Hashing / HMAC / constant-time compare                              */
/* ------------------------------------------------------------------ */

export async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

export async function hmacSha256(secret: string, data: string | Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = typeof data === "string" ? encoder.encode(data) : data;
  const signature = await crypto.subtle.sign("HMAC", key, payload as BufferSource);
  return new Uint8Array(signature);
}

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Compares two strings without leaking their contents through timing. */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqualBytes(hashA, hashB);
}

export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = await hmacSha256(appSecret, rawBody);
  const provided = fromHex((match[1] as string).toLowerCase());
  return timingSafeEqualBytes(expected, provided);
}

export function signWebhookBody(appSecret: string, rawBody: string): Promise<string> {
  return hmacSha256(appSecret, rawBody).then((bytes) => `sha256=${toHex(bytes)}`);
}

/* ------------------------------------------------------------------ */
/* AES-256-GCM encryption for the stored Instagram token               */
/* ------------------------------------------------------------------ */

const aesKeyCache = new Map<string, CryptoKey>();

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const cached = aesKeyCache.get(keyBase64);
  if (cached) return cached;

  let raw: Uint8Array;
  try {
    raw = base64Decode(keyBase64);
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEY is not valid base64");
  }
  if (raw.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes. Generate one with: openssl rand -base64 32",
    );
  }
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  aesKeyCache.set(keyBase64, key);
  return key;
}

export async function encryptString(keyBase64: string, plaintext: string): Promise<string> {
  const key = await importAesKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      encoder.encode(plaintext) as BufferSource,
    ),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

export async function decryptString(keyBase64: string, payload: string): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted value format");
  }
  const key = await importAesKey(keyBase64);
  const iv = base64UrlDecode(parts[1] as string);
  const ciphertext = base64UrlDecode(parts[2] as string);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return decoder.decode(plaintext);
}

/* ------------------------------------------------------------------ */
/* system_config storage                                               */
/* ------------------------------------------------------------------ */

export interface ConfigValue {
  value: string;
  expires_at: string | null;
  updated_at: string;
}

export async function getConfig(env: Env, key: string): Promise<ConfigValue | null> {
  const row = await env.DB.prepare(
    "SELECT key, value_encrypted, expires_at, updated_at FROM system_config WHERE key = ?",
  )
    .bind(key)
    .first<{ key: string; value_encrypted: string; expires_at: string | null; updated_at: string }>();
  if (!row) return null;
  return {
    value: await decryptString(env.TOKEN_ENCRYPTION_KEY, row.value_encrypted),
    expires_at: row.expires_at,
    updated_at: row.updated_at,
  };
}

export async function setConfig(
  env: Env,
  key: string,
  value: string,
  expiresAt: string | null,
): Promise<void> {
  const encrypted = await encryptString(env.TOKEN_ENCRYPTION_KEY, value);
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO system_config (key, value_encrypted, expires_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_encrypted = excluded.value_encrypted,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
  )
    .bind(key, encrypted, expiresAt, timestamp)
    .run();
}

export async function deleteConfig(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM system_config WHERE key = ?").bind(key).run();
}

export async function getToken(env: Env): Promise<string | null> {
  try {
    const row = await getConfig(env, "ig_token");
    return row?.value ?? null;
  } catch (error) {
    console.error("Failed to decrypt Instagram token", error);
    return null;
  }
}

export async function saveToken(
  env: Env,
  token: string,
  expiresInSeconds: number | null = 60 * 24 * 60 * 60,
): Promise<string | null> {
  const expiresAt = expiresInSeconds === null ? null : isoPlusSeconds(expiresInSeconds);
  await setConfig(env, "ig_token", token.trim(), expiresAt);
  return expiresAt;
}

export async function getAccount(env: Env): Promise<AccountInfo | null> {
  try {
    const row = await getConfig(env, "ig_account");
    if (!row) return null;
    const parsed = JSON.parse(row.value) as AccountInfo;
    if (!parsed || typeof parsed.user_id !== "string") return null;
    return parsed;
  } catch (error) {
    console.error("Failed to read Instagram account config", error);
    return null;
  }
}

export async function saveAccount(env: Env, account: AccountInfo): Promise<void> {
  await setConfig(env, "ig_account", JSON.stringify(account), null);
}

/* ------------------------------------------------------------------ */
/* Facebook Page config                                                */
/* ------------------------------------------------------------------ */

export async function getPage(env: Env): Promise<PageAccountInfo | null> {
  try {
    const row = await getConfig(env, "fb_page");
    if (!row) return null;
    const parsed = JSON.parse(row.value) as PageAccountInfo;
    return parsed?.page_id ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePage(env: Env, page: PageAccountInfo): Promise<void> {
  await setConfig(env, "fb_page", JSON.stringify(page), null);
}

export async function deletePage(env: Env): Promise<void> {
  await deleteConfig(env, "fb_page");
}

/**
 * The token used for Messenger calls. A dedicated Page token wins; otherwise
 * the main Instagram/Business token is used (a System User token with the Page
 * asset works for both).
 */
export async function getPageToken(env: Env): Promise<string | null> {
  try {
    const row = await getConfig(env, "fb_page_token");
    if (row?.value) return row.value;
  } catch {
    /* fall through to the main token */
  }
  return getToken(env);
}

export async function savePageToken(env: Env, token: string): Promise<void> {
  await setConfig(env, "fb_page_token", token, null);
}

/** True when a dedicated Page token is stored (not the main-token fallback). */
export async function hasPageToken(env: Env): Promise<boolean> {
  try {
    const row = await getConfig(env, "fb_page_token");
    return Boolean(row?.value);
  } catch {
    return false;
  }
}

export async function deletePageToken(env: Env): Promise<void> {
  await deleteConfig(env, "fb_page_token");
}

export interface TokenStatus {
  state: "missing" | "ok" | "expiring" | "expired";
  expires_at: string | null;
  updated_at: string | null;
  days_left: number | null;
  /** True for non-expiring System User tokens. */
  never_expires: boolean;
}

export async function getTokenStatus(env: Env): Promise<TokenStatus> {
  const row = await env.DB.prepare(
    "SELECT expires_at, updated_at FROM system_config WHERE key = 'ig_token'",
  ).first<{ expires_at: string | null; updated_at: string }>();

  if (!row) {
    return {
      state: "missing",
      expires_at: null,
      updated_at: null,
      days_left: null,
      never_expires: false,
    };
  }

  // A null expiry means a non-expiring System User token.
  if (row.expires_at === null) {
    return {
      state: "ok",
      expires_at: null,
      updated_at: row.updated_at,
      days_left: null,
      never_expires: true,
    };
  }

  const expiresMs = Date.parse(row.expires_at);
  if (Number.isNaN(expiresMs)) {
    return {
      state: "ok",
      expires_at: row.expires_at,
      updated_at: row.updated_at,
      days_left: null,
      never_expires: false,
    };
  }

  const days = (expiresMs - Date.now()) / 86_400_000;
  let state: TokenStatus["state"] = "ok";
  if (days <= 0) state = "expired";
  else if (days < 14) state = "expiring";

  return {
    state,
    expires_at: row.expires_at,
    updated_at: row.updated_at,
    days_left: Math.round(days * 10) / 10,
    never_expires: false,
  };
}

/* ------------------------------------------------------------------ */
/* Graph API client                                                    */
/* ------------------------------------------------------------------ */

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function apiVersion(env: Env): string {
  const configured = env.GRAPH_API_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : "v25.0";
}

/**
 * IGAA… tokens belong to the Instagram Graph API (graph.instagram.com).
 * Everything else — EAA… Business/System User/Page tokens — belongs to the
 * Facebook Graph API (graph.facebook.com).
 */
export function detectTokenType(token: string): TokenType {
  return token.trim().startsWith("IGAA") ? "instagram_graph" : "facebook_graph";
}

export function graphBaseUrl(env: Env, tokenType: TokenType): string {
  const host =
    tokenType === "instagram_graph"
      ? "https://graph.instagram.com"
      : "https://graph.facebook.com";
  return `${host}/${apiVersion(env)}`;
}

/**
 * On graph.facebook.com the actor is the resolved Instagram business account id,
 * not `/me`. On graph.instagram.com the token's own `/me` is correct.
 */
export function actorPath(token: string, igUserId: string | null): string {
  if (detectTokenType(token) === "instagram_graph") return "/me";
  if (!igUserId) {
    throw new GraphApiError(
      "This token needs an Instagram business account id. Re-save the token in the admin dashboard.",
      { status: 400 },
    );
  }
  return `/${encodeURIComponent(igUserId)}`;
}

export class GraphApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly transient: boolean;

  constructor(
    message: string,
    options: { status: number; code?: number; subcode?: number; transient?: boolean },
  ) {
    super(message);
    this.name = "GraphApiError";
    this.status = options.status;
    this.code = options.code;
    this.subcode = options.subcode;
    this.transient = options.transient ?? false;
  }

  /** 429/5xx, Meta "temporary" codes, and network failures are worth retrying. */
  get retryable(): boolean {
    if (this.status === 0 || this.status === 429 || this.status >= 500) return true;
    if (this.transient) return true;
    if (this.code !== undefined && [1, 2, 4, 17, 32, 341, 613].includes(this.code)) return true;
    return false;
  }
}

function parseGraphError(status: number, text: string): GraphApiError {
  let message = `Graph API request failed with HTTP ${status}`;
  let code: number | undefined;
  let subcode: number | undefined;
  let transient = false;

  try {
    const parsed = JSON.parse(text) as { error?: Record<string, unknown> };
    const error = parsed.error;
    if (error) {
      const userMessage = typeof error.error_user_msg === "string" ? error.error_user_msg : "";
      const rawMessage = typeof error.message === "string" ? error.message : "";
      message = userMessage || rawMessage || message;
      if (typeof error.code === "number") code = error.code;
      if (typeof error.error_subcode === "number") subcode = error.error_subcode;
      transient = error.is_transient === true;
    }
  } catch {
    if (text.trim()) message = `${message}: ${text.trim().slice(0, 300)}`;
  }

  return new GraphApiError(message, { status, code, subcode, transient });
}

interface GraphRequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
}

async function graphRequest(
  env: Env,
  token: string,
  path: string,
  options: GraphRequestOptions = {},
): Promise<JsonObject> {
  const trimmedToken = token.trim();
  const base = graphBaseUrl(env, detectTokenType(trimmedToken));
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", trimmedToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const init: RequestInit = {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    };
    if (options.body !== undefined) {
      init.headers = { ...init.headers, "content-type": "application/json" };
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), init);
    const text = await response.text();

    if (!response.ok) throw parseGraphError(response.status, text);

    if (!text) return {};
    try {
      return JSON.parse(text) as JsonObject;
    } catch {
      throw new GraphApiError("Graph API returned invalid JSON", {
        status: response.status,
        transient: true,
      });
    }
  } catch (error) {
    if (error instanceof GraphApiError) throw error;
    const message = error instanceof Error ? error.message : "Network error";
    throw new GraphApiError(`Could not reach Instagram: ${message}`, { status: 0, transient: true });
  } finally {
    clearTimeout(timer);
  }
}

interface ResolvedInstagramAccount {
  id: string;
  username: string;
}

/**
 * Resolves the Instagram business account behind an EAA… token.
 * 1. GET /me/assigned_instagram_accounts?fields=id,username
 * 2. Fallback: GET /me/accounts?fields=instagram_business_account{id,username}
 */
async function resolveFacebookInstagramAccount(
  env: Env,
  token: string,
): Promise<ResolvedInstagramAccount> {
  let firstError: unknown = null;

  try {
    const assigned = await graphRequest(env, token, "/me/assigned_instagram_accounts", {
      query: { fields: "id,username" },
    });
    const first = Array.isArray(assigned.data) ? asObject(assigned.data[0]) : null;
    if (first && asString(first.id)) {
      return { id: asString(first.id), username: asString(first.username) };
    }
  } catch (error) {
    firstError = error;
  }

  try {
    const accounts = await graphRequest(env, token, "/me/accounts", {
      query: { fields: "instagram_business_account{id,username}" },
    });
    const pages = Array.isArray(accounts.data) ? accounts.data : [];
    for (const page of pages) {
      const business = asObject(asObject(page).instagram_business_account);
      if (asString(business.id)) {
        return { id: asString(business.id), username: asString(business.username) };
      }
    }
  } catch (error) {
    throw firstError ?? error;
  }

  throw (
    firstError ??
    new GraphApiError(
      "The token is valid but no Instagram Business account was found. Make sure the token can access an Instagram professional account.",
      { status: 400 },
    )
  );
}

/**
 * Reads the token expiry from /debug_token. System User tokens return
 * `expires_at: 0` (or omit it), which we store as a null expiry.
 */
async function detectTokenExpiry(env: Env, token: string): Promise<number | null> {
  try {
    const data = await graphRequest(env, token, "/debug_token", {
      query: { input_token: token },
    });
    const info = asObject(data.data);
    const expiresAt = Number(info.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt > 0) {
      return Math.floor((expiresAt * 1000 - Date.now()) / 1000);
    }
    return null;
  } catch (error) {
    // A token without a readable expiry is treated as non-expiring. EAA tokens
    // cannot be refreshed anyway, so this is the least misleading default.
    console.error("Could not read token expiry from /debug_token", error);
    return null;
  }
}

export async function validateToken(env: Env, token: string): Promise<AccountInfo> {
  const trimmed = token.trim();
  const tokenType = detectTokenType(trimmed);

  if (tokenType === "instagram_graph") {
    const data = await graphRequest(env, trimmed, "/me", {
      query: { fields: "user_id,username,account_type" },
    });

    const userId = String(data.user_id ?? data.id ?? "").trim();
    if (!userId) {
      throw new GraphApiError(
        "The token is valid but did not return an Instagram account id. Make sure it was generated for an Instagram professional account.",
        { status: 400 },
      );
    }

    const username = String(data.username ?? "").trim();
    const account: AccountInfo = {
      user_id: userId,
      username: username || "unknown",
      token_type: "instagram_graph",
      connected_at: nowIso(),
    };
    if (typeof data.account_type === "string") account.account_type = data.account_type;
    return account;
  }

  const resolved = await resolveFacebookInstagramAccount(env, trimmed);
  return {
    user_id: resolved.id,
    username: resolved.username || "unknown",
    token_type: "facebook_graph",
    connected_at: nowIso(),
  };
}

export async function connectToken(env: Env, token: string): Promise<AccountInfo> {
  const trimmed = token.trim();
  const account = await validateToken(env, trimmed);

  // IGAA tokens expire in ~60 days. EAA tokens may be System User tokens that
  // never expire, so ask /debug_token for the real expiry.
  const expiresInSeconds =
    account.token_type === "facebook_graph"
      ? await detectTokenExpiry(env, trimmed)
      : 60 * 24 * 60 * 60;

  await saveToken(env, trimmed, expiresInSeconds);
  await saveAccount(env, account);
  return account;
}

/**
 * Resolves and stores the Facebook Page used for Messenger replies.
 *
 * Order:
 *  1. An explicit `pageId` argument.
 *  2. `/me/accounts` — pick the Page linked to the Instagram account, else the first.
 *  3. `/me` — a Page access token resolves to the Page itself.
 */
export async function connectPage(
  env: Env,
  options: { token?: string; pageId?: string } = {},
): Promise<PageAccountInfo> {
  const token = (options.token ?? (await getPageToken(env)) ?? "").trim();
  if (!token) {
    throw new GraphApiError(
      "No Facebook Page token is configured. Save a Page access token first.",
      { status: 400 },
    );
  }

  if (options.pageId) {
    const data = await graphRequest(env, token, `/${encodeURIComponent(options.pageId)}`, {
      query: { fields: "id,name" },
    });
    const page: PageAccountInfo = {
      page_id: asString(data.id) || options.pageId,
      name: asString(data.name) || "Facebook Page",
      connected_at: nowIso(),
    };
    await savePage(env, page);
    return page;
  }

  const account = await getAccount(env);

  try {
    const accounts = await graphRequest(env, token, "/me/accounts", {
      query: { fields: "id,name,instagram_business_account{id}", limit: "100" },
    });
    const pages = Array.isArray(accounts.data) ? accounts.data.map(asObject) : [];
    if (pages.length > 0) {
      const linked = account
        ? pages.find(
            (page) => asString(asObject(page.instagram_business_account).id) === account.user_id,
          )
        : undefined;
      const chosen = linked ?? (pages[0] as JsonObject);
      const page: PageAccountInfo = {
        page_id: asString(chosen.id),
        name: asString(chosen.name) || "Facebook Page",
        connected_at: nowIso(),
      };
      await savePage(env, page);
      return page;
    }
  } catch {
    /* fall through to /me */
  }

  // A Page access token (not a user/system-user token) resolves `/me` to the Page.
  const me = await graphRequest(env, token, "/me", {
    query: { fields: "id,name,category" },
  });
  if (asString(me.id) && asString(me.category)) {
    const page: PageAccountInfo = {
      page_id: asString(me.id),
      name: asString(me.name) || "Facebook Page",
      connected_at: nowIso(),
    };
    await savePage(env, page);
    return page;
  }

  throw new GraphApiError(
    "The token cannot access any Facebook Pages. Add the Page to the token's assets and grant pages_show_list and pages_manage_metadata.",
    { status: 400 },
  );
}

export interface RefreshResult {
  refreshed: boolean;
  reason?: string;
  expires_at?: string | null;
}

/**
 * Refreshes the long-lived Instagram user token.
 * Meta requires the current token to be at least 24 hours old.
 * Auto-refresh only runs when the token expires in less than 30 days.
 *
 * Only IGAA… (graph.instagram.com) tokens support refresh. EAA… System User
 * tokens are managed in Meta Business Suite and never expire.
 */
export async function refreshToken(
  env: Env,
  options: { force?: boolean } = {},
): Promise<RefreshResult> {
  const row = await getConfig(env, "ig_token");
  if (!row) return { refreshed: false, reason: "No Instagram token has been configured yet" };

  const account = await getAccount(env);
  const tokenType = account?.token_type ?? detectTokenType(row.value);
  if (tokenType !== "instagram_graph") {
    return {
      refreshed: false,
      reason: "Business/System User tokens do not support refresh; they are managed in Meta Business Suite",
    };
  }

  if (row.expires_at === null) {
    return { refreshed: false, reason: "Token never expires" };
  }

  const now = Date.now();
  const expiresMs = Date.parse(row.expires_at);
  const ageMs = now - Date.parse(row.updated_at);

  if (!options.force) {
    if (Number.isFinite(ageMs) && ageMs < 24 * 60 * 60 * 1000) {
      return { refreshed: false, reason: "Token is less than 24 hours old" };
    }
    if (Number.isFinite(expiresMs) && expiresMs - now > 30 * 86_400_000) {
      return { refreshed: false, reason: "Token does not need refreshing yet" };
    }
  }

  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", row.value.trim());

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new GraphApiError(`Could not reach Instagram: ${message}`, { status: 0, transient: true });
  }

  const text = await response.text();
  if (!response.ok) throw parseGraphError(response.status, text);

  let data: JsonObject;
  try {
    data = JSON.parse(text) as JsonObject;
  } catch {
    throw new GraphApiError("Token refresh returned invalid JSON", { status: 0, transient: true });
  }

  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) {
    throw new GraphApiError("Token refresh did not return an access_token", { status: 400 });
  }

  const expiresIn = Number(data.expires_in);
  const expiresAt = await saveToken(
    env,
    accessToken,
    Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 60 * 86_400,
  );

  return { refreshed: true, expires_at: expiresAt };
}

/* ------------------------------------------------------------------ */
/* Messaging endpoints                                                 */
/* ------------------------------------------------------------------ */

export interface MessageSendResult {
  /** `recipient_id` echoed by Meta — matches `messaging.sender.id` on replies. */
  recipientId: string | null;
  messageId: string | null;
}

export async function sendPrivateReply(
  env: Env,
  token: string,
  igUserId: string | null,
  commentId: string,
  text: string,
): Promise<MessageSendResult> {
  const data = await graphRequest(env, token, `${actorPath(token, igUserId)}/messages`, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text } },
  });

  return {
    recipientId: asString(data.recipient_id) || null,
    messageId: asString(data.message_id) || null,
  };
}

export async function sendDirectMessage(
  env: Env,
  token: string,
  igUserId: string | null,
  recipientIgsid: string,
  text: string,
): Promise<MessageSendResult> {
  const data = await graphRequest(env, token, `${actorPath(token, igUserId)}/messages`, {
    method: "POST",
    body: { recipient: { id: recipientIgsid }, message: { text } },
  });

  return {
    recipientId: asString(data.recipient_id) || recipientIgsid,
    messageId: asString(data.message_id) || null,
  };
}

export async function replyToComment(
  env: Env,
  token: string,
  commentId: string,
  message: string,
): Promise<void> {
  await graphRequest(env, token, `/${encodeURIComponent(commentId)}/replies`, {
    method: "POST",
    body: { message },
  });
}

/* ------------------------------------------------------------------ */
/* Facebook Page: comments and Messenger                               */
/* ------------------------------------------------------------------ */

/** Sends a private reply to a Facebook commenter through Messenger. */
export async function sendMessengerPrivateReply(
  env: Env,
  token: string,
  pageId: string,
  commentId: string,
  text: string,
): Promise<MessageSendResult> {
  const data = await graphRequest(env, token, `/${encodeURIComponent(pageId)}/messages`, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text } },
  });

  return {
    recipientId: asString(data.recipient_id) || null,
    messageId: asString(data.message_id) || null,
  };
}

/** Sends a standard Messenger message to a Page-scoped id (PSID). */
export async function sendMessengerMessage(
  env: Env,
  token: string,
  pageId: string,
  psid: string,
  text: string,
): Promise<MessageSendResult> {
  const data = await graphRequest(env, token, `/${encodeURIComponent(pageId)}/messages`, {
    method: "POST",
    body: {
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text },
    },
  });

  return {
    recipientId: asString(data.recipient_id) || psid,
    messageId: asString(data.message_id) || null,
  };
}

/** Replies publicly under a Facebook comment. */
export async function replyToFacebookComment(
  env: Env,
  token: string,
  commentId: string,
  message: string,
): Promise<void> {
  await graphRequest(env, token, `/${encodeURIComponent(commentId)}/comments`, {
    method: "POST",
    body: { message },
  });
}

/** Subscribes the app to a Page's `feed` and `messages` webhooks. */
export async function subscribePageWebhooks(
  env: Env,
  token: string,
  pageId: string,
  fields = "feed,messages",
): Promise<void> {
  await graphRequest(env, token, `/${encodeURIComponent(pageId)}/subscribed_apps`, {
    method: "POST",
    query: { subscribed_fields: fields },
  });
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

function normalizeMediaType(raw: unknown, product: unknown): MediaRow["media_type"] {
  const productType = String(product ?? "").toUpperCase();
  if (productType === "REELS") return "REELS";
  const mediaType = String(raw ?? "").toUpperCase();
  if (mediaType === "VIDEO") return "VIDEO";
  if (mediaType === "CAROUSEL_ALBUM") return "CAROUSEL_ALBUM";
  return "IMAGE";
}

/** Maps a Facebook Page attachment type onto the shared media type union. */
function normalizePageMediaType(raw: unknown): MediaRow["media_type"] {
  const value = String(raw ?? "").toLowerCase();
  if (value === "video" || value === "reel" || value === "reels") return "VIDEO";
  if (value === "album" || value === "carousel") return "CAROUSEL_ALBUM";
  return "IMAGE";
}

export async function fetchRecentMedia(
  env: Env,
  token: string,
  igUserId: string | null,
  limit = 25,
): Promise<MediaRow[]> {
  const data = await graphRequest(env, token, `${actorPath(token, igUserId)}/media`, {
    query: {
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
      limit: String(limit),
    },
  });

  const items = Array.isArray(data.data) ? (data.data as JsonObject[]) : [];
  const syncedAt = nowIso();

  return items
    .map((item): MediaRow | null => {
      const mediaId = String(item.id ?? "").trim();
      if (!mediaId) return null;
      const thumbnail =
        typeof item.thumbnail_url === "string" && item.thumbnail_url
          ? item.thumbnail_url
          : typeof item.media_url === "string" && item.media_url
            ? item.media_url
            : null;
      return {
        media_id: mediaId,
        media_type: normalizeMediaType(item.media_type, item.media_product_type),
        caption: typeof item.caption === "string" ? item.caption : null,
        permalink: typeof item.permalink === "string" ? item.permalink : null,
        thumbnail_url: thumbnail,
        timestamp: typeof item.timestamp === "string" ? item.timestamp : syncedAt,
        synced_at: syncedAt,
        platform: "instagram",
      };
    })
    .filter((item): item is MediaRow => item !== null);
}

export async function cacheMedia(env: Env, items: MediaRow[]): Promise<void> {
  if (items.length === 0) return;
  const statements = items.map((item) =>
    env.DB.prepare(
      `INSERT INTO media_cache (media_id, media_type, caption, permalink, thumbnail_url, timestamp, synced_at, platform)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_id) DO UPDATE SET
         media_type = excluded.media_type,
         caption = excluded.caption,
         permalink = excluded.permalink,
         thumbnail_url = excluded.thumbnail_url,
         timestamp = excluded.timestamp,
         synced_at = excluded.synced_at,
         platform = excluded.platform`,
    ).bind(
      item.media_id,
      item.media_type,
      item.caption,
      item.permalink,
      item.thumbnail_url,
      item.timestamp,
      item.synced_at,
      item.platform,
    ),
  );
  await env.DB.batch(statements);
}

/** Syncs the Page's own posts so Facebook targets can be picked in the UI. */
export async function fetchPagePosts(
  env: Env,
  token: string,
  pageId: string,
  limit = 25,
): Promise<MediaRow[]> {
  const data = await graphRequest(env, token, `/${encodeURIComponent(pageId)}/posts`, {
    query: {
      fields:
        "id,message,created_time,permalink_url,full_picture,attachments{media_type,media{image}}",
      limit: String(limit),
    },
  });

  const items = Array.isArray(data.data) ? (data.data as JsonObject[]) : [];
  const syncedAt = nowIso();

  return items
    .map((item): MediaRow | null => {
      const postId = String(item.id ?? "").trim();
      if (!postId) return null;

      const attachments = asObject(item.attachments);
      const first = Array.isArray(attachments.data) ? asObject(attachments.data[0]) : {};
      const image = asObject(asObject(first.media).image);

      const thumbnail =
        typeof item.full_picture === "string" && item.full_picture
          ? item.full_picture
          : typeof image.src === "string" && image.src
            ? image.src
            : null;

      return {
        media_id: postId,
        media_type: normalizePageMediaType(first.media_type),
        caption: typeof item.message === "string" ? item.message : null,
        permalink: typeof item.permalink_url === "string" ? item.permalink_url : null,
        thumbnail_url: thumbnail,
        timestamp: typeof item.created_time === "string" ? item.created_time : syncedAt,
        synced_at: syncedAt,
        platform: "facebook",
      };
    })
    .filter((item): item is MediaRow => item !== null);
}
