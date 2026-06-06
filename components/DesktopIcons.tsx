"use client";
import { BUILTIN_APPS } from "@/lib/builtin-apps";
import type { AppCard } from "@/lib/types";
const SHOWN = ["settings", "files", "browser", "notepad", "music"];
export function DesktopIcons({ onOpen }: { onOpen: (card: AppCard) => void }) {
  const apps = SHOWN.map((id) => BUILTIN_APPS.find((a) => a.id === id)).filter(Boolean) as AppCard[];
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
      {apps.map((a) => (
        <button key={a.id} onClick={() => onOpen(a)} className="flex flex-col items-center gap-1 w-20 p-2 rounded-lg hover:bg-white/15 text-white text-center">
          <span className="text-3xl drop-shadow">{a.icon}</span>
          <span className="text-xs drop-shadow">{a.name}</span>
        </button>
      ))}
    </div>
  );
}
