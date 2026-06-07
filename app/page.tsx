"use client";
import { useState } from "react";
import { Spotlight } from "@/components/Spotlight";
import { Taskbar } from "@/components/Taskbar";
import { StartMenu } from "@/components/StartMenu";
import { DesktopContextMenu } from "@/components/DesktopContextMenu";
import { DesktopIcons } from "@/components/DesktopIcons";
import { WindowFrame, type WinState } from "@/components/WindowFrame";
import { clampToViewport } from "@/lib/geometry";
import { BUILTIN_APPS } from "@/lib/builtin-apps";
import type { AppCard } from "@/lib/types";

const TASKBAR_H = 64;
const ERROR_HTML = `<div style="padding:24px;font-family:sans-serif;color:#b91c1c">Couldn't reach the model — check your API key.</div>`;

export default function Desktop() {
  const [windows, setWindows] = useState<WinState[]>([]);
  const [spotlight, setSpotlight] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [seq, setSeq] = useState(0);

  async function openApp(card: AppCard) {
    setSpotlight(false);
    setStartOpen(false);
    const z = seq + 1;
    setSeq(z);
    const tempId = `tmp-${z}`;
    const spawn = clampToViewport(120 + (windows.length % 6) * 28, 90 + (windows.length % 6) * 28, 520, 380, window.innerWidth, window.innerHeight, TASKBAR_H);
    setWindows((ws) => [...ws, { id: tempId, title: card.name, icon: card.icon, html: "", w: 520, h: 380, loading: true, x: spawn.x, y: spawn.y, z, minimized: false }]);
    try {
      const r = await fetch("/api/window/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appName: card.name }) });
      const data = await r.json();
      if (!r.ok || !data.windowId) throw new Error("open failed");
      setWindows((ws) => ws.map((w) => (w.id === tempId ? { ...w, id: data.windowId, html: data.html, loading: false } : w)));
    } catch {
      setWindows((ws) => ws.map((w) => (w.id === tempId ? { ...w, loading: false, html: ERROR_HTML } : w)));
    }
  }

  function focus(id: string) { const z = seq + 1; setSeq(z); setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z } : w))); }
  function move(id: string, x: number, y: number) { setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w))); }
  function resize(id: string, x: number, y: number, w: number, h: number) { setWindows((ws) => ws.map((win) => win.id === id ? { ...win, x, y, w, h } : win)); }
  function close(id: string) {
    if (!id.startsWith("tmp-")) {
      fetch("/api/window/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ windowId: id }), keepalive: true }).catch(() => {});
    }
    setWindows((ws) => ws.filter((w) => w.id !== id));
  }

  const settings = BUILTIN_APPS.find((a) => a.id === "settings")!;

  return (
    <main
      className="relative w-screen h-screen overflow-hidden"
      style={{ background: "linear-gradient(135deg,#3a6ea5,#6a5acd)" }}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      onClick={() => setCtxMenu(null)}
    >
      <DesktopIcons onOpen={openApp} />
      {windows.map((w) => (<WindowFrame key={w.id} win={w} onClose={close} onFocus={focus} onMove={move} onResize={resize} />))}
      {spotlight && <Spotlight onOpen={openApp} onClose={() => setSpotlight(false)} />}
      {startOpen && <StartMenu onOpen={openApp} onClose={() => setStartOpen(false)} />}
      {ctxMenu && (
        <DesktopContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onNewApp={() => { setCtxMenu(null); setSpotlight(true); }}
          onSettings={() => { setCtxMenu(null); openApp(settings); }}
        />
      )}
      <Taskbar windows={windows} onStart={() => setStartOpen((s) => !s)} onSearch={() => setSpotlight(true)} onFocus={focus} />
    </main>
  );
}
