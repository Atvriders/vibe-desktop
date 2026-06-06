import { describe, it, expect } from "vitest";
import { BUILTIN_APPS } from "./builtin-apps";

describe("BUILTIN_APPS", () => {
  it("includes Settings and has unique ids + icons", () => {
    expect(BUILTIN_APPS.find((a) => a.id === "settings")?.name).toBe("Settings");
    const ids = BUILTIN_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_APPS.every((a) => a.icon && a.name && a.blurb)).toBe(true);
  });
});
