import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Bindings                                                            */
/* ------------------------------------------------------------------ */

export interface Env {
  DB: D1Database;
  IG_APP_SECRET: string;
  WEBHOOK_VERIFY_TOKEN: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  GRAPH_API_VERSION?: string;
}

/* ------------------------------------------------------------------ */
/* Domain unions                                                       */
/* ------------------------------------------------------------------ */

/** Where a comment came from and which API sends the reply. */
export type Platform = "instagram" | "facebook";

/** A rule can serve one platform or both. */
export type RulePlatform = Platform | "both";

export type TargetMode = "all_posts" | "specific_posts";
export type MatchMode = "any_keyword" | "any_comment";
export type DeliveryMode = "two_step_opt_in" | "direct_link";

export const PLATFORMS: readonly Platform[] = ["instagram", "facebook"];

export type ExecutionState =
  | "matched_queued"
  | "private_reply_sent"
  | "awaiting_opt_in"
  | "completed"
  | "ignored"
  | "failed";

export type PublicReplyStatus = "none" | "queued" | "sent" | "failed";

export type JobType = "private_reply" | "public_reply" | "followup_dm";
export type JobStatus = "queued" | "processing" | "done" | "failed";

export const EXECUTION_STATES: readonly ExecutionState[] = [
  "matched_queued",
  "private_reply_sent",
  "awaiting_opt_in",
  "completed",
  "ignored",
  "failed",
];

/* ------------------------------------------------------------------ */
/* Database rows                                                       */
/* ------------------------------------------------------------------ */

export interface SystemConfigRow {
  key: string;
  value_encrypted: string;
  expires_at: string | null;
  updated_at: string;
}

/** Which Graph host issued the token. */
export type TokenType = "instagram_graph" | "facebook_graph";

export interface AccountInfo {
  /** Instagram professional account id (the `ig_user_id`). */
  user_id: string;
  username: string;
  /** `instagram_graph` for IGAA… tokens, `facebook_graph` for EAA… tokens. */
  token_type?: TokenType;
  account_type?: string;
  connected_at?: string;
}

/** A Facebook Page used for comments and Messenger replies. */
export interface PageAccountInfo {
  page_id: string;
  name: string;
  connected_at?: string;
}

export interface MediaRow {
  media_id: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  timestamp: string;
  synced_at: string;
  /** Instagram media or a Facebook Page post. */
  platform: Platform;
}

export interface RuleRow {
  id: string;
  name: string;
  platform: string;
  target_mode: string;
  media_ids_json: string;
  match_mode: string;
  keywords_json: string;
  delivery_mode: string;
  initial_dm_text: string;
  opt_in_keywords_json: string;
  followup_dm_text: string;
  public_replies_json: string;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Parsed rule used by the matcher and the admin API. */
export interface Rule {
  id: string;
  name: string;
  platform: RulePlatform;
  target_mode: TargetMode;
  media_ids: string[];
  match_mode: MatchMode;
  keywords: string[];
  delivery_mode: DeliveryMode;
  initial_dm_text: string;
  opt_in_keywords: string[];
  followup_dm_text: string;
  public_replies: string[];
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentExecutionRow {
  comment_id: string;
  media_id: string;
  commenter_igsid: string;
  /** Instagram-scoped id (IGSID) or Facebook Page-scoped id (PSID). */
  recipient_igsid: string | null;
  commenter_username: string | null;
  comment_text: string;
  rule_id: string | null;
  /** Selects the Instagram Graph or Messenger send path. */
  platform: Platform;
  state: ExecutionState;
  private_reply_sent_at: string | null;
  opt_in_completed_at: string | null;
  public_reply_status: PublicReplyStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboundJobRow {
  id: string;
  job_type: JobType;
  comment_id: string;
  recipient_igsid: string | null;
  /** Which send API the job must use. */
  platform: Platform;
  payload_json: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Diagnostic row written for every incoming webhook branch. */
export interface WebhookEventRow {
  id: string;
  object: string | null;
  entry_id: string | null;
  kind: string;
  sender_id: string | null;
  recipient_id: string | null;
  text: string | null;
  reason: string | null;
  payload_json: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Job payloads                                                        */
/* ------------------------------------------------------------------ */

export interface PrivateReplyPayload {
  text: string;
  delivery_mode: DeliveryMode;
  rule_id: string;
}

export interface PublicReplyPayload {
  text: string;
}

export interface FollowupPayload {
  text: string;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const keyword = z.string().trim().min(1).max(80);
const mediaId = z.string().trim().min(1).max(64);

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    platform: z.enum(["instagram", "facebook", "both"]).default("both"),
    target_mode: z.enum(["all_posts", "specific_posts"]).default("all_posts"),
    media_ids: z.array(mediaId).max(50).default([]),
    match_mode: z.enum(["any_keyword", "any_comment"]).default("any_keyword"),
    keywords: z.array(keyword).max(50).default([]),
    delivery_mode: z.enum(["two_step_opt_in", "direct_link"]).default("two_step_opt_in"),
    initial_dm_text: z
      .string()
      .trim()
      .min(1, "Step 1 message is required")
      .max(1000, "Instagram DMs are limited to 1000 characters"),
    opt_in_keywords: z.array(keyword).max(50).default([]),
    followup_dm_text: z
      .string()
      .trim()
      .max(1000, "Instagram DMs are limited to 1000 characters")
      .default(""),
    public_replies: z
      .array(z.string().trim().min(1).max(500))
      .max(10, "Keep it to 10 public reply variants or fewer")
      .default([]),
    priority: z.number().int().min(-1000).max(1000).default(0),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.target_mode === "specific_posts" && value.media_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media_ids"],
        message: "Select at least one post, or switch the target to All Posts",
      });
    }
    if (value.match_mode === "any_keyword" && value.keywords.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keywords"],
        message: "Add at least one keyword, or switch the trigger to Any Comment",
      });
    }
    if (value.delivery_mode === "two_step_opt_in" && !value.followup_dm_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followup_dm_text"],
        message: "Two-step opt-in needs a Step 2 message containing the link",
      });
    }
  });

export type RuleInput = z.infer<typeof ruleInputSchema>;

export const tokenInputSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "That does not look like an access token")
    .max(4096, "Access token is too long"),
});

export const loginInputSchema = z.object({
  password: z.string().min(1).max(512),
});

export const retryInputSchema = z.object({
  job_id: z.string().trim().min(1).max(64).optional(),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function toRulePlatform(value: string | null | undefined): RulePlatform {
  if (value === "instagram" || value === "facebook") return value;
  return "both";
}

export function toPlatform(value: string | null | undefined): Platform {
  return value === "facebook" ? "facebook" : "instagram";
}

export function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    platform: toRulePlatform(row.platform),
    target_mode: row.target_mode === "all_posts" ? "all_posts" : "specific_posts",
    media_ids: parseJsonArray<string>(row.media_ids_json).filter((v) => typeof v === "string"),
    match_mode: row.match_mode === "any_comment" ? "any_comment" : "any_keyword",
    keywords: parseJsonArray<string>(row.keywords_json).filter((v) => typeof v === "string"),
    delivery_mode: row.delivery_mode === "direct_link" ? "direct_link" : "two_step_opt_in",
    initial_dm_text: row.initial_dm_text,
    opt_in_keywords: parseJsonArray<string>(row.opt_in_keywords_json).filter(
      (v) => typeof v === "string",
    ),
    followup_dm_text: row.followup_dm_text,
    public_replies: parseJsonArray<string>(row.public_replies_json).filter(
      (v) => typeof v === "string",
    ),
    priority: Number(row.priority) || 0,
    enabled: Number(row.enabled) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusSeconds(seconds: number, from: Date = new Date()): string {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return (ms - Date.now()) / 86_400_000;
}

export function truncate(value: string, max = 500): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
