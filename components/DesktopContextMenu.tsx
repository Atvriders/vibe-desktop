"use client";
export function DesktopContextMenu({
  x, y, onNewApp, onSettings,
}: {
  x: number; y: number; onNewApp: () => void; onSettings: () => void;
}) {
  return (
    <div
      className="fixed z-[1100] min-w-[10rem] rounded-lg bg-white/95 backdrop-blur shadow-xl border border-slate-200 py-1 text-sm text-slate-700"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onNewApp} className="block w-full text-left px-3 py-1.5 hover:bg-slate-100">New app…</button>
      <button onClick={onSettings} className="block w-full text-left px-3 py-1.5 hover:bg-slate-100">Settings</button>
    </div>
  );
}
