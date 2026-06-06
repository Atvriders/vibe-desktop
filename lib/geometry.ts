/** Clamp a window's top-left so it stays fully on-screen and above the taskbar. */
export function clampToViewport(
  x: number, y: number, w: number, h: number, vw: number, vh: number, taskbarH = 64,
): { x: number; y: number } {
  const maxX = Math.max(0, vw - w);
  const maxY = Math.max(0, vh - h - taskbarH);
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}
