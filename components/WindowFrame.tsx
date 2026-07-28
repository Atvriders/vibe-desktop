"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyOps } from "@/lib/apply-ops";
import { capFieldMap, truncateBytes } from "@/lib/byte-cap";
import { clampToViewport, resizeWindow, type ResizeDir } from "@/lib/geometry";
import { wrapSandboxed } from "@/lib/sandbox-doc";
import { sanitizeHtml } from "@/lib/sanitize";
import { MAX_INPUTS_LEN, MAX_QUERY_LEN, MAX_SNAPSHOT_LEN } from "@/lib/types";
import type { CallUsage } from "@/lib/types";

export interface WinState {
  id: string;
  title: string;
  icon?: string;
  html: string;
  w: number;
  h: number;
  maximized: boolean;
  restore?: { x: number; y: number; w: number; h: number };
  loading: boolean;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
  /** Telemetry from the call that produced this window's current screen. */
  usage?: CallUsage;
}

const TASKBAR_H = 64;
// Windows live in a band strictly below the shell (taskbar/menus at 1000+).
const MAX_WINDOW_Z = 900;

type PatchAction = "click" | "contextmenu" | "submit";

interface PatchOpts {
  target?: Element | null;
  clientX?: number;
  clientY?: number;
  action?: PatchAction;
  instruction?: string;
}

const BANNER_LOST = "Lost the thread — reopen this window";
const BANNER_UNAVAILABLE = "Model unavailable — click to retry";

export function formatUsage(u: CallUsage): string {
  const secs = `${(u.ms / 1000).toFixed(1)}s`;
  if (!u.cacheReadTokens) return secs;
  const cached = u.cacheReadTokens >= 1000 ? `${(u.cacheReadTokens / 1000).toFixed(1)}k` : String(u.cacheReadTokens);
  return `${secs} · ${cached} cached`;
}

/** The two keys the desktop shell owns: Escape dismisses whatever is open and
 *  Ctrl/Cmd+K toggles Spotlight. Kept in sync with the handler in app/page.tsx. */
export function isShellKey(e: KeyboardEvent): boolean {
  return e.key === "Escape" || ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K"));
}

/** Re-dispatch a shell key on the HOST document. This module runs in the host, so
 *  its `document` is the parent one — the frame's own document is `e.target`'s. */
function forwardShellKey(e: KeyboardEvent): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true }),
  );
}

// Pointer capture keeps move/up flowing to the handle even when the cursor
// crosses an iframe (which otherwise eats the events and strands the drag).
// jsdom implements neither method, hence the feature-detect.
function capturePointer(el: Element, pointerId: number) {
  if (typeof el.setPointerCapture === "function") el.setPointerCapture(pointerId);
}

export function WindowFrame({
  win, onClose, onFocus, onMove, onResize, onToggleMax, onToggleMinimize,
}: {
  win: WinState;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, x: number, y: number, w: number, h: number) => void;
  onToggleMax: (id: string) => void;
  onToggleMinimize: (id: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const clicks = useRef(0);
  const needsResync = useRef(false);
  // A ref, not the `busy` state: two sends inside one React batch would both
  // read `busy === false`. The busy overlay only covers the iframe, so it
  // cannot serialise the in-frame keydown path or the title-bar ✨ bar.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [patchUsage, setPatchUsage] = useState<CallUsage | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const usage = patchUsage ?? win.usage ?? null;

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  async function sendPatch(doc: Document, opts: PatchOpts) {
    if (inFlight.current) return;
    inFlight.current = true;
    // A lost session cannot recover, so hold that banner up across the retry
    // instead of blanking it for a whole round trip.
    setBanner((b) => (b === BANNER_LOST ? b : null));
    onFocus(win.id);
    const rect = doc.documentElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round(((opts.clientX ?? 0) / (rect.width || 1)) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((opts.clientY ?? 0) / (rect.height || 1)) * 100)));
    clicks.current += 1;
    const sendSnapshot = clicks.current % 10 === 0 || needsResync.current;
    // Addendum B: collect typed field values before POST.
    // Capped on the way out, in document order: an app is free to draw a 500KB
    // textarea, and an uncapped harvest rides on EVERY click — the same 413 →
    // needsResync → permanently wedged window as an uncapped snapshot, just
    // through a different field. engine.ts caps the joined clause too, but only
    // after the body guard has already refused the request.
    const fields: Array<[string, string]> = [];
    doc.querySelectorAll<HTMLInputElement>("input[id],textarea[id],select[id]").forEach((el) => { fields.push([el.id, el.value]); });
    const inputs = capFieldMap(fields, MAX_INPUTS_LEN);
    setBusy(true);
    try {
      const r = await fetch("/api/window/patch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          windowId: win.id,
          elementId: opts.target ? opts.target.id : null,
          x, y,
          action: opts.action,
          // The last unbounded field: a paste into the ✨ bar is user text, and the
          // server's own MAX_QUERY_LEN only applies once the body is already past
          // the guard. Truncating to the same budget here loses nothing.
          instruction: truncateBytes(opts.instruction ?? "", MAX_QUERY_LEN) || undefined,
          // Capped HERE, not only server-side: the 256KB body guard runs before
          // any of the server's own limits, and a 413 sets needsResync — which
          // would re-send this exact oversize snapshot on every later click and
          // leave the window permanently stuck behind the retry banner.
          // In BYTES, not characters: the guard rejects on content-length, and
          // String.slice counts UTF-16 units — a 100k-character CJK or emoji DOM
          // slices to "within the cap" and still arrives as ~300KB.
          domSnapshot: sendSnapshot ? truncateBytes(doc.body.innerHTML, MAX_SNAPSHOT_LEN) : undefined,
          inputs,
        }),
      });
      if (!r.ok) {
        // A failed turn changes nothing server-side, so the queued snapshot
        // must survive — clearing it here is how a resync got lost.
        needsResync.current = true;
        setBanner(r.status === 404 ? BANNER_LOST : BANNER_UNAVAILABLE);
        console.error(`[${win.title}] patch http:${r.status}`);
        return;
      }
      setBanner(null);
      const data = await r.json();
      const result = data.ops ? applyOps(doc, data.ops) : { applied: [], dropped: [] };
      needsResync.current = result.dropped.length > 0;
      if (data.usage) setPatchUsage(data.usage as CallUsage);
      // diagnostic: see exactly what each click did (open DevTools console)
      console.log(
        `[${win.title}] ${opts.action ?? "instruction"} id=${opts.target ? opts.target.id : "(none)"} → http:${r.status} ` +
          `ops:${data.ops?.length ?? 0} applied:${result.applied.length} dropped:${result.dropped.length} ` +
          `stop:${data.stopReason ?? "?"} cacheRead:${data.usage?.cacheReadTokens ?? 0}`,
      );
    } catch (err) {
      needsResync.current = true;
      setBanner(BANNER_UNAVAILABLE);
      console.error("patch failed", err);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // The iframe listeners below are attached exactly once per load, so they must
  // never close over sendPatch directly — win.id alone changes tmp-N → the real
  // windowId one render after the frame loads.
  const sendPatchRef = useRef(sendPatch);
  useEffect(() => { sendPatchRef.current = sendPatch; });

  function submitInstruction(e: React.FormEvent) {
    e.preventDefault();
    const text = instruction.trim();
    const doc = frameRef.current?.contentDocument;
    // The in-flight guard has to be read BEFORE the bar is cleared: sendPatch
    // would return without sending and the typed instruction would be gone.
    if (!text || !doc || inFlight.current) return;
    setInstruction("");
    setAskOpen(false);
    void sendPatch(doc, { instruction: text });
  }

  // The initial HTML is model-authored too — it must go through the same scrub
  // as every patched fragment before it becomes a document.
  const srcDoc = useMemo(() => wrapSandboxed(sanitizeHtml(win.html)), [win.html]);

  function onLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (e) => {
      // The host turns every click into a patch, so no in-frame default is ever
      // wanted — an unprevented <a href> navigates the frame off-origin.
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, clientX: e.clientX, clientY: e.clientY, action: "click" });
    }, true);
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, clientX: e.clientX, clientY: e.clientY, action: "contextmenu" });
    }, true);
    // Enter is the only key worth a round trip; every printable key would be one
    // model call per keystroke. Field values already ride along in `inputs`.
    doc.addEventListener("keydown", (e) => {
      // A keydown raised inside a same-origin iframe does NOT propagate to the
      // host document, so the desktop's own document-level handler is inert the
      // moment focus lands in any app — the normal steady state, and unavoidable
      // once a window is maximized. Re-raise the two shell keys on the host.
      if (isShellKey(e)) {
        // Ctrl/Cmd+K has a browser default (focus the address bar) worth killing.
        if (e.key !== "Escape") e.preventDefault();
        forwardShellKey(e);
        return;
      }
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, action: "submit" });
    }, true);
  }

  // React.PointerEvent<HTMLElement> (not bare React.PointerEvent): pointermove
  // is in HTMLElementEventMap only, so a plain Element's addEventListener does
  // not accept it and tsc fails with TS2769.
  function startResize(e: React.PointerEvent<HTMLElement>, dir: ResizeDir) {
    e.preventDefault(); e.stopPropagation();
    onFocus(win.id);
    const el = e.currentTarget;
    capturePointer(el, e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const rect = { x: win.x, y: win.y, w: win.w, h: win.h };
    function move(ev: PointerEvent) {
      const r = resizeWindow(dir, ev.clientX - startX, ev.clientY - startY, rect, { vw: window.innerWidth, vh: window.innerHeight });
      onResize(win.id, r.x, r.y, r.w, r.h);
    }
    function up() {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function startDrag(e: React.PointerEvent<HTMLElement>) {
    if (win.maximized) return;
    // The close/minimize/maximize dots live inside the drag surface.
    if ((e.target as HTMLElement).closest("button")) return;
    onFocus(win.id);
    const el = e.currentTarget;
    capturePointer(el, e.pointerId);
    const startX = e.clientX, startY = e.clientY, ox = win.x, oy = win.y;
    function move(ev: PointerEvent) {
      const node = rootRef.current;
      const w = node?.offsetWidth ?? 520;
      const h = node?.offsetHeight ?? 380;
      const c = clampToViewport(ox + ev.clientX - startX, oy + ev.clientY - startY, w, h, window.innerWidth, window.innerHeight, TASKBAR_H);
      onMove(win.id, c.x, c.y);
    }
    function up() {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  return (
    <div
      ref={rootRef}
      data-window-id={win.id}
      onPointerDown={() => onFocus(win.id)}
      style={{ position: "absolute", left: win.x, top: win.y, zIndex: Math.min(10 + win.z, MAX_WINDOW_Z), width: win.w, height: win.h, overflow: "hidden", display: win.minimized ? "none" : undefined }}
      className="rounded-xl border border-white/60 ring-1 ring-black/10 shadow-2xl bg-white/80 backdrop-blur-xl flex flex-col"
    >
      <div className="bg-white/60 border-b border-white/40">
        <div data-testid="titlebar" onPointerDown={startDrag} onDoubleClick={() => onToggleMax(win.id)} className="cursor-move select-none flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium text-slate-700 truncate">{win.icon ? win.icon + " " : ""}{win.title}</span>
          <div className="flex items-center gap-1.5">
            {usage && (
              <span data-testid="usage-chip" className="mr-1 text-[10px] tabular-nums text-slate-400">{formatUsage(usage)}</span>
            )}
            <button
              aria-label="Ask this app"
              title="Ask this app"
              onClick={() => setAskOpen((a) => !a)}
              disabled={busy}
              className="px-1 text-xs leading-none text-slate-500 hover:text-slate-800 disabled:opacity-40"
            >
              ✨
            </button>
            <button
              aria-label="Minimize"
              title="Minimize"
              onClick={() => onToggleMinimize(win.id)}
              className="w-3.5 h-3.5 rounded-full bg-amber-400 hover:bg-amber-500"
            />
            <button
              aria-label={win.maximized ? "Restore" : "Maximize"}
              title={win.maximized ? "Restore" : "Maximize"}
              onClick={() => onToggleMax(win.id)}
              className="w-3.5 h-3.5 rounded-full bg-green-400 hover:bg-green-500"
            />
            <button aria-label="Close" onClick={() => onClose(win.id)} className="w-3.5 h-3.5 rounded-full bg-red-400 hover:bg-red-500" />
          </div>
        </div>
        {askOpen && (
          <form onSubmit={submitInstruction} className="px-3 pb-2">
            <input
              autoFocus
              aria-label="Instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={busy}
              placeholder="Tell this app what to do…"
              className="w-full rounded-lg px-2 py-1 text-sm text-slate-800 bg-white/90 outline-none border border-white/60 disabled:opacity-60"
            />
          </form>
        )}
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
          <iframe ref={frameRef} title={win.title} onLoad={onLoad} sandbox="allow-same-origin" srcDoc={srcDoc} className="absolute inset-0 w-full h-full bg-white" />
          {banner && (
            <div data-testid="patch-banner" className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 py-2 bg-amber-100/95 text-amber-900 text-xs shadow">
              <span>{banner}</span>
              <button aria-label="Dismiss" onClick={() => setBanner(null)} className="px-2 rounded hover:bg-amber-200">✕</button>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/40 backdrop-blur-[1px]">
              <div data-testid="busy-pill" className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 shadow-lg text-sm font-medium text-slate-700 animate-pulse">
                <span>✨</span> Hallucinating… {elapsed}s
              </div>
            </div>
          )}
        </div>
      )}
      {/* 8-direction resize handles */}
      {!win.maximized && (<>
        <div data-testid="resize-n" onPointerDown={(e) => startResize(e, "n")} className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
        <div data-testid="resize-s" onPointerDown={(e) => startResize(e, "s")} className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
        <div data-testid="resize-e" onPointerDown={(e) => startResize(e, "e")} className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
        <div data-testid="resize-w" onPointerDown={(e) => startResize(e, "w")} className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
        <div data-testid="resize-nw" onPointerDown={(e) => startResize(e, "nw")} className="absolute top-0 left-0 w-2.5 h-2.5 cursor-nwse-resize z-20" />
        <div data-testid="resize-ne" onPointerDown={(e) => startResize(e, "ne")} className="absolute top-0 right-0 w-2.5 h-2.5 cursor-nesw-resize z-20" />
        <div data-testid="resize-sw" onPointerDown={(e) => startResize(e, "sw")} className="absolute bottom-0 left-0 w-2.5 h-2.5 cursor-nesw-resize z-20" />
        <div data-testid="resize-se" onPointerDown={(e) => startResize(e, "se")} className="absolute bottom-0 right-0 w-2.5 h-2.5 cursor-nwse-resize z-20" />
      </>)}
    </div>
  );
}
