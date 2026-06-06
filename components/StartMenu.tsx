"use client";
import { BUILTIN_APPS } from "@/lib/builtin-apps";
import type { AppCard } from "@/lib/types";

export function StartMenu({ onOpen, onClose }: { onOpen: (card: AppCard) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        className="absolute bottom-20 left-1/2 -translate-x-1/2 w-[28rem] max-w-[92vw] rounded-2xl bg-white/85 backdrop-blur-xl shadow-2xl border border-white/50 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-4 gap-3">
          {BUILTIN_APPS.map((a) => (
            <button key={a.id} onClick={() => onOpen(a)} className="flex flex-col items-center gap-1 rounded-xl p-3 hover:bg-white text-slate-700">
              <span className="text-2xl">{a.icon}</span>
              <span className="text-xs">{a.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
