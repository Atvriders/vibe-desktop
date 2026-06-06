import { describe, it, expect } from "vitest";
import { clampToViewport } from "./geometry";

describe("clampToViewport", () => {
  it("keeps an in-bounds window unchanged", () => {
    expect(clampToViewport(100, 100, 520, 380, 1920, 1080, 64)).toEqual({ x: 100, y: 100 });
  });
  it("clamps negative coords to 0", () => {
    expect(clampToViewport(-50, -30, 520, 380, 1920, 1080, 64)).toEqual({ x: 0, y: 0 });
  });
  it("clamps overflow so the window stays fully on-screen above the taskbar", () => {
    expect(clampToViewport(9999, 9999, 520, 380, 1000, 800, 64)).toEqual({ x: 480, y: 356 });
  });
  it("never returns negative when the window is larger than the viewport", () => {
    expect(clampToViewport(10, 10, 2000, 2000, 1000, 800, 64)).toEqual({ x: 0, y: 0 });
  });
});
