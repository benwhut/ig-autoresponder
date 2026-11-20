import { describe, expect, it } from "vitest";

import { findMatchingKeyword, normalizeText, pickRule, sortRules, textMatchesKeyword } from "../src/matcher";
import type { Rule } from "../src/types";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule_1",
    name: "Rule",
    target_mode: "all_posts",
    media_ids: [],
    match_mode: "any_keyword",
    keywords: ["link"],
    delivery_mode: "two_step_opt_in",
    initial_dm_text: "Want it?",
    opt_in_keywords: [],
    followup_dm_text: "https://example.com",
    public_replies: [],
    priority: 0,
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeText", () => {
  it("lowercases and strips punctuation to word boundaries", () => {
    expect(normalizeText("Send the LINK!!")).toBe("send the link");
    expect(normalizeText("  link, please?  ")).toBe("link please");
    expect(normalizeText("free-guide")).toBe("free guide");
  });

  it("keeps unicode letters and numbers", () => {
    expect(normalizeText("Café 2026")).toBe("café 2026");
  });

  it("handles empty input", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("!!!")).toBe("");
  });
});

describe("keyword matching", () => {
  it("matches whole words case-insensitively", () => {
    expect(textMatchesKeyword("send the link!", "link")).toBe(true);
    expect(textMatchesKeyword("LINK", "link")).toBe(true);
    expect(textMatchesKeyword("Send me the Link please", "link")).toBe(true);
  });

  it("does not match substrings inside words", () => {
    expect(textMatchesKeyword("blinking", "link")).toBe(false);
    expect(textMatchesKeyword("hyperlink", "link")).toBe(false);
    expect(textMatchesKeyword("linked", "link")).toBe(false);
  });

  it("matches multi-word phrases", () => {
    expect(textMatchesKeyword("Send me the FREE GUIDE!!", "free guide")).toBe(true);
    expect(textMatchesKeyword("free guides", "free guide")).toBe(false);
  });

  it("never matches an empty keyword", () => {
    expect(textMatchesKeyword("anything", "")).toBe(false);
    expect(textMatchesKeyword("anything", "!!!")).toBe(false);
  });

  it("returns the first matching keyword", () => {
    expect(findMatchingKeyword("I want the pdf guide", ["link", "pdf", "guide"])).toBe("pdf");
    expect(findMatchingKeyword("nothing here", ["link", "pdf"])).toBeNull();
  });
});

describe("rule priority", () => {
  it("gives a specific-post rule precedence over a higher-priority global rule", () => {
    const specific = makeRule({
      id: "specific",
      target_mode: "specific_posts",
      media_ids: ["media_1"],
      priority: 0,
    });
    const global = makeRule({ id: "global", target_mode: "all_posts", priority: 999 });

    const picked = pickRule([global, specific], "media_1", "link please");
    expect(picked?.id).toBe("specific");
  });

  it("falls back to the global rule when the specific rule does not target the post", () => {
    const specific = makeRule({
      id: "specific",
      target_mode: "specific_posts",
      media_ids: ["media_other"],
      priority: 50,
    });
    const global = makeRule({ id: "global", priority: 0 });

    expect(pickRule([specific, global], "media_1", "link please")?.id).toBe("global");
  });

  it("orders specific rules by priority, then newest update", () => {
    const older = makeRule({
      id: "older",
      target_mode: "specific_posts",
      media_ids: ["media_1"],
      priority: 10,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeRule({
      id: "newer",
      target_mode: "specific_posts",
      media_ids: ["media_1"],
      priority: 10,
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const lower = makeRule({
      id: "lower",
      target_mode: "specific_posts",
      media_ids: ["media_1"],
      priority: 5,
    });

    expect(pickRule([older, lower, newer], "media_1", "link")?.id).toBe("newer");
  });

  it("skips disabled rules", () => {
    const disabled = makeRule({
      id: "disabled",
      target_mode: "specific_posts",
      media_ids: ["media_1"],
      enabled: false,
      priority: 100,
    });
    const global = makeRule({ id: "global" });

    expect(pickRule([disabled, global], "media_1", "link")?.id).toBe("global");
  });

  it("falls through to a global rule when a specific rule's keyword does not match", () => {
    const specific = makeRule({
      id: "specific",
      target_mode: "specific_posts",
      media_ids: ["media_1"],
      keywords: ["pdf"],
    });
    const global = makeRule({ id: "global", keywords: ["link"] });

    expect(pickRule([specific, global], "media_1", "send the link")?.id).toBe("global");
    expect(pickRule([specific, global], "media_1", "send the pdf")?.id).toBe("specific");
  });

  it("matches any comment including empty text in any_comment mode", () => {
    const rule = makeRule({ match_mode: "any_comment", keywords: [] });
    expect(pickRule([rule], "media_1", "")?.id).toBe("rule_1");
    expect(pickRule([rule], "media_1", "🔥")?.id).toBe("rule_1");
  });

  it("returns null when nothing matches", () => {
    expect(pickRule([makeRule()], "media_1", "hello there")).toBeNull();
    expect(pickRule([], "media_1", "link")).toBeNull();
  });

  it("sorts by priority descending then updated_at descending", () => {
    const a = makeRule({ id: "a", priority: 1, updated_at: "2026-01-01T00:00:00.000Z" });
    const b = makeRule({ id: "b", priority: 5, updated_at: "2025-01-01T00:00:00.000Z" });
    const c = makeRule({ id: "c", priority: 1, updated_at: "2026-06-01T00:00:00.000Z" });

    expect(sortRules([a, b, c]).map((rule) => rule.id)).toEqual(["b", "c", "a"]);
  });
});
