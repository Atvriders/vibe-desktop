"use client";
import type { WinState } from "./WindowFrame";
import { Clock } from "./Clock";

export function Taskbar({
  windows, onStart, onSearch, onFocus,
}: {
  windows: WinState[];
  onStart: () => void;
  onSearch: () => void;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl px-3 py-2 bg-white/70 backdrop-blur-xl shadow-2xl border border-white/40 min-w-[20rem]">
      {/* Left group: Start, Search, running windows */}
      <div className="flex items-center gap-2">
        <button onClick={onStart} aria-label="Start" className="w-9 h-9 rounded-xl bg-blue-600 text-white grid place-items-center text-lg">⊞</button>
        <button onClick={onSearch} aria-label="Search" className="w-9 h-9 rounded-xl bg-white/80 text-slate-700 grid place-items-center text-lg">⌕</button>
        {windows.map((w) => (
          <button key={w.id} onClick={() => onFocus(w.id)} className="px-3 h-9 rounded-xl bg-white/80 text-sm text-slate-700 max-w-[10rem] truncate">
            {w.icon ? w.icon + " " : ""}{w.title}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right group: system tray */}
      <div className="flex items-center gap-2">
        <span className="text-base select-none">🔊</span>
        <span className="text-base select-none">📶</span>
        <span className="text-base select-none">🔋</span>
        <Clock />
      </div>
    </div>
  );
}
