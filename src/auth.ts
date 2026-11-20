import {
  base64UrlDecode,
  base64UrlEncode,
  hmacSha256,
  sha256,
  timingSafeEqualBytes,
} from "./meta";
import type { Env } from "./types";

export const SESSION_COOKIE = "ig_admin_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  sub: "admin";
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export async function checkPassword(env: Env, candidate: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  const [candidateHash, expectedHash] = await Promise.all([
    sha256(candidate),
    sha256(env.ADMIN_PASSWORD),
  ]);
  return timingSafeEqualBytes(candidateHash, expectedHash);
}

async function signPayload(secret: string, payload: string): Promise<string> {
  return base64UrlEncode(await hmacSha256(secret, payload));
}

export async function issueSession(env: Env): Promise<{ value: string; maxAge: number }> {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: "admin",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signPayload(env.SESSION_SECRET, encoded);
  return { value: `${encoded}.${signature}`, maxAge: SESSION_TTL_SECONDS };
}

export async function verifySession(
  env: Env,
  cookieValue: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!cookieValue || !env.SESSION_SECRET) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];

  try {
    const expected = await hmacSha256(env.SESSION_SECRET, encoded);
    const provided = base64UrlDecode(signature);
    if (!timingSafeEqualBytes(expected, provided)) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(encoded))) as SessionPayload;
    if (payload.sub !== "admin") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/* ------------------------------------------------------------------ */
/* Login throttling                                                    */
/* ------------------------------------------------------------------ */

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

interface ThrottleEntry {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const attempts = new Map<string, ThrottleEntry>();

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkLoginThrottle(key: string, now = Date.now()): ThrottleDecision {
  const entry = attempts.get(key);
  if (!entry) return { allowed: true, retryAfterSeconds: 0 };

  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }

  if (entry.lockedUntil !== 0) {
    // Lock expired, start fresh.
    attempts.delete(key);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    entry.count = 0;
    entry.windowStart = now;
  }
}

export function resetLoginFailures(key: string): void {
  attempts.delete(key);
}

/** Test helper. */
export function resetAllLoginFailures(): void {
  attempts.clear();
}
