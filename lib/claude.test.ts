/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { anthropic, MODEL, OPEN_MAX_TOKENS, OPEN_RETRY_MAX_TOKENS } from "./claude";

describe("claude client", () => {
  it("bounds request time instead of the SDK's 10-minute default", () => {
    expect(anthropic.timeout).toBe(30_000);
    expect(anthropic.maxRetries).toBe(3);
  });

  it("keeps the model and exposes the open-turn token budgets", () => {
    expect(MODEL).toBe("claude-haiku-4-5");
    expect(OPEN_MAX_TOKENS).toBe(4096);
    expect(OPEN_RETRY_MAX_TOKENS).toBe(16000);
  });
});
