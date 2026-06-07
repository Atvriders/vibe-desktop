/** Clamp a window's top-left so it stays fully on-screen and above the taskbar. */
export function clampToViewport(
  x: number, y: number, w: number, h: number, vw: number, vh: number, taskbarH = 64,
): { x: number; y: number } {
  const maxX = Math.max(0, vw - w);
  const maxY = Math.max(0, vh - h - taskbarH);
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}

export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function resizeWindow(
  dir: ResizeDir, dx: number, dy: number,
  rect: { x: number; y: number; w: number; h: number },
  opts: { vw: number; vh: number; minW?: number; minH?: number; taskbarH?: number },
): { x: number; y: number; w: number; h: number } {
  const minW = opts.minW ?? 240, minH = opts.minH ?? 160, taskbarH = opts.taskbarH ?? 64;
  const maxRight = opts.vw, maxBottom = opts.vh - taskbarH;
  let left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
  // Only the dragged edge moves, and only it is clamped to the viewport — the fixed edge stays put.
  if (dir.includes("w")) left = Math.max(0, rect.x + dx);
  if (dir.includes("e")) right = Math.min(maxRight, rect.x + rect.w + dx);
  if (dir.includes("n")) top = Math.max(0, rect.y + dy);
  if (dir.includes("s")) bottom = Math.min(maxBottom, rect.y + rect.h + dy);
  // Enforce the minimum size by moving the dragged edge, kept inside the viewport.
  if (right - left < minW) {
    if (dir.includes("w")) left = Math.max(0, right - minW);
    else right = Math.min(maxRight, left + minW);
  }
  if (bottom - top < minH) {
    if (dir.includes("n")) top = Math.max(0, bottom - minH);
    else bottom = Math.min(maxBottom, top + minH);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
