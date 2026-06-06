# VibeDesktop v2 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Start menu of built-in apps, a hallucinated Settings app, desktop & in-app right-click menus, original-sounding searched app names, loading screens, on-screen drag clamping + clearer window borders, and a coordinate/grid-aware click model so every click advances the UI.

**Architecture:** All additive on the shipped MVP. Built-in apps and Settings reuse the existing `/api/window/open` flow. The click→patch loop gains click coordinates (% of window) + an `action` (`click`/`contextmenu`) alongside the nearest element id, so Claude can map any click to its own generated HTML. New shell UI (Start menu, desktop context menu, window boot screen) is plain React.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Vitest + jsdom + RTL. Branch: `feat/v2-desktop`.

**Spec:** `docs/superpowers/specs/2026-06-06-vibe-desktop-v2-features-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/geometry.ts` | new | `clampToViewport` pure helper |
| `lib/builtin-apps.ts` | new | `BUILTIN_APPS` constant |
| `lib/tool-schema.ts` | modify | original-names `SEARCH_SYSTEM` |
| `lib/engine.ts` | modify | `patchWindow` takes `{elementId,x,y,action,domSnapshot}` |
| `app/api/window/patch/route.ts` | modify | parse `x,y,action` |
| `components/WindowFrame.tsx` | rewrite | boot screen, busy bar, coord clicks + contextmenu, drag clamp, border; `WinState` gains `loading`/`icon` |
| `components/StartMenu.tsx` | new | built-in apps grid |
| `components/DesktopContextMenu.tsx` | new | desktop right-click menu |
| `components/Taskbar.tsx` | modify | add Start button |
| `app/page.tsx` | rewrite | built-ins, start menu, desktop menu, optimistic loading window, spawn clamp |

Each implementer should `git checkout`-verify they are on `feat/v2-desktop`. Run the gate (`npx vitest run` + `npx tsc --noEmit`) before each commit; the controller runs the live app for the "run + observe" checks.

---

## Task 1: Viewport clamp helper (TDD)

**Files:** Create `lib/geometry.ts`, `lib/geometry.test.ts`.

- [ ] **Step 1: Failing test** — `lib/geometry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { clampToViewport } from "./geometry";

describe("clampToViewport", () => {
  it("keeps an in-bounds window unchanged", () => {
    expect(clampToViewport(100, 100, 520, 380, 1920, 1080, 64)).toEqual({ x: 100, y: 100 });
  });
  it("clamps negative coords to 0", () => {
    expect(clampToViewport(-50, -30, 520, 380, 1920, 1080, 64)).toEqual({ x: 0, y: 0 });
  });
  it("clamps overflow so the window stays fully on-screen above the taskbar", () => {
    expect(clampToViewport(9999, 9999, 520, 380, 1000, 800, 64)).toEqual({ x: 480, y: 356 });
  });
  it("never returns negative when the window is larger than the viewport", () => {
    expect(clampToViewport(10, 10, 2000, 2000, 1000, 800, 64)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run lib/geometry.test.ts` (clampToViewport not exported).

- [ ] **Step 3: Implement** — `lib/geometry.ts`:
```ts
/** Clamp a window's top-left so it stays fully on-screen and above the taskbar. */
export function clampToViewport(
  x: number, y: number, w: number, h: number, vw: number, vh: number, taskbarH = 64,
): { x: number; y: number } {
  const maxX = Math.max(0, vw - w);
  const maxY = Math.max(0, vh - h - taskbarH);
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}
```

- [ ] **Step 4: Run → PASS** (4 tests).
- [ ] **Step 5: Commit** — `git add lib/geometry.ts lib/geometry.test.ts && git commit -m "feat: viewport clamp helper"`

---

## Task 2: Built-in apps list (TDD)

**Files:** Create `lib/builtin-apps.ts`, `lib/builtin-apps.test.ts`.

- [ ] **Step 1: Failing test** — `lib/builtin-apps.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { BUILTIN_APPS } from "./builtin-apps";

describe("BUILTIN_APPS", () => {
  it("includes Settings and has unique ids + icons", () => {
    expect(BUILTIN_APPS.find((a) => a.id === "settings")?.name).toBe("Settings");
    const ids = BUILTIN_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_APPS.every((a) => a.icon && a.name && a.blurb)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run lib/builtin-apps.test.ts`.

- [ ] **Step 3: Implement** — `lib/builtin-apps.ts`:
```ts
import type { AppCard } from "./types";

/** Generic, familiar apps launchable from the Start menu (not search results). */
export const BUILTIN_APPS: AppCard[] = [
  { id: "settings", name: "Settings", icon: "⚙️", blurb: "System settings" },
  { id: "notepad", name: "Notepad", icon: "📝", blurb: "Plain-text editor" },
  { id: "calculator", name: "Calculator", icon: "🧮", blurb: "Crunch numbers" },
  { id: "browser", name: "Web Browser", icon: "🌐", blurb: "Browse the web" },
  { id: "files", name: "Files", icon: "📁", blurb: "File explorer" },
  { id: "paint", name: "Paint", icon: "🎨", blurb: "Draw and sketch" },
  { id: "music", name: "Music", icon: "🎵", blurb: "Play your tunes" },
  { id: "clock", name: "Clock", icon: "🕐", blurb: "Time and alarms" },
  { id: "terminal", name: "Terminal", icon: "⌨️", blurb: "Command line" },
  { id: "mail", name: "Mail", icon: "✉️", blurb: "Read your email" },
];
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add lib/builtin-apps.ts lib/builtin-apps.test.ts && git commit -m "feat: built-in apps list"`

---

## Task 3: Original-name search prompt (TDD)

**Files:** Modify `lib/tool-schema.ts`; create `lib/tool-schema.test.ts`.

- [ ] **Step 1: Failing test** — `lib/tool-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SEARCH_SYSTEM } from "./tool-schema";

describe("SEARCH_SYSTEM", () => {
  it("instructs the model to invent original names and avoid real products", () => {
    expect(SEARCH_SYSTEM.toLowerCase()).toContain("original");
    expect(SEARCH_SYSTEM.toLowerCase()).toMatch(/real|trademark|existing/);
  });
});
```

- [ ] **Step 2: Run → FAIL** (the current `SEARCH_SYSTEM` doesn't mention originality). `npx vitest run lib/tool-schema.test.ts`.

- [ ] **Step 3: Implement** — read `lib/tool-schema.ts` and replace the `SEARCH_SYSTEM` constant with:
```ts
export const SEARCH_SYSTEM =
`You are the search backend of a whimsical operating system that can conjure any app on demand. Given the user's query, invent up to 6 plausible, fun applications that fit it.
Every app NAME must be ORIGINAL and made-up — a believable indie-app brand name. Do NOT use the name of any real, existing, or trademarked product, company, or service, and avoid plain dictionary words. Coin new names (you may blend or twist words). Each app also needs a single emoji icon and a one-line blurb. Always respond by calling the app_results tool.`;
```
(Leave `WINDOW_SYSTEM`, `APPLY_DOM_PATCH_TOOL`, `APP_CARDS_TOOL` unchanged.)

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add lib/tool-schema.ts lib/tool-schema.test.ts && git commit -m "feat: original-name search prompt"`

---

## Task 4: Coordinate + action in engine & patch route (TDD)

**Files:** Modify `lib/engine.ts`, `app/api/window/patch/route.ts`; update `lib/engine.test.ts`, `app/api/routes.test.ts`.

- [ ] **Step 1: Update the failing tests first.**

In `lib/engine.test.ts`, change the `patchWindow` happy-path call and add wording assertions. Replace the existing `patchWindow` test with:
```ts
  it("patchWindow returns ops and sends coordinate-aware wording", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\">0</div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t2", name: "apply_dom_patch", input: { ops: [{ op: "setText", id: "d", value: "7" }] } }],
      usage: { cache_read_input_tokens: 5 },
    });
    const { ops, cacheReadTokens } = await patchWindow(windowId, { elementId: "btn7", x: 42, y: 88, action: "click" });
    expect(ops[0]).toMatchObject({ op: "setText", id: "d", value: "7" });
    expect(cacheReadTokens).toBe(5);
    const lastCall = create.mock.calls.at(-1)![0];
    const userText = JSON.stringify(lastCall.messages);
    expect(userText).toContain("x=42");
    expect(userText).toContain("y=88");
    expect(userText).toContain("btn7");
  });

  it("patchWindow throws on unknown window", async () => {
    await expect(patchWindow("nope", { x: 1, y: 1 })).rejects.toThrow();
  });
```

In `app/api/routes.test.ts`, update the patch happy-path + add coordinate fields:
```ts
  it("patch returns ops", async () => {
    patchWindow.mockResolvedValue({ ops: [{ op: "setText", id: "d", value: "7" }], cacheReadTokens: 5 });
    const res = await patchPOST(post({ windowId: "w1", elementId: "b7", x: 10, y: 20, action: "click" }));
    expect(await res.json()).toEqual({ ops: [{ op: "setText", id: "d", value: "7" }], cacheReadTokens: 5 });
    expect(patchWindow).toHaveBeenCalledWith("w1", { elementId: "b7", x: 10, y: 20, action: "click", domSnapshot: undefined });
  });
```
(Keep the existing "patch 404s on unknown window" test; update its body to `post({ windowId: "ghost", elementId: "b", x: 0, y: 0 })`.)

- [ ] **Step 2: Run → FAIL.** `npx vitest run lib/engine.test.ts app/api/routes.test.ts`.

- [ ] **Step 3: Implement engine** — in `lib/engine.ts`, replace the `patchWindow` function (keep `UnknownWindowError`, imports, `searchApps`, `openWindow`) with:
```ts
export interface PatchInput {
  elementId?: string | null;
  x: number;
  y: number;
  action?: "click" | "contextmenu";
  domSnapshot?: string;
}

export async function patchWindow(
  windowId: string,
  input: PatchInput,
): Promise<{ ops: RawOp[]; cacheReadTokens: number }> {
  const session = getSession(windowId);
  if (!session) throw new UnknownWindowError(`unknown window: ${windowId}`);

  if (input.domSnapshot) {
    session.messages.push({
      role: "user",
      content: `The current DOM is:\n${input.domSnapshot}\nContinue from this exact state.`,
    });
  }
  const verb = input.action === "contextmenu" ? "right-clicked" : "clicked";
  const on = input.elementId ? `, on or near the element with id "${input.elementId}"` : "";
  const menu = input.action === "contextmenu" ? " If a context menu is appropriate, render it." : "";
  session.messages.push({
    role: "user",
    content:
      `The user ${verb} at x=${input.x}, y=${input.y} (percent of the window, top-left origin)${on}. ` +
      `Using the HTML you generated, determine what was clicked and return the DOM patch for the resulting screen.${menu}`,
  });

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: NO_THINK,
    system: frozenSystem(WINDOW_SYSTEM(session.appName)),
    tools: [APPLY_DOM_PATCH_TOOL],
    tool_choice: { type: "tool", name: "apply_dom_patch" },
    messages: cacheLastTurn(session.messages),
  });

  const block = res.content.find((b) => b.type === "tool_use");
  const ops = (block && block.type === "tool_use" ? (block.input as { ops?: RawOp[] }).ops ?? [] : []);
  session.messages.push({ role: "assistant", content: res.content });
  if (block && block.type === "tool_use") {
    session.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content: "applied" }] });
  }
  return { ops, cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0 };
}
```

- [ ] **Step 4: Implement route** — replace `app/api/window/patch/route.ts` body with:
```ts
import { NextResponse } from "next/server";
import { patchWindow, UnknownWindowError } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { windowId, elementId, x, y, action, domSnapshot } = await req.json().catch(() => ({}));
  if (!windowId || typeof x !== "number" || typeof y !== "number") {
    return NextResponse.json({ error: "windowId, x and y required" }, { status: 400 });
  }
  try {
    const { ops, cacheReadTokens } = await patchWindow(windowId, {
      elementId: elementId ?? null,
      x, y,
      action: action === "contextmenu" ? "contextmenu" : "click",
      domSnapshot,
    });
    return NextResponse.json({ ops, cacheReadTokens });
  } catch (e) {
    if (e instanceof UnknownWindowError) {
      return NextResponse.json({ error: "unknown window" }, { status: 404 });
    }
    console.error("patch failed", e);
    return NextResponse.json({ error: "patch failed" }, { status: 502 });
  }
}
```
> Note: the route test asserts `patchWindow` is called with `{ elementId, x, y, action, domSnapshot }`. The `post({...})` helper omits `domSnapshot`, so it arrives as `undefined` — matched by the test.

- [ ] **Step 5: Run → PASS.** `npx vitest run lib/engine.test.ts app/api/routes.test.ts` and `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add lib/engine.ts lib/engine.test.ts app/api/window/patch/route.ts app/api/routes.test.ts && git commit -m "feat: coordinate + action aware patch"`

---

## Task 5: WindowFrame v2 (rewrite) (TDD)

**Files:** Rewrite `components/WindowFrame.tsx`; update `components/WindowFrame.test.tsx`.

- [ ] **Step 1: Update the test** — `components/WindowFrame.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowFrame, type WinState } from "./WindowFrame";

const base: WinState = { id: "w1", title: "Calculator", icon: "🧮", html: "<div id=\"d\">0</div>", loading: false, x: 10, y: 10, z: 1, minimized: false };

describe("WindowFrame", () => {
  it("shows the title and closes on the close button", () => {
    const onClose = vi.fn();
    render(<WindowFrame win={base} onClose={onClose} onFocus={() => {}} onMove={() => {}} />);
    expect(screen.getByText(/Calculator/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledWith("w1");
  });

  it("shows a boot screen while loading", () => {
    render(<WindowFrame win={{ ...base, loading: true, html: "" }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} />);
    expect(screen.getByText(/Booting Calculator/)).toBeInTheDocument();
  });

  it("renders nothing when minimized", () => {
    const { container } = render(<WindowFrame win={{ ...base, minimized: true }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run → FAIL** (boot-screen test fails; `WinState` lacks `loading`/`icon`). `npx vitest run components/WindowFrame.test.tsx`.

- [ ] **Step 3: Implement** — replace `components/WindowFrame.tsx` entirely:
```tsx
"use client";
import { useRef, useState } from "react";
import { applyOps } from "@/lib/apply-ops";
import { clampToViewport } from "@/lib/geometry";

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
        }),
      });
      const data = await r.json();
      const result = data.ops ? applyOps(doc, data.ops) : { applied: [], dropped: [] };
      needsResync.current = result.dropped.length > 0;
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
            <div className="text-sm text-slate-600">Booting {win.title}…</div>
          </div>
        </div>
      ) : (
        <iframe ref={frameRef} title={win.title} onLoad={onLoad} sandbox="allow-same-origin" srcDoc={win.html} className="flex-1 w-full bg-white" />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** (`npx vitest run components/WindowFrame.test.tsx`). Note: this changes `WinState` (adds `loading`/`icon`) — `Taskbar.tsx` and `app/page.tsx` import `WinState`; they're updated in Tasks 6–7, so `npx tsc --noEmit` may fail until then. That's expected; run the full typecheck after Task 7.
- [ ] **Step 5: Commit** — `git add components/WindowFrame.tsx components/WindowFrame.test.tsx && git commit -m "feat: window frame v2 (boot screen, coord clicks, drag clamp, border)"`

---

## Task 6: Start menu + desktop context menu + taskbar Start button (TDD)

**Files:** Create `components/StartMenu.tsx`, `components/StartMenu.test.tsx`, `components/DesktopContextMenu.tsx`, `components/DesktopContextMenu.test.tsx`; modify `components/Taskbar.tsx`.

- [ ] **Step 1: Failing tests.**

`components/StartMenu.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StartMenu } from "./StartMenu";

describe("StartMenu", () => {
  it("lists built-in apps and opens one", () => {
    const onOpen = vi.fn();
    render(<StartMenu onOpen={onOpen} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Settings"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "settings", name: "Settings" }));
  });
});
```

`components/DesktopContextMenu.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopContextMenu } from "./DesktopContextMenu";

describe("DesktopContextMenu", () => {
  it("fires New app and Settings actions", () => {
    const onNewApp = vi.fn(), onSettings = vi.fn();
    render(<DesktopContextMenu x={5} y={5} onNewApp={onNewApp} onSettings={onSettings} />);
    fireEvent.click(screen.getByText("New app…"));
    fireEvent.click(screen.getByText("Settings"));
    expect(onNewApp).toHaveBeenCalled();
    expect(onSettings).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run components/StartMenu.test.tsx components/DesktopContextMenu.test.tsx`.

- [ ] **Step 3: Implement components.**

`components/StartMenu.tsx`:
```tsx
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
```

`components/DesktopContextMenu.tsx`:
```tsx
"use client";
export function DesktopContextMenu({
  x, y, onNewApp, onSettings,
}: {
  x: number; y: number; onNewApp: () => void; onSettings: () => void;
}) {
  return (
    <div
      className="fixed z-50 min-w-[10rem] rounded-lg bg-white/95 backdrop-blur shadow-xl border border-slate-200 py-1 text-sm text-slate-700"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onNewApp} className="block w-full text-left px-3 py-1.5 hover:bg-slate-100">New app…</button>
      <button onClick={onSettings} className="block w-full text-left px-3 py-1.5 hover:bg-slate-100">Settings</button>
    </div>
  );
}
```

- [ ] **Step 4: Modify Taskbar** — replace `components/Taskbar.tsx`:
```tsx
"use client";
import type { WinState } from "./WindowFrame";

export function Taskbar({
  windows, onStart, onSearch, onFocus,
}: {
  windows: WinState[];
  onStart: () => void;
  onSearch: () => void;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl px-3 py-2 bg-white/70 backdrop-blur-xl shadow-2xl border border-white/40">
      <button onClick={onStart} aria-label="Start" className="w-9 h-9 rounded-xl bg-blue-600 text-white grid place-items-center text-lg">⊞</button>
      <button onClick={onSearch} aria-label="Search" className="w-9 h-9 rounded-xl bg-white/80 text-slate-700 grid place-items-center text-lg">⌕</button>
      {windows.map((w) => (
        <button key={w.id} onClick={() => onFocus(w.id)} className="px-3 h-9 rounded-xl bg-white/80 text-sm text-slate-700 max-w-[10rem] truncate">
          {w.icon ? w.icon + " " : ""}{w.title}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run → PASS** (`npx vitest run components/StartMenu.test.tsx components/DesktopContextMenu.test.tsx`).
- [ ] **Step 6: Commit** — `git add components/StartMenu.tsx components/StartMenu.test.tsx components/DesktopContextMenu.tsx components/DesktopContextMenu.test.tsx components/Taskbar.tsx && git commit -m "feat: start menu, desktop context menu, taskbar start button"`

---

## Task 7: Desktop wiring (rewrite page) + full verify

**Files:** Rewrite `app/page.tsx`.

- [ ] **Step 1: Implement** — replace `app/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Spotlight } from "@/components/Spotlight";
import { Taskbar } from "@/components/Taskbar";
import { StartMenu } from "@/components/StartMenu";
import { DesktopContextMenu } from "@/components/DesktopContextMenu";
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
    setWindows((ws) => [...ws, { id: tempId, title: card.name, icon: card.icon, html: "", loading: true, x: spawn.x, y: spawn.y, z, minimized: false }]);
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
  function close(id: string) { setWindows((ws) => ws.filter((w) => w.id !== id)); }

  const settings = BUILTIN_APPS.find((a) => a.id === "settings")!;

  return (
    <main
      className="relative w-screen h-screen overflow-hidden"
      style={{ background: "linear-gradient(135deg,#3a6ea5,#6a5acd)" }}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      onClick={() => setCtxMenu(null)}
    >
      {windows.map((w) => (<WindowFrame key={w.id} win={w} onClose={close} onFocus={focus} onMove={move} />))}
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
```

- [ ] **Step 2: Full verify** — run:
```bash
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: tsc clean; all tests pass (MVP + v2); build succeeds. Fix any integration types until green.

- [ ] **Step 3: Commit** — `git add app/page.tsx && git commit -m "feat: wire v2 desktop (start menu, context menu, loading windows)"`

---

## Task 8: Manual run + observe (controller)

**Files:** none. Requires a real `ANTHROPIC_API_KEY`.

- [ ] **Step 1:** `npm run dev` (note: it may pick a free port if 3000 is busy).
- [ ] **Step 2:** Verify acceptance criteria from the spec:
  1. Start (⊞) opens the built-in grid; a built-in opens with a boot screen then paints.
  2. Settings opens a Windows-Settings-looking window.
  3. Right-click the desktop → New app… / Settings; right-click inside an app → a model-drawn menu.
  4. Searched names sound original (no real brands); built-ins stay generic.
  5. Each click shows a busy bar; opening shows a boot screen.
  6. Windows can't be dragged off-screen or under the taskbar; clear borders.
  7. Clicking anywhere (even untagged buttons) advances the UI.
- [ ] **Step 3:** Note any gaps; fix in a follow-up task.

---

## v2.1 additions (refine/extend the tasks above)

### A. Loading word — "Hallucinating"
In Task 5's WindowFrame boot screen, the text is **`Hallucinating {win.title}…`** (not "Booting"); update the WindowFrame boot-screen test assertion to `/Hallucinating Calculator/`. Also change Spotlight's "Conjuring apps…" to **"Hallucinating apps…"**.

### B. Typed-input capture → the hallucinating Web Browser (extends Tasks 3, 4, 5)
Every click/contextmenu also sends the current value of each text field so Claude knows what the user typed (address bars, search boxes, forms). This is what makes the Web Browser app work: type a URL → Claude hallucinates that page.
- **`PatchInput`** (engine) gains `inputs?: Record<string, string>`. When present and non-empty, `patchWindow` appends to the user turn: `" Current field values: " + Object.entries(inputs).map(([k, v]) => k + "=\"" + v + "\"").join(", ") + "."`.
- **patch route** parses and forwards `inputs` (default `{}`).
- **`WindowFrame.sendPatch`** collects before POST:
  ```ts
  const inputs: Record<string, string> = {};
  doc.querySelectorAll<HTMLInputElement>("input[id],textarea[id],select[id]").forEach((el) => { inputs[el.id] = el.value; });
  ```
  and includes `inputs` in the body. (Sandbox note: with `allow-same-origin` but no `allow-scripts`, users can still type into native `<input>`/`<textarea>`; only scripting is blocked, so the parent reads `.value` fine.)
- **`WINDOW_SYSTEM`** gains: *"If the message lists current field values, treat them as exactly what the user typed. For a web browser app, render a browser with an address bar; when the user navigates, render a plausible, fully hallucinated web page for the typed URL while keeping the browser chrome and address bar."*
- **Route test:** update the patch `toHaveBeenCalledWith` to include `inputs: {}` (the helper omits it → `{}`).

### C. Taskbar clock + system tray (extends Task 6)
- **New `components/Clock.tsx`** (client): shows time + date, updating each second via `useEffect`+`setInterval` (cleared on unmount), reading `new Date()` inside the effect. Test: renders an element with role/text matching `:` (a time). Keep the test resilient (assert it renders without throwing and contains a digit).
- **`Taskbar`** gains a right-aligned tray: decorative status glyphs `🔊 📶 🔋` + `<Clock/>`; start/search/window buttons stay left. Use `justify-between` or a spacer so the tray sits at the right.

### D. Desktop icons (extends Task 7)
- **New `components/DesktopIcons.tsx`** (client): a top-left vertical column of 5 built-ins (Settings, Files, Web Browser, Notepad, Music) as icon+label buttons; clicking calls `onOpen(card)`. Test: renders the 5 labels; clicking "Files" calls `onOpen` with the files card.
- **`page.tsx`** renders `<DesktopIcons onOpen={openApp} />` as the first child of `<main>` (behind the windows).

### E. Acceptance additions
8. Loading windows say **"Hallucinating …"**; the taskbar shows a **live clock + date**; **desktop icons** open apps.
9. Opening **Web Browser**, typing a URL in its address bar, and navigating renders a **hallucinated page** for that URL, and navigating again updates it.

### F. Non-persistent apps (session cleanup on close)
Apps are already ephemeral (in-memory `Map`, no DB/disk). Make it strict — closing a window deletes its server session.
- **New `app/api/window/close/route.ts`**: `POST {windowId}` → `deleteSession(windowId)` → `204`. (Imports `deleteSession` from `@/lib/sessions`; ignores unknown ids.)
- **`page.tsx` `close(id)`**: if `id` looks like a real window id (not `tmp-`), `fetch("/api/window/close", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ windowId: id }), keepalive: true }).catch(() => {})` before removing it from state.
- Nothing is written to disk anywhere; sessions vanish on close and on server restart.

### G. Pure walled sandbox — no network from the app or the server
- **App (iframe):** wrap the model's body fragment in a minimal document with a strict CSP so it can make **zero** network requests (no LAN, no external) — only inline styles and `data:` images render. New `lib/sandbox-doc.ts`:
  ```ts
  export function wrapSandboxed(bodyHtml: string): string {
    return (
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" ' +
      "content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">" +
      "</head><body>" + bodyHtml + "</body></html>"
    );
  }
  ```
  `WindowFrame` uses `srcDoc={wrapSandboxed(win.html)}`. Combined with the existing **no `allow-scripts`**, this blocks scripts, `connect-src`, `img`/`font`/`frame` to any origin, and `form-action` — a pure walled sandbox. `applyOps`/coordinate math are unaffected (parent DOM access still works under `allow-same-origin`).
  - Test `lib/sandbox-doc.test.ts`: output contains the CSP meta with `default-src 'none'` and the body html.
- **Server:** the server's only outbound network is the Anthropic API via the SDK. It must **never fetch a user-controlled URL** — the Web Browser's pages are hallucinated by Claude, not fetched. Do not add any `fetch`/HTTP request of user input anywhere. Add a one-line comment at the top of `app/api/window/patch/route.ts` asserting this invariant.
- **Deployment note (README):** for a hard guarantee, run the container with egress restricted to `api.anthropic.com`; the app needs no other network access.

### Acceptance additions
10. An open app makes **no** network requests (DevTools Network shows nothing from the iframe); closing a window **deletes** its server session.
