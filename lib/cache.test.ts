import { describe, it, expect } from "vitest";
import { frozenSystem, cacheLastTurn } from "./cache";

describe("cache helpers", () => {
  it("frozenSystem marks the system block ephemeral", () => {
    const sys = frozenSystem("hello");
    expect(sys[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("cacheLastTurn puts a breakpoint on the last block of the last message", () => {
    const msgs = cacheLastTurn([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    const last: any = msgs[msgs.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content[last.content.length - 1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // earlier message left untouched
    expect((msgs[0] as any).content).toBe("first");
  });

  it("returns empty array unchanged", () => {
    expect(cacheLastTurn([])).toEqual([]);
  });

  it("does not throw when the last message has an empty content array", () => {
    const msgs = cacheLastTurn([
      { role: "user", content: "first" },
      { role: "assistant", content: [] },
    ]);
    expect(msgs).toHaveLength(2);
    expect((msgs[1] as any).content).toEqual([]);
    expect((msgs[0] as any).content).toBe("first");
  });
});
