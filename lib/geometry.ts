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
  let left = rect.x, right = rect.x + rect.w, top = rect.y, bottom = rect.y + rect.h;
  if (dir.includes("w")) left = rect.x + dx;
  if (dir.includes("e")) right = rect.x + rect.w + dx;
  if (dir.includes("n")) top = rect.y + dy;
  if (dir.includes("s")) bottom = rect.y + rect.h + dy;
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(opts.vw, right);
  bottom = Math.min(opts.vh - taskbarH, bottom);
  if (right - left < minW) { if (dir.includes("w")) left = right - minW; else right = left + minW; }
  if (bottom - top < minH) { if (dir.includes("n")) top = bottom - minH; else bottom = top + minH; }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
