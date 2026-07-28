"use client";
import { useRef } from "react";
import { BUILTIN_APPS } from "@/lib/builtin-apps";
import type { AppCard } from "@/lib/types";
const SHOWN = ["settings", "files", "browser", "notepad", "music"];
// A double-click on a <button> dispatches `click` TWICE before `dblclick`, and a
// desktop icon is exactly where users still double-click out of habit. Without a
// guard that is two windows, two billed Claude calls and two server sessions for
// one gesture. The window is per icon, so opening two different apps in one React
// batch (Files + Notepad) still opens both.
const REPEAT_MS = 500;
export function DesktopIcons({ onOpen }: { onOpen: (card: AppCard) => void }) {
  const lastOpened = useRef<Record<string, number>>({});
  const apps = SHOWN.map((id) => BUILTIN_APPS.find((a) => a.id === id)).filter(Boolean) as AppCard[];
  function activate(a: AppCard) {
    const now = Date.now();
    if (now - (lastOpened.current[a.id] ?? -Infinity) < REPEAT_MS) return;
    lastOpened.current[a.id] = now;
    onOpen(a);
  }
  return (
    <div className="absolute top-4 left-4 z-0 flex flex-col gap-3">
      {apps.map((a) => (
        <button key={a.id} onClick={() => activate(a)} aria-label={a.name} title={`Open ${a.name}`} className="flex flex-col items-center gap-1 w-20 p-2 rounded-lg hover:bg-white/15 focus:bg-white/20 text-white text-center select-none">
          <span className="text-3xl drop-shadow">{a.icon}</span>
          <span className="text-xs drop-shadow">{a.name}</span>
        </button>
      ))}
    </div>
  );
}
