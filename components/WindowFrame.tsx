"use client";
import { useRef, useState } from "react";
import { applyOps } from "@/lib/apply-ops";
import { clampToViewport } from "@/lib/geometry";
import { wrapSandboxed } from "@/lib/sandbox-doc";

export interface WinState {
  id: string;
  title: string;
  icon?: string;
  html: string;
  loading: boolean;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
}

const TASKBAR_H = 64;

export function WindowFrame({
  win, onClose, onFocus, onMove,
}: {
  win: WinState;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
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
      style={{ position: "absolute", left: win.x, top: win.y, zIndex: win.z, width: 520, height: 380, resize: "both", overflow: "hidden" }}
      className="rounded-xl border border-white/60 ring-1 ring-black/10 shadow-2xl bg-white/80 backdrop-blur-xl flex flex-col"
    >
      <div onPointerDown={startDrag} className="cursor-move select-none flex items-center justify-between px-3 py-2 bg-white/60 border-b border-white/40">
        <span className="text-sm font-medium text-slate-700 truncate">{win.icon ? win.icon + " " : ""}{win.title}</span>
        <button aria-label="Close" onClick={() => onClose(win.id)} className="w-3.5 h-3.5 rounded-full bg-red-400 hover:bg-red-500" />
      </div>
      {busy && <div className="h-0.5 w-full bg-blue-500/80 animate-pulse" />}
      {win.loading ? (
        <div className="flex-1 grid place-items-center bg-white">
          <div className="text-center animate-pulse">
            <div className="text-4xl mb-2">{win.icon ?? "🪟"}</div>
            <div className="text-sm text-slate-600">Hallucinating {win.title}…</div>
          </div>
        </div>
      ) : (
        <iframe ref={frameRef} title={win.title} onLoad={onLoad} sandbox="allow-same-origin" srcDoc={wrapSandboxed(win.html)} className="flex-1 w-full bg-white" />
      )}
    </div>
  );
}
