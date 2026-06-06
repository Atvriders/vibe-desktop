import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("removes <script> tags but keeps surrounding markup", () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("strips on* event handlers and javascript: urls", () => {
    const out = sanitizeHtml('<a id="x" href="javascript:alert(1)" onclick="x()">go</a>');
    expect(out).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("go");
  });
});
