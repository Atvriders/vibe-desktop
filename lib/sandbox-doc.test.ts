import { describe, it, expect } from "vitest";
import { wrapSandboxed } from "./sandbox-doc";

describe("wrapSandboxed", () => {
  it("contains the strict CSP meta and the body html", () => {
    const result = wrapSandboxed("<p>hello</p>");
    expect(result).toContain("default-src 'none'");
    expect(result).toContain("<p>hello</p>");
  });
});
