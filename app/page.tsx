"use client";
import { useEffect, useRef, useState } from "react";
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

/** The open routes map SDK failures onto distinct statuses (429 rate-limited, 503
 *  overloaded, 504 timed out); showing one "check your API key" for all of them
 *  sends the user to fix a key that is fine. `status` is undefined for a network
 *  error or a 200 that carried no windowId. */
function errorHtml(status?: number): string {
  const message =
    status === 429
      ? "Too many requests — wait a moment, then try opening it again."
      : status === 503
        ? "The model is overloaded right now. Try again in a moment."
        : status === 504
          ? "The model took too long to answer. Try again."
          : "Couldn't reach the model — check your API key.";
  return `<div style="padding:24px;font-family:sans-serif;color:#b91c1c">${message}</div>`;
}

function closeSession(windowId: string): void {
  fetch("/api/window/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ windowId }), keepalive: true }).catch(() => {});
}

/** Rewrite z as each window's 1-based rank in its own z order, array order kept. */
function rank(ws: WinState[], last?: string): WinState[] {
  const order = (last ? ws.filter((w) => w.id !== last) : [...ws]).sort((a, b) => a.z - b.z).map((w) => w.id);
  if (last) order.push(last);
  return ws.map((w) => ({ ...w, z: order.indexOf(w.id) + 1 }));
}

export default function Desktop() {
  const [windows, setWindows] = useState<WinState[]>([]);
  const [spotlight, setSpotlight] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // A ref, not state: two openApp calls sharing one React batch would read the
  // same stale counter and hand both windows the same temporary id, and the
  // first open response would then rename both of them.
  const tempSeq = useRef(0);
  // The tmp- ids that still have a window on screen. close() can fire while the
  // open is in flight, and the rename .map() below would then match nothing —
  // leaving a live server session nobody can ever close. It would sit until the
  // 30-minute TTL, which only newSession ever sweeps, so an idle server never
  // reclaims it at all.
  const liveTemp = useRef(new Set<string>());

  // The only keyboard path in the app: Escape dismisses whatever is open,
  // Ctrl/Cmd+K toggles the search that is the product.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCtxMenu(null);
        setSpotlight(false);
        setStartOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSpotlight((s) => !s);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function openApp(card: AppCard, query?: string) {
    setSpotlight(false);
    setStartOpen(false);
    tempSeq.current += 1;
    const tempId = `tmp-${tempSeq.current}`;
    liveTemp.current.add(tempId);
    setWindows((ws) => {
      // Spawn offset and z both derive from the live list, so a batched pair of
      // opens cascades and stacks instead of landing on one another.
      const spawn = clampToViewport(120 + (ws.length % 6) * 28, 90 + (ws.length % 6) * 28, 520, 380, window.innerWidth, window.innerHeight, TASKBAR_H);
      // Same ranking as focus(), so z stays inside [1, windows.length] however
      // many windows are opened and closed. Array order is left alone: moving
      // an iframe in the DOM reloads it.
      return [...rank(ws), { id: tempId, title: card.name, icon: card.icon, html: "", w: 520, h: 380, loading: true, x: spawn.x, y: spawn.y, z: ws.length + 1, minimized: false, maximized: false }];
    });
    let status: number | undefined;
    try {
      const r = await fetch("/api/window/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appName: card.name, blurb: card.blurb, query }) });
      if (!r.ok) status = r.status;
      const data = await r.json();
      if (!r.ok || !data.windowId) throw new Error("open failed");
      // Closed while the open was in flight: the window is gone but the server
      // session was just created, so close it explicitly.
      if (!liveTemp.current.delete(tempId)) { closeSession(data.windowId); return; }
      setWindows((ws) => ws.map((w) => (w.id === tempId ? { ...w, id: data.windowId, html: data.html, loading: false, usage: data.usage } : w)));
    } catch {
      liveTemp.current.delete(tempId);
      setWindows((ws) => ws.map((w) => (w.id === tempId ? { ...w, loading: false, html: errorHtml(status) } : w)));
    }
  }

  function toggleMax(id: string) {
    setWindows((ws) =>
      ws.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const r = w.restore ?? { x: w.x, y: w.y, w: 520, h: 380 };
          return { ...w, x: r.x, y: r.y, w: r.w, h: r.h, maximized: false, restore: undefined };
        }
        return { ...w, restore: { x: w.x, y: w.y, w: w.w, h: w.h }, x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - TASKBAR_H, maximized: true };
      }),
    );
  }

  // z is a rank in the most-recently-focused order, never a monotonic counter:
  // a counter climbs past MAX_WINDOW_Z (every raise and every patch bumps it),
  // after which all windows clamp to the same value and raise-on-click stops
  // working with no reset short of a reload. Ranking also makes focus() correct
  // from the iframe's once-attached listener (which holds a closure from the
  // render that loaded the frame) and from two calls sharing one React batch.
  function focus(id: string) {
    setWindows((ws) => (ws.some((w) => w.id === id) ? rank(ws, id) : ws));
  }
  function toggleMinimize(id: string) { setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w))); }
  // Standard taskbar semantics: restore a minimized window, minimize the top
  // window, otherwise raise a buried one.
  function taskbarActivate(id: string) {
    const target = windows.find((w) => w.id === id);
    if (!target) return;
    if (target.minimized) { toggleMinimize(id); focus(id); return; }
    const top = Math.max(...windows.filter((w) => !w.minimized).map((w) => w.z));
    if (target.z === top) { toggleMinimize(id); return; }
    focus(id);
  }
  function move(id: string, x: number, y: number) { setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w))); }
  function resize(id: string, x: number, y: number, w: number, h: number) { setWindows((ws) => ws.map((win) => win.id === id ? { ...win, x, y, w, h } : win)); }
  function close(id: string) {
    // A tmp- id names no server session yet; dropping it from liveTemp is what
    // tells the in-flight open to close the session it is about to be handed.
    if (id.startsWith("tmp-")) liveTemp.current.delete(id);
    else closeSession(id);
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
      {windows.map((w) => (<WindowFrame key={w.id} win={w} onClose={close} onFocus={focus} onMove={move} onResize={resize} onToggleMax={toggleMax} onToggleMinimize={toggleMinimize} />))}
      {spotlight && <Spotlight onOpen={openApp} onClose={() => setSpotlight(false)} />}
      {startOpen && <StartMenu onOpen={openApp} onClose={() => setStartOpen(false)} />}
      {ctxMenu && (
        <DesktopContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onNewApp={() => { setCtxMenu(null); setSpotlight(true); }}
          onSettings={() => { setCtxMenu(null); openApp(settings); }}
        />
      )}
      <Taskbar windows={windows} onStart={() => setStartOpen((s) => !s)} onSearch={() => setSpotlight(true)} onActivate={taskbarActivate} />
    </main>
  );
}
