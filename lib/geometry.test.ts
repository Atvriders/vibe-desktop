import { describe, it, expect } from "vitest";
import { clampToViewport, resizeWindow } from "./geometry";

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

describe("resizeWindow", () => {
  const rect = { x: 100, y: 100, w: 520, h: 380 };
  const opts = { vw: 1920, vh: 1080 };

  it("dir e, dx 40 expands right edge", () => {
    expect(resizeWindow("e", 40, 0, rect, opts)).toEqual({ x: 100, y: 100, w: 560, h: 380 });
  });

  it("dir w, dx 40 shrinks from left edge", () => {
    expect(resizeWindow("w", 40, 0, rect, opts)).toEqual({ x: 140, y: 100, w: 480, h: 380 });
  });

  it("dir n, dy 30 shrinks from top edge", () => {
    expect(resizeWindow("n", 0, 30, rect, opts)).toEqual({ x: 100, y: 130, w: 520, h: 350 });
  });

  it("dir s, dy 30 expands bottom edge", () => {
    expect(resizeWindow("s", 0, 30, rect, opts)).toEqual({ x: 100, y: 100, w: 520, h: 410 });
  });

  it("dir se, dx 40 dy 30 expands corner", () => {
    expect(resizeWindow("se", 40, 30, rect, opts)).toEqual({ x: 100, y: 100, w: 560, h: 410 });
  });

  it("dir w, dx 1000 clamps to minW=240", () => {
    // dragging left edge far right: x = 100+520-240 = 380, w = 240
    expect(resizeWindow("w", 1000, 0, rect, opts)).toEqual({ x: 380, y: 100, w: 240, h: 380 });
  });

  it("dir e, dx 99999 clamps right to vw=1000", () => {
    // right clamps to 1000, w = 1000 - 100 = 900
    expect(resizeWindow("e", 99999, 0, rect, { vw: 1000, vh: 1080 })).toEqual({ x: 100, y: 100, w: 900, h: 380 });
  });
});
