"use client";
import { useRef, useState } from "react";
import { applyOps } from "@/lib/apply-ops";
import { clampToViewport, resizeWindow, type ResizeDir } from "@/lib/geometry";
import { wrapSandboxed } from "@/lib/sandbox-doc";

export interface WinState {
  id: string;
  title: string;
  icon?: string;
  html: string;
  w: number;
  h: number;
  loading: boolean;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
}

const TASKBAR_H = 64;

export function WindowFrame({
  win, onClose, onFocus, onMove, onResize,
}: {
  win: WinState;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, x: number, y: number, w: number, h: number) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const clicks = useRef(0);
  const needsResync = useRef(false);
  const [busy, setBusy] = useState(false);

  async function sendPatch(doc: Document, target: Element | null, e: MouseEvent, action: "click" | "contextmenu") {
    onFocus(win.id);
    const rect = doc.documentElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round((e.clientX / (rect.width || 1)) * 100)));
    const y = Math.max(0, Math.min(100, Math.round((e.clientY / (rect.height || 1)) * 100)));
    clicks.current += 1;
    const sendSnapshot = clicks.current % 10 === 0 || needsResync.current;
    // Addendum B: collect typed field values before POST
    const inputs: Record<string, string> = {};
    doc.querySelectorAll<HTMLInputElement>("input[id],textarea[id],select[id]").forEach((el) => { inputs[el.id] = el.value; });
    setBusy(true);
    try {
      const r = await fetch("/api/window/patch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          windowId: win.id,
          elementId: target ? target.id : null,
          x, y, action,
          domSnapshot: sendSnapshot ? doc.body.innerHTML : undefined,
          inputs,
        }),
      });
      const data = await r.json();
      const result = data.ops ? applyOps(doc, data.ops) : { applied: [], dropped: [] };
      needsResync.current = result.dropped.length > 0;
      // diagnostic: see exactly what each click did (open DevTools console)
      console.log(
        `[${win.title}] ${action} id=${target ? target.id : "(none)"} → http:${r.status} ` +
          `ops:${data.ops?.length ?? 0} applied:${result.applied.length} dropped:${result.dropped.length} ` +
          `stop:${data.stopReason ?? "?"} cacheRead:${data.cacheReadTokens ?? 0}`,
      );
    } catch (err) {
      console.error("patch failed", err);
    } finally {
      setBusy(false);
    }
  }

  function onLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (e) => {
      const target = (e.target as Element | null)?.closest?.("[id]") as Element | null;
      void sendPatch(doc, target, e as MouseEvent, "click");
    }, true);
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") as Element | null;
      void sendPatch(doc, target, e as MouseEvent, "contextmenu");
    }, true);
  }

  function startResize(e: React.PointerEvent, dir: ResizeDir) {
    e.preventDefault(); e.stopPropagation();
    onFocus(win.id);
    const startX = e.clientX, startY = e.clientY;
    const rect = { x: win.x, y: win.y, w: win.w, h: win.h };
    function move(ev: PointerEvent) {
      const r = resizeWindow(dir, ev.clientX - startX, ev.clientY - startY, rect, { vw: window.innerWidth, vh: window.innerHeight });
      onResize(win.id, r.x, r.y, r.w, r.h);
    }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startDrag(e: React.PointerEvent) {
    onFocus(win.id);
    const startX = e.clientX, startY = e.clientY, ox = win.x, oy = win.y;
    function move(ev: PointerEvent) {
      const el = rootRef.current;
      const w = el?.offsetWidth ?? 520;
      const h = el?.offsetHeight ?? 380;
      const c = clampToViewport(ox + ev.clientX - startX, oy + ev.clientY - startY, w, h, window.innerWidth, window.innerHeight, TASKBAR_H);
      onMove(win.id, c.x, c.y);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (win.minimized) return null;

  return (
    <div
      ref={rootRef}
      onPointerDown={() => onFocus(win.id)}
      style={{ position: "absolute", left: win.x, top: win.y, zIndex: win.z, width: win.w, height: win.h, overflow: "hidden" }}
      className="rounded-xl border border-white/60 ring-1 ring-black/10 shadow-2xl bg-white/80 backdrop-blur-xl flex flex-col"
    >
      <div onPointerDown={startDrag} className="cursor-move select-none flex items-center justify-between px-3 py-2 bg-white/60 border-b border-white/40">
        <span className="text-sm font-medium text-slate-700 truncate">{win.icon ? win.icon + " " : ""}{win.title}</span>
        <button aria-label="Close" onClick={() => onClose(win.id)} className="w-3.5 h-3.5 rounded-full bg-red-400 hover:bg-red-500" />
      </div>
      {win.loading ? (
        <div className="flex-1 grid place-items-center bg-white">
          <div className="text-center animate-pulse">
            <div className="text-4xl mb-2">{win.icon ?? "🪟"}</div>
            <div className="text-sm text-slate-600">Hallucinating {win.title}…</div>
          </div>
        </div>
      ) : (
        <div className="relative flex-1">
          <iframe ref={frameRef} title={win.title} onLoad={onLoad} sandbox="allow-same-origin" srcDoc={wrapSandboxed(win.html)} className="absolute inset-0 w-full h-full bg-white" />
          {busy && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/40 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 shadow-lg text-sm font-medium text-slate-700 animate-pulse">
                <span>✨</span> Hallucinating…
              </div>
            </div>
          )}
        </div>
      )}
      {/* 8-direction resize handles */}
      <div onPointerDown={(e) => startResize(e, "n")} className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "s")} className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "e")} className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "w")} className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "nw")} className="absolute top-0 left-0 w-2.5 h-2.5 cursor-nwse-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "ne")} className="absolute top-0 right-0 w-2.5 h-2.5 cursor-nesw-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "sw")} className="absolute bottom-0 left-0 w-2.5 h-2.5 cursor-nesw-resize z-20" />
      <div onPointerDown={(e) => startResize(e, "se")} className="absolute bottom-0 right-0 w-2.5 h-2.5 cursor-nwse-resize z-20" />
    </div>
  );
}
