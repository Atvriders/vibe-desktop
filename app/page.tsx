"use client";
import { useState } from "react";
import { Spotlight } from "@/components/Spotlight";
import { Taskbar } from "@/components/Taskbar";
import { WindowFrame, type WinState } from "@/components/WindowFrame";
import type { AppCard } from "@/lib/types";

export default function Desktop() {
  const [windows, setWindows] = useState<WinState[]>([]);
  const [spotlight, setSpotlight] = useState(true);
  const [topZ, setTopZ] = useState(10);

  async function openApp(card: AppCard) {
    setSpotlight(false);
    const r = await fetch("/api/window/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appName: card.name }),
    });
    const data = await r.json();
    if (!data.windowId) return;
    const z = topZ + 1;
    setTopZ(z);
    setWindows((ws) => [
      ...ws,
      { id: data.windowId, title: card.name, html: data.html, x: 120 + ws.length * 28, y: 90 + ws.length * 28, z, minimized: false },
    ]);
  }

  function focus(id: string) {
    const z = topZ + 1;
    setTopZ(z);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z } : w)));
  }
  function move(id: string, x: number, y: number) {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }
  function close(id: string) {
    setWindows((ws) => ws.filter((w) => w.id !== id));
  }

  return (
    <main className="relative w-screen h-screen overflow-hidden" style={{ background: "linear-gradient(135deg,#3a6ea5,#6a5acd)" }}>
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} onClose={close} onFocus={focus} onMove={move} />
      ))}
      {spotlight && <Spotlight onOpen={openApp} onClose={() => setSpotlight(false)} />}
      <Taskbar windows={windows} onSearch={() => setSpotlight(true)} onFocus={focus} />
    </main>
  );
}
