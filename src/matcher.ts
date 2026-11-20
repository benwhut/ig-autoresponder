import type { Rule } from "./types";

/**
 * Normalizes text for keyword matching:
 *  - Unicode NFKC + lowercase
 *  - every run of non-letter/non-number characters becomes a single space
 *  - trimmed
 *
 * This makes matching punctuation-insensitive while keeping word boundaries
 * intact ("send the link!" -> "send the link").
 */
export function normalizeText(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whole-word / whole-phrase match, case- and punctuation-insensitive. */
export function textMatchesKeyword(text: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return false;
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;
  return ` ${normalizedText} `.includes(` ${normalizedKeyword} `);
}

/** Returns the first keyword that matches, or null. */
export function findMatchingKeyword(text: string, keywords: readonly string[]): string | null {
  for (const keyword of keywords) {
    if (textMatchesKeyword(text, keyword)) return keyword;
  }
  return null;
}

/** Priority DESC, then most recently updated first. */
export function sortRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.updated_at === b.updated_at) return 0;
    return a.updated_at < b.updated_at ? 1 : -1;
  });
}

export function ruleAppliesToMedia(rule: Rule, mediaId: string): boolean {
  if (rule.target_mode === "all_posts") return true;
  return rule.media_ids.includes(mediaId);
}

export function matchesRule(rule: Rule, mediaId: string, commentText: string): boolean {
  if (!rule.enabled) return false;
  if (!ruleAppliesToMedia(rule, mediaId)) return false;
  if (rule.match_mode === "any_comment") return true;
  return findMatchingKeyword(commentText, rule.keywords) !== null;
}

/**
 * Resolves which rule should handle a comment.
 *
 * Precedence:
 *  1. Rules targeting this exact media_id (priority DESC, updated_at DESC)
 *  2. All-posts rules (priority DESC, updated_at DESC)
 *
 * A global rule with a higher `priority` number never outranks a rule that
 * explicitly targets the post.
 */
export function pickRule(
  rules: readonly Rule[],
  mediaId: string,
  commentText: string,
): Rule | null {
  const ordered = sortRules(rules);
  const specific = ordered.filter(
    (rule) => rule.target_mode === "specific_posts" && rule.media_ids.includes(mediaId),
  );
  const global = ordered.filter((rule) => rule.target_mode === "all_posts");

  for (const rule of specific) {
    if (matchesRule(rule, mediaId, commentText)) return rule;
  }
  for (const rule of global) {
    if (matchesRule(rule, mediaId, commentText)) return rule;
  }
  return null;
}
