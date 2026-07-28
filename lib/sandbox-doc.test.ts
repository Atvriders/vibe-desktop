import { describe, it, expect } from "vitest";
import { wrapSandboxed } from "./sandbox-doc";

describe("wrapSandboxed", () => {
  it("contains the strict CSP meta and the body html", () => {
    const result = wrapSandboxed("<p>hello</p>");
    expect(result).toContain("default-src 'none'");
    expect(result).toContain("<p>hello</p>");
  });

  it("forbids form submission and <base> rewriting", () => {
    const result = wrapSandboxed("<p>hello</p>");
    expect(result).toContain("form-action 'none'");
    expect(result).toContain("base-uri 'none'");
  });

  it("keeps the whole policy on a single CSP meta tag", () => {
    const result = wrapSandboxed("");
    expect(result.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });
});
