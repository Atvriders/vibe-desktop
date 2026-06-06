# VibeDesktop v2 — Features Spec

- **Date:** 2026-06-06
- **Status:** Approved (design) → ready for implementation plan
- **Branch:** `feat/v2-desktop`
- **Builds on:** the shipped MVP (`docs/superpowers/specs/2026-06-06-vibe-desktop-design.md`)

## Goal

Add shell + interaction features to the working VibeDesktop: a Start menu of built-in apps, a hallucinated Settings app, desktop & in-app right-click menus, original-sounding searched app names, loading screens, on-screen drag clamping + clearer window borders, and a **coordinate/grid-aware click model** so every click is actionable. All additive; reuses the existing per-window Claude engine.

## Features

### 1. Start menu + built-in apps
- New `components/StartMenu.tsx`: a panel anchored above a taskbar **Start** button, showing a grid of built-in apps `{name, icon}`. Clicking an entry calls the existing open-window flow (same `AppCard` shape as a search result).
- `lib/builtin-apps.ts` exports `BUILTIN_APPS: { id: string; name: string; icon: string }[]` = Settings ⚙️, Notepad 📝, Calculator 🧮, Web Browser 🌐, Files 📁, Paint 🎨, Music 🎵, Clock 🕐, Terminal ⌨️, Mail ✉️.
- `components/Taskbar.tsx` gains a **Start** button (left of the existing search ⌕) that toggles the Start menu.
- Built-ins keep **familiar generic names on purpose** (this is the "more generic apps" ask). Only *searched* apps get original names (Feature 4).

### 2. Settings (hallucinated)
- Just the `{name:"Settings", icon:"⚙️"}` built-in entry → the existing `WINDOW_SYSTEM` renders a convincing Windows-Settings-style UI. It **looks** real but does **not** change the actual shell. No special shell code.

### 3. Right-click (desktop + in-app)
- **Desktop:** `components/DesktopContextMenu.tsx` — a menu positioned at the cursor on the desktop's `onContextMenu` (preventDefault). Items: **New app…** (opens Spotlight) and **Settings** (opens the Settings built-in). Click-away / Escape closes. `page.tsx` holds `{x,y}|null` menu state.
- **In-app:** `WindowFrame` adds a capture-phase `contextmenu` listener on the iframe's `contentDocument` (preventDefault), and sends a patch with `action:"contextmenu"`. The model returns ops that draw an app-appropriate context menu. Same click→patch loop, new verb.

### 4. Original searched app names
- `SEARCH_SYSTEM` (in `lib/tool-schema.ts`) instructs: invent **original, made-up, brand-style** names; avoid any real or trademarked product and avoid plain dictionary words; each should feel like a real indie-app brand. Model self-check — **no extra API calls**. Built-in apps are unaffected.

### 5. Loading screens
- **Window boot screen:** `openApp` adds the window to state **immediately** with `loading:true` (no html yet); `WindowFrame` renders a boot screen (app icon + name + a shimmer/progress) until `/api/window/open` returns, then paints the iframe. On open failure, the boot screen shows an error ("Couldn't reach the model").
- **Per-click busy state:** `WindowFrame` shows a thin top progress bar while a click/contextmenu patch is in flight; cleared when ops are applied.
- Spotlight keeps its "Conjuring apps…" state.
- `WinState` gains `loading: boolean` and `icon?: string`.

### 6. On-screen drag clamp + window border
- New pure helper `lib/geometry.ts` → `clampToViewport(x, y, w, h, vw, vh, taskbarH): { x: number; y: number }` clamps so a window stays fully on-screen and above the taskbar: `x ∈ [0, max(0, vw − w)]`, `y ∈ [0, max(0, vh − h − taskbarH)]`. `WindowFrame`'s drag handler runs every move through it (using the window's live `offsetWidth/offsetHeight`); `page.tsx` clamps spawn positions too.
- **Border:** windows get a defined edge — crisper border + subtle ring + stronger drop shadow — so each reads as a framed surface and the bottom-right resize grip is visible.

### 7. Grid/coordinate-aware clicks ("make all buttons clickable")
The single change to the core interaction. Replaces the v1 "id-only" click message.
- `WindowFrame` captures **every** click and contextmenu in the iframe document (not just on id-bearing elements).
- For each event it computes the position as **normalized window coordinates** `x,y ∈ [0,100]` (integer %, top-left origin) from the event point and the iframe's content rect, **plus** the nearest ancestor `[id]` (or `null`).
- Sends `{ windowId, elementId, x, y, action }` to `/api/window/patch` (`elementId` may be null).
- `patchWindow` (engine) wording becomes coordinate-aware, e.g.:
  > "The user {clicked|right-clicked} at x={x}, y={y} (percent of the window, top-left origin)" + (if id) ", on or near the element with id \"{id}\"" + ". Using the HTML you generated, determine what was clicked and return the DOM patch for the resulting screen. If a context menu is appropriate, render it."
- Because Claude already holds the window's HTML in the conversation, the coordinates let it map **any** click — including untagged buttons — to the right element and produce the next screen. Nothing is dead.
- **Visible grid overlay** is optional/off by default (a faint debug grid behind a dev toggle); the coordinates are sent regardless.

## Engine / API changes
- `app/api/window/patch/route.ts` accepts `{ windowId, elementId, x, y, action }`. `elementId` optional; `action ∈ {"click","contextmenu"}` (default `"click"`); `x`/`y` integers 0–100.
- `lib/engine.ts` `patchWindow(windowId, { elementId, x, y, action, domSnapshot })` builds the coordinate-aware user turn; everything else (forced `apply_dom_patch`, caching, resync) unchanged.

## Files
- **New:** `components/StartMenu.tsx`, `components/DesktopContextMenu.tsx`, `lib/builtin-apps.ts`, `lib/geometry.ts` (+ `lib/geometry.test.ts`).
- **Modified:** `app/page.tsx` (built-ins, Start-menu + desktop-context-menu state, optimistic loading window, spawn clamp), `components/WindowFrame.tsx` (boot screen, busy bar, contextmenu listener, coordinate clicks, drag clamp, border), `components/Taskbar.tsx` (Start button), `lib/tool-schema.ts` (original-names `SEARCH_SYSTEM`), `lib/engine.ts` + `app/api/window/patch/route.ts` (coordinate + `action`).
- **Tests:** `lib/geometry.test.ts` (clamp math), `lib/builtin-apps` presence, `StartMenu` renders + `onOpen`, `DesktopContextMenu` actions, engine `patchWindow` coordinate/contextmenu wording, `WindowFrame` boot-screen render.

## Acceptance criteria
1. Taskbar **Start** button opens a grid of built-in apps; clicking one opens it via the normal flow.
2. **Settings** opens a Windows-Settings-looking (hallucinated) window.
3. **Right-click** the desktop → New app… / Settings menu; right-click inside an app → a model-drawn context menu appears.
4. **Searched** app names sound original/invented (no "Calculator", no real brands); built-ins stay generic.
5. Opening an app shows a **boot screen instantly**, then the app paints; each click shows a **busy bar**.
6. Windows **cannot** be dragged off-screen or under the taskbar; windows have a **clear border**.
7. **Every** click advances the UI — clicking any button (even untagged) sends grid coordinates + nearest id, and Claude returns the next screen.

## Non-goals (YAGNI)
Settings doesn't change the shell; no wallpaper changer; no persistence; the visible grid overlay stays an off-by-default dev toggle.
