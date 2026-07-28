# Window Shell (client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VibeDesktop window shell actually usable — windows raise on click, drag without freezing, never cover the taskbar, minimize without losing their DOM, accept the keyboard, forward the typed Spotlight query, surface failed patches and per-call latency — with real jsdom coverage of the iframe patch loop.

**Architecture:** All work is client-side React in `app/page.tsx` and `components/`. The desktop keeps its single `windows: WinState[]` array in `page.tsx`; `WindowFrame` owns one iframe and the click→`/api/window/patch`→`applyOps` loop. Two structural changes drive most of the fixes: (1) the once-attached iframe listeners call `sendPatch` through a ref so they always see the current props, and (2) `sendPatch` takes an options object so click, right-click, Enter-submit and free-text instruction all share one code path. Everything else is layering (`z-index`), lifecycle (`display:none` instead of unmount) and reporting (error banner, usage chip).

**Tech Stack:** Next.js 16 app router, React 19, TypeScript, Tailwind v4, Vitest 4 + jsdom 29 + @testing-library/react 16.

## Global Constraints

- Tests are COLOCATED next to source: `components/Foo.tsx` → `components/Foo.test.tsx`, `app/page.tsx` → `app/page.test.tsx`. Never create a `tests/` directory.
- Run one file with `npx vitest run components/WindowFrame.test.tsx`. Whole suite: `npm test`. Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- Style: 2-space indent, double quotes, semicolons, named exports, no default exports in `lib/`. Terse comments only where the reasoning is non-obvious. Match the surrounding code.
- **This plan owns `app/page.tsx` and everything in `components/` (plus their colocated `.test.tsx` files) and NOTHING else.** Do not edit `lib/**` or `app/api/**` — four sibling plans own those. If `npx tsc --noEmit` or `npm test` reports failures only in `lib/**` or `app/api/**`, that is a sibling plan's in-flight work; do not "fix" it, and judge your own task by your own test files.
- **Do NOT run `git add` or `git commit` in any task.** The user's standing preference is one commit at the very end of all five plans, after full verification. Every task ends with **Verify**.
- Frozen HTTP contract this plan consumes (implemented by the routes plan):
  - `POST /api/window/open` req `{ appName, blurb?, query? }` → 200 `{ windowId, html, usage }`
  - `POST /api/window/patch` req `{ windowId, elementId, x, y, action?, inputs?, domSnapshot?, instruction? }` → 200 `{ ops, stopReason, usage }`
  - `POST /api/search` req `{ query }` → 200 `{ cards }`
  - `POST /api/window/close` req `{ windowId }` → 200 `{ ok: true }`
  - Errors: 400 (bad field or non-JSON content-type) / **403 (cross-site)** / 404 `{error:"unknown window"}` / 413 (body over 256KB) / 429 (rate limit) / 502 / 503 / 504.
    Only 404 is special-cased in the UI (Task 9's `BANNER_LOST`); every other failure status — 403 included — falls through to `BANNER_UNAVAILABLE`, so no extra client branch is needed.
- Frozen type this plan consumes (defined by the lib plan in `lib/types.ts`):
  ```ts
  export interface CallUsage { ms: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  ```
  Only Task 13 imports it. Do not define it yourself.
- Frozen signatures this plan consumes unchanged: `applyOps(doc, ops): { applied, dropped }`, `sanitizeHtml(html): string`, `wrapSandboxed(bodyHtml): string`, `clampToViewport(...)`, `resizeWindow(...)`.
- Baseline before this plan: 17 test files / 56 tests passing (`components/*` and `app/api/routes.test.ts` all green).

### Cross-plan dependencies (read before starting)

**This plan is a consumer. It defines no shared interface and blocks nobody.**

- **Depends on Plan 1 (Model Path) for exactly one symbol:** `CallUsage` in `lib/types.ts`, used by Task 13 only. Task 13 Step 1 greps for it and stops if it is absent — **do not create it here**, `lib/` belongs to Plan 1. Tasks 1–12 have no dependency on Plan 1 at all.
- **Depends on Plan 4 (API Routes) for the response shapes above** (`usage` on the open and patch responses, `action: "submit"` and `instruction` accepted by the patch route, `{ ok: true }` from close). Every test in this plan stubs `fetch`, so all 13 tasks are runnable and green before Plan 4 lands; the dependency only bites in the browser.
- **Depends on Plan 2 (DOM Patch Layer) for behavior, not for signatures:** `applyOps`, `sanitizeHtml` and `wrapSandboxed` keep their exact current signatures. Task 12's `sanitizeHtml(win.html)` is a new call site of an unchanged function.
- **F1 is split with Plan 2, deliberately.** This plan owns `e.preventDefault()` in the capture-phase click listener and sanitizing the *initial* HTML (Task 12). Plan 2 owns the CSP directives and the `setAttr` URL allowlist. If this plan drops Task 12, F1 is not fixed no matter what Plan 2 does.
- **Nothing here depends on Plan 5 (ops/docs).** Plan 5's README describes this plan's user-facing behavior (Enter, ✨ bar, Ctrl+K, minimize, telemetry chip); if a label or shortcut changes here, tell Plan 5.

### jsdom facts this plan depends on (verified in this repo, not assumed)

1. `srcDoc` is **not parsed** by jsdom — `iframe.contentDocument.body` is empty after load. Tests must write the frame body themselves: `doc.body.innerHTML = '<button id="go">Go</button>'`.
2. The iframe `load` event fires on a **macrotask** after render, exactly once. `await act(async () => { await new Promise((r) => setTimeout(r, 0)); })` is enough. **Never call `fireEvent.load(iframe)`** — the natural load also fires and you get the listeners attached twice.
3. `iframe.contentDocument` is non-null immediately after render, before load (an `about:blank` document with a `<body>`).
4. `doc.documentElement.getBoundingClientRect()` returns width/height `0` in jsdom — stub it when asserting coordinate math.
5. jsdom has `PointerEvent` but **no** `Element.prototype.setPointerCapture` / `releasePointerCapture`. Production code must feature-detect; tests assign a stub onto `Element.prototype` and restore it afterwards.
6. Events dispatched inside the frame must be constructed from the frame's own view: `new (doc.defaultView as Window & typeof globalThis).MouseEvent(...)`.
7. Two typing traps, both confirmed with `npx tsc --noEmit` on this tree:
   - `ElementEventMap` has no pointer events. Binding `pointermove` to `e.currentTarget` only compiles if the handler is typed `React.PointerEvent<HTMLElement>` (whose `currentTarget` is an `HTMLElement`, so `HTMLElementEventMap` applies). Plain `React.PointerEvent` fails with `TS2769: Argument of type '(ev: PointerEvent) => void' is not assignable to parameter of type 'EventListener'`.
   - Declare fetch spies as `let fetchMock: ReturnType<typeof vi.fn>;` and assign in `beforeEach`. That keeps `mock.calls` at `any[][]`, so `fetchMock.mock.calls.at(-1)![1]` compiles; a directly-inferred `vi.fn(async (url: string) => …)` gives a 1-tuple and index `[1]` is a type error.

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `components/WindowFrame.tsx` | Modify | One window: chrome, drag/resize, iframe, the click/Enter/instruction → patch loop, error banner, usage chip. Owns `WinState`. |
| `components/WindowFrame.test.tsx` | Modify | Chrome tests + the loaded-iframe harness (patch POST body, resync, banner, Enter, instruction, sanitize, drag). |
| `components/Taskbar.tsx` | Modify | Bottom bar; window buttons become minimize/restore toggles; sits above windows. |
| `components/Taskbar.test.tsx` | **Create** | Layering, button list, toggle semantics. |
| `components/Spotlight.tsx` | Modify | Search overlay; passes the raw typed query up with the chosen card; sits above windows. |
| `components/Spotlight.test.tsx` | Modify | Asserts `onOpen(card, query)` and layering. |
| `components/StartMenu.tsx` | Modify | Layering only (`z-40` → `z-[1000]`). |
| `components/StartMenu.test.tsx` | Modify | Adds the layering assertion. |
| `components/DesktopContextMenu.tsx` | Modify | Layering only (`z-50` → `z-[1100]`). |
| `components/DesktopContextMenu.test.tsx` | Modify | Adds the layering assertion. |
| `components/DesktopIcons.tsx` | Modify | Single-click (keyboard/touch reachable) open. |
| `components/DesktopIcons.test.tsx` | Modify | Single-click open. |
| `app/page.tsx` | Modify | Desktop state: window list, z-order, minimize, document keyboard shortcuts, `openApp(card, query?)` detail passthrough. |
| `app/page.test.tsx` | **Create** | Desktop-level tests: open POST body, z ordering, minimize round-trip, keyboard shortcuts. |
| `components/Clock.tsx`, `components/Clock.test.tsx` | Untouched | — |

---

## Task 1: Layering — windows can never cover the shell (B3)

Today `zIndex: win.z` is the raw monotonic counter, so window #41 paints over `Taskbar z-40` and window #51 over `Spotlight z-50`, with no reset short of a reload.

**Files:**
- Modify: `components/WindowFrame.tsx:133` (root `style`), `components/Taskbar.tsx:14`, `components/StartMenu.tsx:7`, `components/Spotlight.tsx:36`, `components/DesktopContextMenu.tsx:9`
- Test: `components/WindowFrame.test.tsx`, `components/Taskbar.test.tsx` (create), `components/StartMenu.test.tsx`, `components/Spotlight.test.tsx`, `components/DesktopContextMenu.test.tsx`

**Interfaces:**
- Consumes: `WinState` from `components/WindowFrame.tsx` (unchanged shape).
- Produces: window roots carry `data-window-id={win.id}` and `zIndex = Math.min(10 + win.z, 900)`; `Taskbar` root carries `data-testid="taskbar"`; shell overlays sit at `z-[1000]` (Taskbar, StartMenu) and `z-[1100]` (Spotlight, DesktopContextMenu). Later tasks select window roots with `document.querySelector('[data-window-id="…"]')` and the taskbar with `screen.getByTestId("taskbar")`.

- [ ] **Step 1: Write the failing WindowFrame layering test**

Append inside the existing `describe("WindowFrame", …)` block in `components/WindowFrame.test.tsx` (after the maximize test at line 32):

```tsx
  it("offsets and clamps the window z-index so it can never cover the shell", () => {
    const { rerender } = render(<WindowFrame win={{ ...base, z: 1 }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} />);
    const root = document.querySelector('[data-window-id="w1"]') as HTMLElement;
    expect(root.style.zIndex).toBe("11");
    rerender(<WindowFrame win={{ ...base, z: 5000 }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} />);
    expect(root.style.zIndex).toBe("900");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `document.querySelector('[data-window-id="w1"]')` is `null`, so the test throws `TypeError: Cannot read properties of null (reading 'style')`.

- [ ] **Step 3: Make the window root identifiable and clamped**

In `components/WindowFrame.tsx`, add the ceiling constant next to `TASKBAR_H` (line 23):

```tsx
const TASKBAR_H = 64;
// Windows live in a band strictly below the shell (taskbar/menus at 1000+).
const MAX_WINDOW_Z = 900;
```

Replace the root `<div>` opening tag at lines 130-134:

```tsx
    <div
      ref={rootRef}
      data-window-id={win.id}
      onPointerDown={() => onFocus(win.id)}
      style={{ position: "absolute", left: win.x, top: win.y, zIndex: Math.min(10 + win.z, MAX_WINDOW_Z), width: win.w, height: win.h, overflow: "hidden" }}
      className="rounded-xl border border-white/60 ring-1 ring-black/10 shadow-2xl bg-white/80 backdrop-blur-xl flex flex-col"
    >
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing shell-layering tests**

Create `components/Taskbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Taskbar } from "./Taskbar";
import type { WinState } from "./WindowFrame";

const win = (over: Partial<WinState> = {}): WinState => ({
  id: "w1", title: "Calculator", icon: "🧮", html: "", w: 520, h: 380,
  loading: false, x: 0, y: 0, z: 1, minimized: false, maximized: false, ...over,
});

describe("Taskbar", () => {
  it("sits above every window", () => {
    render(<Taskbar windows={[]} onStart={vi.fn()} onSearch={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByTestId("taskbar").className).toContain("z-[1000]");
  });

  // Characterization: this one passes against today's Taskbar. It exists so the
  // rewrite in Task 3 cannot silently drop the per-window button. The red
  // assertion in this file is the layering one above.
  it("lists a button per window", () => {
    render(<Taskbar windows={[win()]} onStart={vi.fn()} onSearch={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Calculator/ })).toBeInTheDocument();
  });
});
```

Append to `components/StartMenu.test.tsx` inside its `describe`:

```tsx
  it("sits above every window", () => {
    const { container } = render(<StartMenu onOpen={vi.fn()} onClose={() => {}} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("z-[1000]");
  });
```

Append to `components/Spotlight.test.tsx` inside its `describe`:

```tsx
  it("sits above every window", () => {
    const { container } = render(<Spotlight onOpen={vi.fn()} onClose={() => {}} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("z-[1100]");
  });
```

Append to `components/DesktopContextMenu.test.tsx` inside its `describe`:

```tsx
  it("sits above every window", () => {
    const { container } = render(<DesktopContextMenu x={5} y={5} onNewApp={vi.fn()} onSettings={vi.fn()} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("z-[1100]");
  });
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run components/Taskbar.test.tsx components/StartMenu.test.tsx components/Spotlight.test.tsx components/DesktopContextMenu.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="taskbar"]` for the Taskbar file, and `expected 'fixed inset-0 z-40' to contain 'z-[1000]'` (and the `z-50` equivalents) for the other three.

- [ ] **Step 7: Raise the shell above the windows**

`components/Taskbar.tsx:14` — add the test id and swap `z-40` for `z-[1000]`:

```tsx
    <div data-testid="taskbar" className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 rounded-2xl px-3 py-2 bg-white/70 backdrop-blur-xl shadow-2xl border border-white/40 min-w-[20rem]">
```

`components/StartMenu.tsx:7`:

```tsx
    <div className="fixed inset-0 z-[1000]" onClick={onClose}>
```

`components/Spotlight.tsx:36`:

```tsx
    <div className="fixed inset-0 z-[1100] flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
```

`components/DesktopContextMenu.tsx:9`:

```tsx
      className="fixed z-[1100] min-w-[10rem] rounded-lg bg-white/95 backdrop-blur shadow-xl border border-slate-200 py-1 text-sm text-slate-700"
```

- [ ] **Step 8: Run them and watch them pass**

Run: `npx vitest run components/Taskbar.test.tsx components/StartMenu.test.tsx components/Spotlight.test.tsx components/DesktopContextMenu.test.tsx`
Expected: PASS (2 + 2 + 2 + 2 tests).

- [ ] **Step 9: Verify**

Run: `npx vitest run components/` then `npx tsc --noEmit`
Expected: all component test files pass; tsc reports no errors in `components/` or `app/page.tsx`.

---

## Task 2: Minimize keeps the window mounted (B4, first half)

`WinState.minimized` is written `false` at `page.tsx:30`, read at `WindowFrame.tsx:127` and never toggled. It must never `return null`: applied ops live only in the iframe DOM and are never written back to `win.html`, so unmounting silently reverts every patch the window has received.

**Files:**
- Modify: `components/WindowFrame.tsx:25-34` (props), `:127` (`return null`), `:129-147` (root + title bar)
- Modify: `app/page.tsx:17-21` (state area), `:74` (WindowFrame props)
- Test: `components/WindowFrame.test.tsx`, `app/page.test.tsx` (create)

**Interfaces:**
- Consumes: `data-window-id` on the window root (Task 1).
- Produces: `WindowFrame` gains a required prop `onToggleMinimize: (id: string) => void`; a title-bar button `aria-label="Minimize"`; minimized windows render with inline `display: none`. `page.tsx` gains `function toggleMinimize(id: string): void`. Later tasks pass `onToggleMinimize` in every `render(<WindowFrame …/>)` call.

- [ ] **Step 1: Rewrite the minimized-rendering test**

In `components/WindowFrame.test.tsx`, **replace** the existing test at lines 21-24 (`"renders nothing when minimized"`) with:

```tsx
  it("keeps a minimized window mounted but hidden (its DOM is the only copy of applied ops)", () => {
    render(<WindowFrame win={{ ...base, minimized: true }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
    const root = document.querySelector('[data-window-id="w1"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.display).toBe("none");
    expect(screen.getByTitle("Calculator")).toBeInTheDocument();
  });

  it("has a Minimize button wired to onToggleMinimize", () => {
    const onToggleMinimize = vi.fn();
    render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={onToggleMinimize} />);
    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(onToggleMinimize).toHaveBeenCalledWith("w1");
  });
```

Then add `onToggleMinimize={() => {}}` to the other three `render(<WindowFrame …/>)` calls in this file (lines 10, 17, 28) and to the Task 1 layering test's two calls.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `expected null not to be null` in the first new test (`document.querySelector('[data-window-id="w1"]')` is `null` because the component still does `if (win.minimized) return null`), and `Unable to find a label with the text of: Minimize` in the second.

- [ ] **Step 3: Implement minimize in WindowFrame**

`components/WindowFrame.tsx` — add the prop to the destructuring and the type (lines 25-34):

```tsx
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
```

Delete line 127 entirely:

```tsx
  if (win.minimized) return null;
```

Add `display` to the root style (the `style` line from Task 1):

```tsx
      style={{ position: "absolute", left: win.x, top: win.y, zIndex: Math.min(10 + win.z, MAX_WINDOW_Z), width: win.w, height: win.h, overflow: "hidden", display: win.minimized ? "none" : undefined }}
```

Add the amber dot as the first button in the title-bar button group (before the green Maximize button at line 139):

```tsx
          <button
            aria-label="Minimize"
            title="Minimize"
            onClick={() => onToggleMinimize(win.id)}
            className="w-3.5 h-3.5 rounded-full bg-amber-400 hover:bg-amber-500"
          />
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing desktop-level minimize test**

Create `app/page.test.tsx` (this harness is reused by Tasks 3-6 and 13):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import Desktop from "./page";

let fetchMock: ReturnType<typeof vi.fn>;
let opened = 0;

beforeEach(() => {
  opened = 0;
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/search") {
      return { ok: true, status: 200, json: async () => ({ cards: [{ id: "s1", name: "Lumefold", icon: "🎛️", blurb: "folds waveforms into light" }] }) };
    }
    if (url === "/api/window/open") {
      opened += 1;
      const n = opened;
      return { ok: true, status: 200, json: async () => ({ windowId: `w-${n}`, html: `<div id="a">A${n}</div>`, usage: { ms: 1700, inputTokens: 10, outputTokens: 20, cacheReadTokens: 4100 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Open a Start-menu builtin and wait for its window to finish loading.
 *  Use names that are NOT on the desktop (Calculator, Terminal, Paint, Mail) —
 *  DesktopIcons renders Settings/Files/Web Browser/Notepad/Music too. */
async function openFromStart(name: string) {
  fireEvent.click(screen.getByLabelText("Start"));
  fireEvent.click(await screen.findByText(name));
  await screen.findByTitle(name);
}

const winRoot = (id: string) => document.querySelector(`[data-window-id="${id}"]`) as HTMLElement;
const taskbar = () => screen.getByTestId("taskbar");
const openBodies = () =>
  fetchMock.mock.calls.filter((c) => c[0] === "/api/window/open").map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe("Desktop", () => {
  it("minimizes a window without unmounting it, and restores it", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    expect(winRoot("w-1").style.display).toBe("");

    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(winRoot("w-1")).not.toBeNull();
    expect(winRoot("w-1").style.display).toBe("none");

    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(winRoot("w-1").style.display).toBe("");
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `TypeError: onToggleMinimize is not a function`. The button exists (Step 3) but `page.tsx` does not pass the prop yet. (Vitest strips types without checking them, so the missing prop shows up at runtime, not as a TS error; `npx tsc --noEmit` reports it too.)

- [ ] **Step 7: Wire minimize into the desktop**

`app/page.tsx` — add the toggler next to `focus` (after line 54):

```tsx
  function toggleMinimize(id: string) { setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w))); }
```

Pass it to every window (line 74):

```tsx
      {windows.map((w) => (<WindowFrame key={w.id} win={w} onClose={close} onFocus={focus} onMove={move} onResize={resize} onToggleMax={toggleMax} onToggleMinimize={toggleMinimize} />))}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 9: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 3: The taskbar button becomes a minimize/restore toggle (B4, second half)

**Files:**
- Modify: `components/Taskbar.tsx:5-12` (props), `:19-23` (window buttons)
- Modify: `app/page.tsx` (add `taskbarActivate`, pass it to `Taskbar` at line 84)
- Test: `components/Taskbar.test.tsx`, `app/page.test.tsx`

**Interfaces:**
- Consumes: `WinState` (with `minimized`, `z`), `toggleMinimize` from Task 2.
- Produces: `Taskbar` prop `onFocus` is **renamed** to `onActivate: (id: string) => void`; each window button gets `aria-pressed={!w.minimized}`. `page.tsx` gains `function taskbarActivate(id: string): void` — restore+raise if minimized, minimize if already topmost, otherwise raise.

- [ ] **Step 1: Write the failing Taskbar tests**

Replace the second test in `components/Taskbar.test.tsx` ("lists a button per window") with:

```tsx
  it("marks a visible window pressed and a minimized window not pressed", () => {
    const { rerender } = render(<Taskbar windows={[win()]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Calculator/ })).toHaveAttribute("aria-pressed", "true");
    rerender(<Taskbar windows={[win({ minimized: true })]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Calculator/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onActivate with the window id", () => {
    const onActivate = vi.fn();
    render(<Taskbar windows={[win()]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button", { name: /Calculator/ }));
    expect(onActivate).toHaveBeenCalledWith("w1");
  });
```

Update the imports at the top of the file to include `fireEvent`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
```

Also update the first test ("sits above every window") to use the new prop name:

```tsx
    render(<Taskbar windows={[]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={vi.fn()} />);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/Taskbar.test.tsx`
Expected: FAIL — `expected element to have attribute "aria-pressed"` (the button renders, but nothing sets the attribute). `npx tsc --noEmit` additionally reports `Property 'onFocus' is missing` on the new `<Taskbar …/>` calls.

- [ ] **Step 3: Implement the toggle button**

`components/Taskbar.tsx` — rename the prop (lines 5-12):

```tsx
export function Taskbar({
  windows, onStart, onSearch, onActivate,
}: {
  windows: WinState[];
  onStart: () => void;
  onSearch: () => void;
  onActivate: (id: string) => void;
}) {
```

Replace the window-button map (lines 19-23):

```tsx
        {windows.map((w) => (
          <button
            key={w.id}
            onClick={() => onActivate(w.id)}
            aria-pressed={!w.minimized}
            className={`px-3 h-9 rounded-xl text-sm max-w-[10rem] truncate ${w.minimized ? "bg-white/40 text-slate-500" : "bg-white/80 text-slate-700"}`}
          >
            {w.icon ? w.icon + " " : ""}{w.title}
          </button>
        ))}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/Taskbar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing desktop toggle test**

Append to the `describe("Desktop", …)` block in `app/page.test.tsx`:

```tsx
  it("minimizes the top window from the taskbar and restores it", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    const button = within(taskbar()).getByRole("button", { name: /Calculator/ });

    fireEvent.click(button);
    expect(winRoot("w-1").style.display).toBe("none");

    fireEvent.click(within(taskbar()).getByRole("button", { name: /Calculator/ }));
    expect(winRoot("w-1").style.display).toBe("");
  });

  it("raises a buried window from the taskbar instead of minimizing it", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));

    fireEvent.click(within(taskbar()).getByRole("button", { name: /Calculator/ }));
    expect(winRoot("w-1").style.display).toBe("");
    expect(Number(winRoot("w-1").style.zIndex)).toBeGreaterThan(Number(winRoot("w-2").style.zIndex));
  });
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `TypeError: onActivate is not a function` (page.tsx still passes `onFocus`). `npx tsc --noEmit` reports `Property 'onActivate' is missing` at `app/page.tsx:84`.

- [ ] **Step 7: Implement `taskbarActivate`**

`app/page.tsx` — add after `toggleMinimize`:

```tsx
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
```

Pass it to the Taskbar (line 84):

```tsx
      <Taskbar windows={windows} onStart={() => setStartOpen((s) => !s)} onSearch={() => setSpotlight(true)} onActivate={taskbarActivate} />
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 4: Raise-on-click, functional (B1, desktop half)

`focus()` at `app/page.tsx:54` is `const z = seq + 1; setSeq(z); setWindows(…)` — it reads `seq` out of whatever render's closure called it. Two consequences:

1. The iframe click listener is attached exactly once (`WindowFrame.tsx:83`), so it holds the first render's `focus` forever: every content click computes the same constant `z`. (Task 8 fixes the listener side of this with a ref; this task fixes the setter side.)
2. **Any two `focus` calls that land in the same React batch read the same `seq` and hand out the same `z`.** Verified on this tree: with two windows open (`seq === 2`) and both root `pointerdown`s dispatched inside one `act()`, both windows end up with `win.z === 3` — a genuine duplicate, so the second window does not raise above the first. With the functional form they get `3` and `4`.

**Files:**
- Modify: `app/page.tsx:54`
- Test: `app/page.test.tsx`

**Interfaces:**
- Consumes: `windows`/`seq` state in `page.tsx`.
- Produces: `focus(id)` unchanged in signature `(id: string) => void`, now safe to call from a stale closure and from a batched pair of calls.

- [ ] **Step 1: Write the failing z-ordering tests**

Add `act` to the `@testing-library/react` import at the top of `app/page.test.tsx`:

```tsx
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
```

Append to the `describe("Desktop", …)` block in `app/page.test.tsx`. The first test is the red one — the two after it are the regression net:

```tsx
  it("gives each window a distinct z when two are raised in the same batch", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");

    // fireEvent wraps each dispatch in its own act(); nesting them inside one
    // outer act() queues both updates and flushes them together, which is what
    // happens in the app when two focus() calls share a batch. A non-functional
    // `const z = seq + 1` reads the same stale `seq` twice and hands out one z
    // to both windows.
    await act(async () => {
      fireEvent.pointerDown(winRoot("w-1"));
      fireEvent.pointerDown(winRoot("w-2"));
    });
    expect(winRoot("w-1").style.zIndex).not.toBe(winRoot("w-2").style.zIndex);
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));
  });

  it("raises whichever window was focused last, repeatedly", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");

    fireEvent.pointerDown(winRoot("w-1"));
    expect(Number(winRoot("w-1").style.zIndex)).toBeGreaterThan(Number(winRoot("w-2").style.zIndex));

    fireEvent.pointerDown(winRoot("w-2"));
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));

    fireEvent.pointerDown(winRoot("w-1"));
    expect(Number(winRoot("w-1").style.zIndex)).toBeGreaterThan(Number(winRoot("w-2").style.zIndex));
  });

  it("never lets a raised window reach the shell's layer", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    for (let i = 0; i < 30; i++) fireEvent.pointerDown(winRoot("w-1"));
    expect(Number(winRoot("w-1").style.zIndex)).toBeLessThanOrEqual(900);
  });
```

- [ ] **Step 2: Run them and watch the first one fail**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `expected '13' not to be '13'` from the batched test (verified against this tree: both windows land on `z: 3`, i.e. `zIndex` `13`, and the second assertion then fails too).
The other two tests PASS against the current code, and are meant to: `fireEvent` outside an `act()` flushes each discrete event on its own, so a sequential raise already works. They are the regression net for Step 3 — do not skip them.

- [ ] **Step 3: Make `focus` immune to a stale closure and to batching**

Replace `app/page.tsx:54`:

```tsx
  // Functional so it is correct when called from the iframe's once-attached
  // click listener (which holds a closure from the render that loaded the
  // frame) and when two focus() calls share one React batch.
  function focus(id: string) {
    setSeq((s) => {
      const z = s + 1;
      setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z } : w)));
      return z;
    });
  }
```

(The nested `setWindows` inside the `setSeq` updater is deliberate and is the frozen shape for this fix. It is idempotent, so React's dev-mode double-invocation of updaters — StrictMode — produces the same result; verified.)

- [ ] **Step 4: Run them and watch them all pass**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify**

Run: `npx vitest run app/page.test.tsx components/` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 5: Keyboard and touch reach the shell (B4, third half)

`grep -rn "keydown\|onKeyDown" app components` returns nothing today. Desktop icons are `onDoubleClick`-only, so Enter/Space do nothing and double-tap is a zoom gesture on touch.

**Files:**
- Modify: `app/page.tsx:1-2` (imports), `:17-21` (add the effect below the state)
- Modify: `components/DesktopIcons.tsx:10`
- Test: `app/page.test.tsx`, `components/DesktopIcons.test.tsx`

**Interfaces:**
- Consumes: `spotlight`, `startOpen`, `ctxMenu` state in `page.tsx`.
- Produces: a document-level `keydown` effect (Escape closes context menu / Spotlight / Start menu; Ctrl-or-Cmd+K toggles Spotlight); `DesktopIcons` opens on a single `click`, so a native `<button>` gets Enter/Space and touch for free.

- [ ] **Step 1: Write the failing DesktopIcons test**

Replace the second test in `components/DesktopIcons.test.tsx` (lines 11-18) with:

```tsx
  it("opens on a single click, so Enter/Space and touch work too", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Files"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "files" }));
  });

  it("does not double-fire when the icon is double-clicked", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    fireEvent.doubleClick(screen.getByText("Files"));
    expect(onOpen).not.toHaveBeenCalled();
  });
```

(`fireEvent.doubleClick` dispatches only `dblclick`, never `click` — the second test proves no lingering `onDoubleClick` handler.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/DesktopIcons.test.tsx`
Expected: FAIL — `expected "spy" to be called 1 times, but got 0 times` (the component still only listens for `dblclick`).

- [ ] **Step 3: Make desktop icons single-click**

`components/DesktopIcons.tsx:10` — swap the handler and the tooltip:

```tsx
        <button key={a.id} onClick={() => onOpen(a)} aria-label={a.name} title={`Open ${a.name}`} className="flex flex-col items-center gap-1 w-20 p-2 rounded-lg hover:bg-white/15 focus:bg-white/20 text-white text-center select-none">
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/DesktopIcons.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing keyboard tests**

Append to the `describe("Desktop", …)` block in `app/page.test.tsx`:

```tsx
  it("toggles Spotlight with Ctrl+K and Cmd+K", () => {
    render(<Desktop />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByPlaceholderText(/type any app/i)).toBeNull();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();
  });

  it("closes Spotlight, the Start menu and the context menu with Escape", () => {
    render(<Desktop />);

    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/type any app/i)).toBeNull();

    fireEvent.click(screen.getByLabelText("Start"));
    expect(screen.getByText("Paint")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Paint")).toBeNull();

    fireEvent.contextMenu(document.querySelector("main") as HTMLElement);
    expect(screen.getByText("New app…")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("New app…")).toBeNull();
  });
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `Unable to find an element with the placeholder text of: /type any app/i` after Ctrl+K (no keydown handler exists).

- [ ] **Step 7: Add the document keyboard effect**

`app/page.tsx:2` — import `useEffect`:

```tsx
import { useEffect, useState } from "react";
```

Insert directly after the `seq` state declaration (line 21):

```tsx
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
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 9: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 6: The typed query and the blurb reach the window (WP-A, client half)

`Spotlight` renders `card.blurb` at line 60 and throws it away; `openApp` posts only `{ appName: card.name }`. Since `SEARCH_SYSTEM` forces coined, meaningless names, the window is briefed with one useless token.

**Files:**
- Modify: `components/Spotlight.tsx:5` (props), `:54` (`onOpen` call)
- Modify: `app/page.tsx:23` (signature), `:32` (POST body)
- Test: `components/Spotlight.test.tsx`, `app/page.test.tsx`

**Interfaces:**
- Consumes: `AppCard { id; name; icon; blurb }` from `@/lib/types`; `POST /api/window/open` req `{ appName, blurb?, query? }`.
- Produces: `Spotlight` prop becomes `onOpen: (card: AppCard, query: string) => void`; `page.tsx` exposes `openApp(card: AppCard, query?: string)` which posts `{ appName: card.name, blurb: card.blurb, query }`. `StartMenu`/`DesktopIcons`/the Settings context-menu entry keep calling `onOpen(card)` — they pass a blurb and no query.

- [ ] **Step 1: Write the failing Spotlight test**

Replace the body of the existing test in `components/Spotlight.test.tsx` (lines 13-21) with:

```tsx
  it("searches and opens a result card with the raw typed query", async () => {
    const onOpen = vi.fn();
    render(<Spotlight onOpen={onOpen} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/type any app/i), { target: { value: "a synth with 3 oscillators" } });
    fireEvent.submit(screen.getByPlaceholderText(/type any app/i));
    const card = await screen.findByText("Synthy");
    fireEvent.click(card);
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Synthy", blurb: "make noise" }),
        "a synth with 3 oscillators",
      ),
    );
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/Spotlight.test.tsx`
Expected: FAIL — `expected "spy" to be called with arguments: [ ObjectContaining…, 'a synth with 3 oscillators' ]`, received only the card.

- [ ] **Step 3: Pass the query up**

`components/Spotlight.tsx:5` — widen the prop type:

```tsx
export function Spotlight({ onOpen, onClose }: { onOpen: (card: AppCard, query: string) => void; onClose: () => void }) {
```

Line 54 — hand the raw typed text along with the card:

```tsx
                onClick={() => onOpen(c, query)}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/Spotlight.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing open-body tests**

Append to the `describe("Desktop", …)` block in `app/page.test.tsx`:

```tsx
  it("sends a builtin's blurb and no query", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    expect(openBodies()[0]).toEqual({ appName: "Calculator", blurb: "Crunch numbers" });
  });

  it("sends the searched card's blurb and the raw typed query", async () => {
    render(<Desktop />);
    fireEvent.click(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByPlaceholderText(/type any app/i), { target: { value: "a synth with 3 oscillators" } });
    fireEvent.submit(screen.getByPlaceholderText(/type any app/i));
    fireEvent.click(await screen.findByText("Lumefold"));
    await screen.findByTitle("Lumefold");
    expect(openBodies()[0]).toEqual({
      appName: "Lumefold",
      blurb: "folds waveforms into light",
      query: "a synth with 3 oscillators",
    });
  });
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `expected { appName: 'Calculator' } to deeply equal { appName: 'Calculator', blurb: 'Crunch numbers' }`.

- [ ] **Step 7: Thread the detail through `openApp`**

`app/page.tsx:23` — widen the signature:

```tsx
  async function openApp(card: AppCard, query?: string) {
```

Line 32 — send the detail (`JSON.stringify` drops `query` when it is `undefined`):

```tsx
      const r = await fetch("/api/window/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appName: card.name, blurb: card.blurb, query }) });
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 9: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 7: Drag and resize capture the pointer (B2)

`startResize`/`startDrag` (`WindowFrame.tsx:94-125`) bind `move`/`up` to `window` with no `setPointerCapture` and no `pointercancel`. With a mouse, the parent stops receiving events the moment the cursor crosses an iframe; release there and `up()` never fires, so the window follows the cursor until reload. The 1.5px `w`/`n` strips sit over the window's own iframe, so shrinking from the left/top edge stalls after ~2px.

**Files:**
- Modify: `components/WindowFrame.tsx:94-125` (both handlers), `:136` (title bar gets `data-testid`), `:169-176` (the eight resize handles get `data-testid`)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `clampToViewport`, `resizeWindow`, `ResizeDir` from `@/lib/geometry` (unchanged).
- Produces: the drag handle is `data-testid="titlebar"`; resize handles are `data-testid="resize-n" | "resize-s" | "resize-e" | "resize-w" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se"`. Pointer capture is feature-detected (`typeof el.setPointerCapture === "function"`) because jsdom has no implementation. **Both handlers must be typed `React.PointerEvent<HTMLElement>`** — with the current bare `React.PointerEvent`, `e.currentTarget` is an `Element`, and `Element.addEventListener("pointermove", …)` is a `TS2769` type error (pointer events live in `HTMLElementEventMap`, not `ElementEventMap`). This is why the original code could only bind to `window`.

- [ ] **Step 1: Write the failing pointer-capture tests**

Append to `components/WindowFrame.test.tsx` inside the `describe`:

```tsx
  describe("drag and resize", () => {
    const original = Element.prototype.setPointerCapture;
    let capture: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      capture = vi.fn();
      // jsdom implements neither pointer-capture method; install a spy so the
      // production feature-detect finds one and we can assert on it.
      Element.prototype.setPointerCapture = capture as unknown as Element["setPointerCapture"];
    });
    afterEach(() => { Element.prototype.setPointerCapture = original; });

    it("captures the pointer and drags from the title bar", () => {
      const onMove = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const bar = screen.getByTestId("titlebar");

      fireEvent.pointerDown(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      expect(capture).toHaveBeenCalledWith(7);

      fireEvent.pointerMove(bar, { pointerId: 7, clientX: 140, clientY: 130 });
      expect(onMove).toHaveBeenCalledWith("w1", 50, 40);
    });

    it("does not listen on window, and stops on pointerup", () => {
      const onMove = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const bar = screen.getByTestId("titlebar");

      fireEvent.pointerDown(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();

      fireEvent.pointerUp(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(bar, { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("ends the drag on pointercancel", () => {
      const onMove = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const bar = screen.getByTestId("titlebar");

      fireEvent.pointerDown(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(bar, { pointerId: 7 });
      fireEvent.pointerMove(bar, { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("does not start a drag from a title-bar button", () => {
      const onMove = vi.fn();
      const onClose = vi.fn();
      render(<WindowFrame win={base} onClose={onClose} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);

      fireEvent.pointerDown(screen.getByLabelText("Close"), { pointerId: 7, clientX: 100, clientY: 100 });
      expect(capture).not.toHaveBeenCalled();
      fireEvent.pointerMove(screen.getByLabelText("Close"), { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("captures the pointer and resizes from the south-east handle", () => {
      const onResize = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={onResize} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const handle = screen.getByTestId("resize-se");

      fireEvent.pointerDown(handle, { pointerId: 3, clientX: 200, clientY: 200 });
      expect(capture).toHaveBeenCalledWith(3);

      fireEvent.pointerMove(handle, { pointerId: 3, clientX: 260, clientY: 240 });
      expect(onResize).toHaveBeenCalledWith("w1", 10, 10, 580, 420);

      fireEvent.pointerUp(handle, { pointerId: 3 });
      onResize.mockClear();
      fireEvent.pointerMove(handle, { pointerId: 3, clientX: 400, clientY: 400 });
      expect(onResize).not.toHaveBeenCalled();
    });
  });
```

Update the imports at the top of `components/WindowFrame.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

(The `win` values follow `clampToViewport(50, 40, 0, 0, 1024, 768, 64)` and `resizeWindow("se", 60, 40, {x:10,y:10,w:520,h:380}, {vw:1024,vh:768})` — jsdom's viewport is 1024×768 and `offsetWidth`/`offsetHeight` are 0.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="titlebar"]`.

- [ ] **Step 3: Capture the pointer on the handle**

`components/WindowFrame.tsx` — add the helper just above `startResize` (line 94):

```tsx
// Pointer capture keeps move/up flowing to the handle even when the cursor
// crosses an iframe (which otherwise eats the events and strands the drag).
// jsdom implements neither method, hence the feature-detect.
function capturePointer(el: Element, pointerId: number) {
  if (typeof el.setPointerCapture === "function") el.setPointerCapture(pointerId);
}
```

Replace `startResize` and `startDrag` (lines 94-125) wholesale:

```tsx
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
```

Add `data-testid="titlebar"` to the drag surface (line 136):

```tsx
      <div data-testid="titlebar" onPointerDown={startDrag} onDoubleClick={() => onToggleMax(win.id)} className="cursor-move select-none flex items-center justify-between px-3 py-2 bg-white/60 border-b border-white/40">
```

Add a test id to each resize handle (lines 169-176):

```tsx
        <div data-testid="resize-n" onPointerDown={(e) => startResize(e, "n")} className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
        <div data-testid="resize-s" onPointerDown={(e) => startResize(e, "s")} className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize z-20" />
        <div data-testid="resize-e" onPointerDown={(e) => startResize(e, "e")} className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
        <div data-testid="resize-w" onPointerDown={(e) => startResize(e, "w")} className="absolute left-0 top-2 bottom-2 w-1.5 cursor-ew-resize z-20" />
        <div data-testid="resize-nw" onPointerDown={(e) => startResize(e, "nw")} className="absolute top-0 left-0 w-2.5 h-2.5 cursor-nwse-resize z-20" />
        <div data-testid="resize-ne" onPointerDown={(e) => startResize(e, "ne")} className="absolute top-0 right-0 w-2.5 h-2.5 cursor-nesw-resize z-20" />
        <div data-testid="resize-sw" onPointerDown={(e) => startResize(e, "sw")} className="absolute bottom-0 left-0 w-2.5 h-2.5 cursor-nesw-resize z-20" />
        <div data-testid="resize-se" onPointerDown={(e) => startResize(e, "se")} className="absolute bottom-0 right-0 w-2.5 h-2.5 cursor-nwse-resize z-20" />
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 8: The iframe patch loop — coverage, then a stale-closure fix (WP-I + B1, frame half)

`WindowFrame.test.tsx` has never mounted a loaded iframe, so the coordinate clamp, the `rect.width || 1` guard, the `inputs` harvest, the every-10th-click resync and the `needsResync` self-heal are all untested. Then the actual bug: `onLoad` (line 83) attaches the click listener exactly once, pinning `sendPatch` — and through it `win.id`, `onFocus` and `seq` — to the render that loaded the frame.

**Files:**
- Modify: `components/WindowFrame.tsx:2` (imports), `:41-78` (`sendPatch`), `:80-92` (`onLoad`)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `applyOps(doc, ops): { applied, dropped }` from `@/lib/apply-ops`; `POST /api/window/patch` → `{ ops, stopReason, usage }`.
- Produces: module-scope `type PatchAction = "click" | "contextmenu" | "submit"` and `interface PatchOpts { target?: Element | null; clientX?: number; clientY?: number; action?: PatchAction; instruction?: string }`; `sendPatch(doc: Document, opts: PatchOpts): Promise<void>`; `sendPatchRef` (a `useRef` refreshed by an effect on every render) which the once-attached listeners call. Tasks 9-13 extend `sendPatch` and call it through `sendPatchRef.current`.

- [ ] **Step 1: Add the loaded-iframe harness plus characterization tests**

Append to `components/WindowFrame.test.tsx`, after the existing `describe("drag and resize", …)` block but still inside `describe("WindowFrame", …)`:

```tsx
  describe("the patch loop", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ops: [], stopReason: "tool_use" }) }));
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    /** Render a window and wait for jsdom's iframe load (a macrotask) so the
     *  component's listeners are attached. Never fireEvent.load — the natural
     *  load also fires and you would get two listeners. jsdom does not parse
     *  srcDoc, so the frame body is written here. */
    async function mountLoaded(over: Partial<WinState> = {}) {
      const win = { ...base, ...over };
      const utils = render(<WindowFrame win={win} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const iframe = screen.getByTitle(win.title) as HTMLIFrameElement;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const doc = iframe.contentDocument as Document;
      doc.body.innerHTML = '<button id="go">Go</button><input id="q" value="hello" />';
      return { ...utils, iframe, doc };
    }

    function stubRect(doc: Document, width: number, height: number) {
      doc.documentElement.getBoundingClientRect = () =>
        ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;
    }

    function clickIn(doc: Document, id: string, clientX = 0, clientY = 0) {
      const view = doc.defaultView as Window & typeof globalThis;
      const evt = new view.MouseEvent("click", { bubbles: true, cancelable: true, clientX, clientY });
      act(() => { doc.getElementById(id)!.dispatchEvent(evt); });
      return evt;
    }

    const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    const settle = () => act(async () => { await Promise.resolve(); });

    it("posts clamped percent coordinates and the harvested field values", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      clickIn(doc, "go", 300, 25);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(fetchMock.mock.calls[0][0]).toBe("/api/window/patch");
      expect(lastBody()).toMatchObject({ windowId: "w1", elementId: "go", x: 100, y: 25, action: "click" });
      expect(lastBody().inputs).toEqual({ q: "hello" });
      expect(lastBody().domSnapshot).toBeUndefined();
      await settle();
    });

    it("never posts NaN when the frame has no layout", async () => {
      const { doc } = await mountLoaded();
      clickIn(doc, "go", 50, 50);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(lastBody()).toMatchObject({ x: 100, y: 100 });
      await settle();
    });

    it("sends a full DOM snapshot on every tenth click", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      for (let i = 1; i <= 10; i++) {
        clickIn(doc, "go", 10, 10);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i));
        await settle();
        if (i < 10) expect(lastBody().domSnapshot, `click ${i}`).toBeUndefined();
        else expect(lastBody().domSnapshot, "click 10").toContain('id="go"');
      }
    });

    it("self-heals: a dropped op makes the next click carry a snapshot", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "does-not-exist", value: "x" }], stopReason: "tool_use" }),
      }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();
      expect(lastBody().domSnapshot).toBeUndefined();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();
      expect(lastBody().domSnapshot).toContain('id="go"');
    });

    it("applies returned ops to the live frame document", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "go", value: "Done" }], stopReason: "tool_use" }),
      }));
      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(doc.getElementById("go")!.textContent).toBe("Done"));
      await settle();
    });
  });
```

Update the imports at the top of `components/WindowFrame.test.tsx`:

```tsx
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
```

- [ ] **Step 2: Run them and confirm they pass against the untouched component**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (16 tests). These five are characterization tests: they lock in behavior that already works so the refactor in Step 5 cannot break it silently. If any of them fails now, stop — an earlier task regressed the patch loop.

- [ ] **Step 3: Write the failing stale-closure test**

Append inside the same `describe("the patch loop", …)` block:

```tsx
    it("uses the CURRENT props from the once-attached listener", async () => {
      const onFocusFirst = vi.fn();
      const onFocusLater = vi.fn();
      const { rerender } = render(<WindowFrame win={base} onClose={() => {}} onFocus={onFocusFirst} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const iframe = screen.getByTitle("Calculator") as HTMLIFrameElement;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const doc = iframe.contentDocument as Document;
      doc.body.innerHTML = '<button id="go">Go</button>';

      // The desktop swaps the temporary id for the real windowId and re-renders.
      rerender(<WindowFrame win={{ ...base, id: "w2" }} onClose={() => {}} onFocus={onFocusLater} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(lastBody().windowId).toBe("w2");
      expect(onFocusLater).toHaveBeenCalledWith("w2");
      expect(onFocusFirst).not.toHaveBeenCalled();
      await settle();
    });
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `expected 'w1' to be 'w2'` (verified against this tree: the listener still holds the first render's `sendPatch`, and `onFocusFirst` is the one that gets called).

- [ ] **Step 5: Route the listeners through a ref, and give `sendPatch` an options object**

`components/WindowFrame.tsx:2` — add `useEffect`:

```tsx
import { useEffect, useRef, useState } from "react";
```

Add the option types at module scope, just below `const MAX_WINDOW_Z = 900;`:

```tsx
type PatchAction = "click" | "contextmenu" | "submit";

interface PatchOpts {
  target?: Element | null;
  clientX?: number;
  clientY?: number;
  action?: PatchAction;
  instruction?: string;
}
```

Replace `sendPatch` (lines 41-78) with:

```tsx
  async function sendPatch(doc: Document, opts: PatchOpts) {
    onFocus(win.id);
    const rect = doc.documentElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round(((opts.clientX ?? 0) / (rect.width || 1)) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((opts.clientY ?? 0) / (rect.height || 1)) * 100)));
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
          elementId: opts.target ? opts.target.id : null,
          x, y,
          action: opts.action,
          instruction: opts.instruction,
          domSnapshot: sendSnapshot ? doc.body.innerHTML : undefined,
          inputs,
        }),
      });
      const data = await r.json();
      const result = data.ops ? applyOps(doc, data.ops) : { applied: [], dropped: [] };
      needsResync.current = result.dropped.length > 0;
      // diagnostic: see exactly what each click did (open DevTools console)
      console.log(
        `[${win.title}] ${opts.action ?? "instruction"} id=${opts.target ? opts.target.id : "(none)"} → http:${r.status} ` +
          `ops:${data.ops?.length ?? 0} applied:${result.applied.length} dropped:${result.dropped.length} ` +
          `stop:${data.stopReason ?? "?"} cacheRead:${data.usage?.cacheReadTokens ?? 0}`,
      );
    } catch (err) {
      console.error("patch failed", err);
    } finally {
      setBusy(false);
    }
  }

  // The iframe listeners below are attached exactly once per load, so they must
  // never close over sendPatch directly — win.id alone changes tmp-N → the real
  // windowId one render after the frame loads.
  const sendPatchRef = useRef(sendPatch);
  useEffect(() => { sendPatchRef.current = sendPatch; });
```

Replace `onLoad` (lines 80-92) with:

```tsx
  function onLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (e) => {
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, clientX: e.clientX, clientY: e.clientY, action: "click" });
    }, true);
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, clientX: e.clientX, clientY: e.clientY, action: "contextmenu" });
    }, true);
  }
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (17 tests) — including all five characterization tests from Step 1.

- [ ] **Step 7: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 9: Failed patches are visible and keep the pending resync (C4)

`WindowFrame.tsx:64-66` never checks `r.ok`. On a 502, or a 404 from `UnknownWindowError` after a server restart, `data.ops` is undefined, the code falls through to `{applied:[],dropped:[]}` and then *clears* `needsResync`, discarding a queued full-DOM snapshot. The busy pill vanishes with nothing changed and no explanation.

**Files:**
- Modify: `components/WindowFrame.tsx` (`sendPatch` body from Task 8; render tree at `:156-165`)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `POST /api/window/patch` error statuses 404 / 502 / 503 / 504.
- Produces: a dismissible in-frame banner. Message constants at module scope: `BANNER_LOST = "Lost the thread — reopen this window"` (404) and `BANNER_UNAVAILABLE = "Model unavailable — click to retry"` (any other failure, including a thrown fetch). The banner element is `data-testid="patch-banner"` with a `aria-label="Dismiss"` button.

- [ ] **Step 1: Write the failing banner tests**

Append inside `describe("the patch loop", …)` in `components/WindowFrame.test.tsx`:

```tsx
    it("shows a lost-session banner on 404 and keeps the resync queued", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404, json: async () => ({ error: "unknown window" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Lost the thread — reopen this window"));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();
      expect(lastBody().domSnapshot).toContain('id="go"');
    });

    it("shows an unavailable banner on 502 and clears it on the next success", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 502, json: async () => ({ error: "patch failed" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Model unavailable — click to retry"));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.queryByTestId("patch-banner")).toBeNull());
      await settle();
    });

    it("shows the unavailable banner when the request itself throws", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => { throw new Error("offline"); });

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Model unavailable — click to retry"));
      await settle();
    });

    it("dismisses the banner", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({ error: "overloaded" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toBeInTheDocument());
      await settle();

      fireEvent.click(screen.getByLabelText("Dismiss"));
      expect(screen.queryByTestId("patch-banner")).toBeNull();
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="patch-banner"]`.

- [ ] **Step 3: Report the failure instead of swallowing it**

`components/WindowFrame.tsx` — add the message constants below `interface PatchOpts { … }`:

```tsx
const BANNER_LOST = "Lost the thread — reopen this window";
const BANNER_UNAVAILABLE = "Model unavailable — click to retry";
```

Add the state next to `const [busy, setBusy] = useState(false);` (line 39):

```tsx
  const [banner, setBanner] = useState<string | null>(null);
```

In `sendPatch`, clear the banner as the first statement of the function:

```tsx
  async function sendPatch(doc: Document, opts: PatchOpts) {
    setBanner(null);
    onFocus(win.id);
```

Then, inside the `try`, immediately after the `await fetch(...)` assignment and **before** `const data = await r.json();`:

```tsx
      if (!r.ok) {
        // A failed turn changes nothing server-side, so the queued snapshot
        // must survive — clearing it here is how a resync got lost.
        needsResync.current = true;
        setBanner(r.status === 404 ? BANNER_LOST : BANNER_UNAVAILABLE);
        console.error(`[${win.title}] patch http:${r.status}`);
        return;
      }
```

And in the `catch`:

```tsx
    } catch (err) {
      needsResync.current = true;
      setBanner(BANNER_UNAVAILABLE);
      console.error("patch failed", err);
    } finally {
```

Render the banner inside the frame container, between the `<iframe …/>` (line 157) and the `{busy && …}` block:

```tsx
          {banner && (
            <div data-testid="patch-banner" className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 py-2 bg-amber-100/95 text-amber-900 text-xs shadow">
              <span>{banner}</span>
              <button aria-label="Dismiss" onClick={() => setBanner(null)} className="px-2 rounded hover:bg-amber-200">✕</button>
            </div>
          )}
```

(z-20 puts it above the `z-10` busy overlay, so the dismiss button stays clickable.)

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (21 tests).

- [ ] **Step 5: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 10: Enter submits (D1)

`onLoad` binds only `click` and `contextmenu`; there is no keydown handler anywhere in the repo, and without `allow-scripts`/`allow-forms` nothing inside the iframe can rescue it. This blocks the README's flagship demo — type a URL into the hallucinated browser and press Enter.

**Files:**
- Modify: `components/WindowFrame.tsx` (`onLoad` from Task 8)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `PatchOpts` / `sendPatchRef` (Task 8); `POST /api/window/patch` field `action: "submit"`.
- Produces: a capturing `keydown` listener on the frame document. Only Enter without Shift fires — one round trip per keystroke would be unusable, and the field values already ride along in `inputs`.

- [ ] **Step 1: Write the failing Enter tests**

Append inside `describe("the patch loop", …)` in `components/WindowFrame.test.tsx`:

```tsx
    function keyIn(doc: Document, id: string, init: KeyboardEventInit) {
      const view = doc.defaultView as Window & typeof globalThis;
      const evt = new view.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      act(() => { doc.getElementById(id)!.dispatchEvent(evt); });
      return evt;
    }

    it("submits on Enter with the focused field's id and its value", async () => {
      const { doc } = await mountLoaded();
      const evt = keyIn(doc, "q", { key: "Enter" });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(lastBody()).toMatchObject({ windowId: "w1", elementId: "q", action: "submit", x: 0, y: 0 });
      expect(lastBody().inputs).toEqual({ q: "hello" });
      expect(evt.defaultPrevented).toBe(true);
      await settle();
    });

    it("ignores Shift+Enter and every other key", async () => {
      const { doc } = await mountLoaded();
      keyIn(doc, "q", { key: "Enter", shiftKey: true });
      keyIn(doc, "q", { key: "a" });
      keyIn(doc, "q", { key: "Escape" });
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `expected "spy" to be called 1 times, but got 0 times` (no keydown listener exists).

- [ ] **Step 3: Add the capturing keydown listener**

`components/WindowFrame.tsx` — append inside `onLoad`, after the `contextmenu` listener:

```tsx
    // Enter is the only key worth a round trip; every printable key would be one
    // model call per keystroke. Field values already ride along in `inputs`.
    doc.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, action: "submit" });
    }, true);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (23 tests).

- [ ] **Step 5: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 11: The instruction bar (D2)

A mouse click is the app's entire vocabulary — strictly less expressive than a real app, and the only possible recovery when a patch mangles the DOM (applied ops are never mirrored back into `win.html`, so there is no undo).

**Files:**
- Modify: `components/WindowFrame.tsx:136-147` (title bar, restructured into two rows)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `sendPatch(doc, opts)` (Task 8); `POST /api/window/patch` field `instruction?: string` — same session, same tool, same op pipeline.
- Produces: a title-bar toggle `aria-label="Ask this app"` revealing a form with an input `aria-label="Instruction"`. The drag surface keeps `data-testid="titlebar"` (Task 7) and stays a separate row so typing never starts a drag.

- [ ] **Step 1: Write the failing instruction-bar tests**

Append inside `describe("the patch loop", …)` in `components/WindowFrame.test.tsx`:

```tsx
    it("posts a free-text instruction from the title bar", async () => {
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      expect(screen.queryByLabelText("Instruction")).toBeNull();

      fireEvent.click(screen.getByLabelText("Ask this app"));
      const input = screen.getByLabelText("Instruction");
      fireEvent.change(input, { target: { value: "make the buttons bigger" } });
      fireEvent.submit(input);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0][0]).toBe("/api/window/patch");
      expect(lastBody()).toMatchObject({ windowId: "w1", elementId: null, x: 0, y: 0, instruction: "make the buttons bigger" });
      expect(lastBody().action).toBeUndefined();
      await settle();
    });

    it("closes the instruction bar after sending and ignores an empty one", async () => {
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);

      fireEvent.click(screen.getByLabelText("Ask this app"));
      fireEvent.submit(screen.getByLabelText("Instruction"));
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "undo that" } });
      fireEvent.submit(screen.getByLabelText("Instruction"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByLabelText("Instruction")).toBeNull();
      await settle();
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Ask this app`.

- [ ] **Step 3: Add the instruction channel**

`components/WindowFrame.tsx` — add state next to `banner` (Task 9):

```tsx
  const [askOpen, setAskOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
```

Add the submit handler just below `sendPatchRef`/its effect:

```tsx
  function submitInstruction(e: React.FormEvent) {
    e.preventDefault();
    const text = instruction.trim();
    const doc = frameRef.current?.contentDocument;
    if (!text || !doc) return;
    setInstruction("");
    setAskOpen(false);
    void sendPatch(doc, { instruction: text });
  }
```

Replace the whole title-bar block (lines 136-147 — the `data-testid="titlebar"` div and its children from Task 7, including the Minimize dot from Task 2) with two rows inside one container:

```tsx
      <div className="bg-white/60 border-b border-white/40">
        <div data-testid="titlebar" onPointerDown={startDrag} onDoubleClick={() => onToggleMax(win.id)} className="cursor-move select-none flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium text-slate-700 truncate">{win.icon ? win.icon + " " : ""}{win.title}</span>
          <div className="flex items-center gap-1.5">
            <button
              aria-label="Ask this app"
              title="Ask this app"
              onClick={() => setAskOpen((a) => !a)}
              className="px-1 text-xs leading-none text-slate-500 hover:text-slate-800"
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
              placeholder="Tell this app what to do…"
              className="w-full rounded-lg px-2 py-1 text-sm text-slate-800 bg-white/90 outline-none border border-white/60"
            />
          </form>
        )}
      </div>
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (25 tests).

- [ ] **Step 5: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 12: In-frame clicks never navigate, and the initial HTML is sanitized (F1)

No CSP directive governs a frame navigating *itself*, and the sandbox flag set (`allow-same-origin` only) permits it. `sanitizeHtml` allows `https?:` URLs and the capture-phase click listener never calls `preventDefault()`, so one click on a model-authored `<a href="http://attacker/?d=…">Continue</a>` issues a real outbound request carrying whatever the user typed. Separately, the **initial** HTML goes straight from `openWindow` into `srcDoc` without passing through `sanitizeHtml` at all.

**Files:**
- Modify: `components/WindowFrame.tsx:2` (imports), `onLoad` click listener (Task 8), `:157` (`srcDoc`)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `sanitizeHtml(html: string): string` from `@/lib/sanitize`; `wrapSandboxed(bodyHtml: string): string` from `@/lib/sandbox-doc` (both unchanged).
- Produces: every in-frame click is `preventDefault()`ed before the patch is sent; `srcDoc` is `wrapSandboxed(sanitizeHtml(win.html))`, memoized on `win.html`.
- `sanitizeHtml` uses `DOMParser`, which does not exist on the server. This is safe here and must stay safe: `windows` starts `[]`, so `WindowFrame` never renders during Next's prerender of `/`. Do not hoist this memo above the `windows.map(...)` guard, and keep `npm run build` in the final verification.

- [ ] **Step 1: Write the failing security tests**

Append inside `describe("the patch loop", …)` in `components/WindowFrame.test.tsx`:

```tsx
    it("cancels the in-frame default so a model-authored link cannot navigate", async () => {
      const { doc } = await mountLoaded();
      doc.body.innerHTML = '<a id="out" href="http://attacker.example/?d=x">Continue</a>';
      const evt = clickIn(doc, "out", 10, 10);
      expect(evt.defaultPrevented).toBe(true);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();
    });

    it("sanitizes the initial HTML before it reaches srcDoc", () => {
      render(
        <WindowFrame
          win={{ ...base, html: '<div id="d" onclick="steal()">hi</div><script>alert(1)</script>' }}
          onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}}
        />,
      );
      const srcdoc = (screen.getByTitle("Calculator") as HTMLIFrameElement).getAttribute("srcdoc") as string;
      expect(srcdoc).toContain('<div id="d">hi</div>');
      expect(srcdoc).not.toContain("alert(1)");
      expect(srcdoc).not.toContain("onclick");
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `expected false to be true` for `defaultPrevented`, and `expected '…<script>alert(1)</script>…' not to contain 'alert(1)'`.

- [ ] **Step 3: Cancel the default and sanitize the first render**

`components/WindowFrame.tsx:2` — add `useMemo`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

Add the sanitize import below the `wrapSandboxed` import (line 5):

```tsx
import { sanitizeHtml } from "@/lib/sanitize";
```

In `onLoad`, make `preventDefault()` the first statement of the click listener:

```tsx
    doc.addEventListener("click", (e) => {
      // The host turns every click into a patch, so no in-frame default is ever
      // wanted — an unprevented <a href> navigates the frame off-origin.
      e.preventDefault();
      const target = (e.target as Element | null)?.closest?.("[id]") ?? null;
      void sendPatchRef.current(doc, { target, clientX: e.clientX, clientY: e.clientY, action: "click" });
    }, true);
```

Add the memo just above the `return (` of the component (right after `submitInstruction`):

```tsx
  // The initial HTML is model-authored too — it must go through the same scrub
  // as every patched fragment before it becomes a document.
  const srcDoc = useMemo(() => wrapSandboxed(sanitizeHtml(win.html)), [win.html]);
```

Use it on the iframe (line 157):

```tsx
          <iframe ref={frameRef} title={win.title} onLoad={onLoad} sandbox="allow-same-origin" srcDoc={srcDoc} className="absolute inset-0 w-full h-full bg-white" />
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (27 tests).

- [ ] **Step 5: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit`
Expected: all pass; no tsc errors in `components/` or `app/page.tsx`.

---

## Task 13: Latency and cache telemetry in the chrome (H1)

Cost and latency are `console.log`ged at `WindowFrame.tsx:68-72` and never shown. The README sells prompt caching and the ~1.5-2s/click tradeoff that the UI never surfaces. Showing it turns the latency from a flaw into the point.

**Files:**
- Modify: `components/WindowFrame.tsx:2` (imports), `WinState`, title-bar row (Task 11), busy pill at `:158-164`
- Modify: `app/page.tsx:35` (store the open call's usage on the window)
- Test: `components/WindowFrame.test.tsx`

**Interfaces:**
- Consumes: `CallUsage { ms; inputTokens; outputTokens; cacheReadTokens }` from `@/lib/types` (frozen; defined by the lib plan); `usage` on both `POST /api/window/open` and `POST /api/window/patch` responses.
- Produces: `WinState` gains `usage?: CallUsage`; `WindowFrame` exports `formatUsage(u: CallUsage): string` (`"1.7s · 4.1k cached"`, or just `"1.7s"` when nothing was cached); the chip is `data-testid="usage-chip"` and the busy pill is `data-testid="busy-pill"`.
- **Deliberate deviation from the spec's example chip text.** The spec sketches the chip as `1.7s · 4.1k cached · ~$0.004`; `formatUsage` omits the price. `CallUsage` (frozen) carries token counts and no pricing, and no per-token rate is in the frozen contract — inventing one here would put a number in the UI that nothing verifies. The chip shows time + cached tokens only. Plan 5's README states the same two-part string; if a price is ever added, both must change together.

- [ ] **Step 1: Confirm the frozen type exists**

Run: `grep -n "interface CallUsage" /home/kasm-user/vibe-desktop/lib/types.ts`
Expected: one match. If there is no match the lib plan has not landed yet — **do not create it here** (`lib/` belongs to another plan). Stop and report; every other task in this plan is already done.

- [ ] **Step 2: Write the failing telemetry tests**

Append inside `describe("the patch loop", …)` in `components/WindowFrame.test.tsx`:

```tsx
    it("formats a usage chip from seconds and cache reads", () => {
      expect(formatUsage({ ms: 1700, inputTokens: 900, outputTokens: 300, cacheReadTokens: 4100 })).toBe("1.7s · 4.1k cached");
      expect(formatUsage({ ms: 940, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 })).toBe("0.9s");
      expect(formatUsage({ ms: 2000, inputTokens: 10, outputTokens: 5, cacheReadTokens: 512 })).toBe("2.0s · 512 cached");
    });

    it("shows the open call's usage, then replaces it with each patch's usage", async () => {
      const { doc } = await mountLoaded({ usage: { ms: 1700, inputTokens: 900, outputTokens: 300, cacheReadTokens: 4100 } });
      expect(screen.getByTestId("usage-chip")).toHaveTextContent("1.7s · 4.1k cached");

      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [], stopReason: "tool_use", usage: { ms: 900, inputTokens: 20, outputTokens: 40, cacheReadTokens: 0 } }),
      }));
      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("usage-chip")).toHaveTextContent("0.9s"));
      await settle();
    });

    it("ticks the elapsed seconds inside the busy pill", async () => {
      const { doc } = await mountLoaded();
      vi.useFakeTimers();
      try {
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        clickIn(doc, "go", 10, 10);
        expect(screen.getByTestId("busy-pill")).toHaveTextContent("0s");
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(screen.getByTestId("busy-pill")).toHaveTextContent("1s");
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(screen.getByTestId("busy-pill")).toHaveTextContent("3s");
      } finally {
        vi.useRealTimers();
      }
    });
```

Update the component import at the top of `components/WindowFrame.test.tsx`:

```tsx
import { WindowFrame, formatUsage, type WinState } from "./WindowFrame";
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — `TypeError: formatUsage is not a function` (the named export does not exist yet), then `Unable to find an element by: [data-testid="usage-chip"]`. `npx tsc --noEmit` additionally reports `'"./WindowFrame"' has no exported member 'formatUsage'` and `'usage' does not exist in type 'Partial<WinState>'`.

- [ ] **Step 4: Render the telemetry**

`components/WindowFrame.tsx:2` — the import line is now:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

Add the type import below the `sanitizeHtml` import:

```tsx
import type { CallUsage } from "@/lib/types";
```

Add the field to `WinState` (after `minimized: boolean;`, line 20):

```tsx
  minimized: boolean;
  /** Telemetry from the call that produced this window's current screen. */
  usage?: CallUsage;
```

Add the formatter at module scope, below `BANNER_UNAVAILABLE`:

```tsx
export function formatUsage(u: CallUsage): string {
  const secs = `${(u.ms / 1000).toFixed(1)}s`;
  if (!u.cacheReadTokens) return secs;
  const cached = u.cacheReadTokens >= 1000 ? `${(u.cacheReadTokens / 1000).toFixed(1)}k` : String(u.cacheReadTokens);
  return `${secs} · ${cached} cached`;
}
```

Add state next to `askOpen`/`instruction`:

```tsx
  const [patchUsage, setPatchUsage] = useState<CallUsage | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const usage = patchUsage ?? win.usage ?? null;

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);
```

In `sendPatch`, record the patch usage right after `needsResync.current = result.dropped.length > 0;`:

```tsx
      if (data.usage) setPatchUsage(data.usage as CallUsage);
```

Render the chip as the first child of the title-bar button group (immediately before the "Ask this app" button from Task 11):

```tsx
            {usage && (
              <span data-testid="usage-chip" className="mr-1 text-[10px] tabular-nums text-slate-400">{formatUsage(usage)}</span>
            )}
```

Replace the busy pill (lines 158-164 as they stand after Task 9) with:

```tsx
          {busy && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/40 backdrop-blur-[1px]">
              <div data-testid="busy-pill" className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 shadow-lg text-sm font-medium text-slate-700 animate-pulse">
                <span>✨</span> Hallucinating… {elapsed}s
              </div>
            </div>
          )}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (30 tests).

- [ ] **Step 6: Store the open call's usage on the window**

`app/page.tsx:35` — carry `data.usage` onto the window when the open call resolves:

```tsx
      setWindows((ws) => ws.map((w) => (w.id === tempId ? { ...w, id: data.windowId, html: data.html, loading: false, usage: data.usage } : w)));
```

- [ ] **Step 7: Assert it at the desktop level**

Append to the `describe("Desktop", …)` block in `app/page.test.tsx`:

```tsx
  it("shows the open call's latency in the window chrome", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    expect(screen.getByTestId("usage-chip")).toHaveTextContent("1.7s · 4.1k cached");
  });
```

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 8: Verify**

Run: `npx vitest run components/ app/page.test.tsx` then `npx tsc --noEmit` then `npm test`
Expected: every `components/*` and `app/page.test.tsx` test passes; no tsc errors in `components/` or `app/page.tsx`. `npm test` may still show failures in `lib/**` or `app/api/**` from sibling plans in flight — those are not this plan's to fix.

---

## Coverage map (spec item → task)

| Item | Task |
| --- | --- |
| WP-A client half (Spotlight query, `openApp(card, query?)`, builtin blurbs) | 6 |
| B1 raise-on-click (functional `focus`, `sendPatch` ref) | 4 (desktop), 8 (frame) |
| B2 pointer capture on drag/resize | 7 |
| B3 z-index ceiling + shell layers | 1 |
| B4 keyboard, minimize, `display:none`, taskbar toggle, icon `onClick` | 2, 3, 5 |
| C4 failed patches keep `needsResync`, banner | 9 |
| D1 Enter → `action:"submit"` | 10 |
| D2 instruction bar | 11 |
| F1 `preventDefault` + sanitize initial HTML | 12 |
| H1 usage chip + elapsed tick | 13 |
| WP-I coverage (POST body, resync, self-heal, page focus/minimize, Taskbar) | 1, 2, 3, 4, 8 |

## Out of scope for this plan (owned elsewhere or explicitly deferred)

- `lib/**` and `app/api/**` — sibling plans (engine/session detail, `applyOps`/`sanitizeHtml`, routes/guard).
- Full ARIA modal semantics for Spotlight/StartMenu (`role="dialog"`, focus trap, focus restoration) — the spec ships the keyboard path and defers the modal semantics.
- A `busy` re-entrancy guard — the `absolute inset-0 z-10` overlay already hit-tests first and swallows clicks, so overlapping patches are unreachable.
