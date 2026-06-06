"use client";
import { useState } from "react";
import type { AppCard } from "@/lib/types";

export function Spotlight({ onOpen, onClose }: { onOpen: (card: AppCard) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<AppCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(false);
    setCards([]);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!r.ok) {
        setError(true);
        setCards([]);
        return;
      }
      const data = await r.json();
      setCards(data.cards ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <div className="w-[36rem] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={search}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type any app…  (e.g. a synth, Excel 95, Minesweeper)"
            className="w-full rounded-xl px-4 py-3 text-slate-800 bg-white/90 shadow-2xl outline-none"
          />
        </form>
        {loading && <p className="mt-3 text-sm text-white/80">Conjuring apps…</p>}
        {error && <p className="mt-3 text-sm text-red-100">Couldn't reach the model — check your ANTHROPIC_API_KEY.</p>}
        {cards.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {cards.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpen(c)}
                className="flex items-center gap-3 rounded-xl p-3 bg-white/90 hover:bg-white text-left shadow"
              >
                <span className="text-2xl">{c.icon}</span>
                <span>
                  <span className="block font-medium text-slate-800">{c.name}</span>
                  <span className="block text-xs text-slate-500">{c.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
