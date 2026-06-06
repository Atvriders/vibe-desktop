"use client";
import { useRef } from "react";
import { applyOps } from "@/lib/apply-ops";

export interface WinState {
  id: string;
  title: string;
  html: string;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
}

export function WindowFrame({
  win,
  onClose,
  onFocus,
  onMove,
}: {
  win: WinState;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const clicks = useRef(0);

  // Parent-attached capture listener: fires even though the iframe has no
  // allow-scripts. Resolves the clicked element's id and asks for a patch.
  function onLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener(
      "click",
      async (e) => {
        const target = (e.target as Element | null)?.closest?.("[id]") as Element | null;
        if (!target) return;
        clicks.current += 1;
        const sendSnapshot = clicks.current % 10 === 0; // periodic drift resync
        try {
          const r = await fetch("/api/window/patch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              windowId: win.id,
              elementId: target.id,
              domSnapshot: sendSnapshot ? doc.body.innerHTML : undefined,
            }),
          });
          const data = await r.json();
          if (data.ops) applyOps(doc, data.ops);
          if (typeof data.cacheReadTokens === "number") {
            console.log(`[${win.title}] cache_read_input_tokens =`, data.cacheReadTokens);
          }
        } catch (err) {
          console.error("patch failed", err);
        }
      },
      true,
    );
  }

  function startDrag(e: React.PointerEvent) {
    onFocus(win.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = win.x;
    const oy = win.y;
    function move(ev: PointerEvent) {
      onMove(win.id, ox + ev.clientX - startX, oy + ev.clientY - startY);
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
      onPointerDown={() => onFocus(win.id)}
      style={{ position: "absolute", left: win.x, top: win.y, zIndex: win.z, width: 520, height: 380, resize: "both", overflow: "hidden" }}
      className="rounded-xl shadow-2xl border border-white/40 bg-white/80 backdrop-blur-xl flex flex-col"
    >
      <div
        onPointerDown={startDrag}
        className="cursor-move select-none flex items-center justify-between px-3 py-2 bg-white/60 border-b border-white/40"
      >
        <span className="text-sm font-medium text-slate-700 truncate">{win.title}</span>
        <button
          aria-label="Close"
          onClick={() => onClose(win.id)}
          className="w-3.5 h-3.5 rounded-full bg-red-400 hover:bg-red-500"
        />
      </div>
      <iframe
        ref={frameRef}
        title={win.title}
        onLoad={onLoad}
        sandbox="allow-same-origin"
        srcDoc={win.html}
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}
