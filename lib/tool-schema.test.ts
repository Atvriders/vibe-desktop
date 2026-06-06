import { describe, it, expect } from "vitest";
import { SEARCH_SYSTEM } from "./tool-schema";

describe("SEARCH_SYSTEM", () => {
  it("instructs the model to invent original names and avoid real products", () => {
    expect(SEARCH_SYSTEM.toLowerCase()).toContain("original");
    expect(SEARCH_SYSTEM.toLowerCase()).toMatch(/real|trademark|existing/);
  });
});
