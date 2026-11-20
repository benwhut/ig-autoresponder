import { describe, expect, it } from "vitest";

import { dashboardPage, loginPage } from "../src/admin-ui";

function inlineScript(html: string): string {
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start + "<script>".length, end);
}

describe("admin UI", () => {
  it("ships a syntactically valid dashboard script", () => {
    const script = inlineScript(dashboardPage());
    expect(script.length).toBeGreaterThan(5000);
    expect(() => new Function(script)).not.toThrow();
  });

  it("has no external script, stylesheet or font dependencies", () => {
    const html = dashboardPage();
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain("cdn.");
  });

  it("does not leak unrendered template placeholders", () => {
    expect(dashboardPage()).not.toContain("${");
    expect(loginPage()).not.toContain("${");
  });

  it("renders the login page with the password form", () => {
    const html = loginPage();
    expect(html).toContain('action="/admin/login"');
    expect(html).toContain('name="password"');
    expect(html).not.toContain("Automation rules");
  });

  it("shows an error message when the login page is rendered with an error", () => {
    expect(loginPage({ error: true })).toContain("Incorrect password");
  });
});
