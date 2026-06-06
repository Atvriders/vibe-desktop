"use client";
import type { WinState } from "./WindowFrame";

export function Taskbar({
  windows,
  onSearch,
  onFocus,
}: {
  windows: WinState[];
  onSearch: () => void;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl px-3 py-2 bg-white/70 backdrop-blur-xl shadow-2xl border border-white/40">
      <button onClick={onSearch} aria-label="Search" className="w-9 h-9 rounded-xl bg-blue-500 text-white grid place-items-center text-lg">
        ⌕
      </button>
      {windows.map((w) => (
        <button
          key={w.id}
          onClick={() => onFocus(w.id)}
          className="px-3 h-9 rounded-xl bg-white/80 text-sm text-slate-700 max-w-[10rem] truncate"
        >
          {w.title}
        </button>
      ))}
    </div>
  );
}
