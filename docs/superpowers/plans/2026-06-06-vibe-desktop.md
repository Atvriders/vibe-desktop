# VibeDesktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user "hallucinated Windows 11" desktop where a Spotlight search lets you type any app and Claude (Haiku 4.5) generates its UI and click-by-click behavior in real time, with no application code behind it.

**Architecture:** A fresh Next.js (App Router) app. The browser renders a Win11-glass shell (desktop, Spotlight, draggable windows, taskbar). Three Next.js API routes hold the API key and proxy Claude: `/api/search` (query → fake app cards), `/api/window/open` (app → initial HTML), `/api/window/patch` (clicked element id → DOM op list). Each window is one stateless Claude conversation kept in a server-side in-memory map; clicking an element appends a turn and the model returns a flat, id-addressed DOM patch that the client applies to a sandboxed iframe.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · `@anthropic-ai/sdk` · Vitest + jsdom + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-06-vibe-desktop-design.md`

---

## Prerequisites

- Node 20+ and npm available.
- An Anthropic API key. Tasks assume it will be placed in `.env.local` (Task 0). Tests never call the real API (the SDK is mocked), so the key is only needed to run the app.
- Working directory is the existing repo at `~/vibe-desktop` (already `git init`-ed on `master`, with the spec committed). Run all commands from there.

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.setup.ts` | Scaffold + test harness |
| `app/layout.tsx`, `app/globals.css` | Root HTML + Tailwind |
| `app/page.tsx` | Desktop shell (window state, spotlight toggle) |
| `app/api/search/route.ts` | POST query → `{cards}` |
| `app/api/window/open/route.ts` | POST appName → `{windowId, html}` |
| `app/api/window/patch/route.ts` | POST `{windowId, elementId, domSnapshot?}` → `{ops, cacheReadTokens}` |
| `lib/types.ts` | Shared types (`RawOp`, `AppCard`, `WindowSession`) |
| `lib/sanitize.ts` | Strip `<script>` / `on*` / `javascript:` from HTML |
| `lib/apply-ops.ts` | Apply a DOM op list to a `Document` (client-side) |
| `lib/sessions.ts` | In-memory `windowId → WindowSession` store (HMR-safe) |
| `lib/cache.ts` | Build `cache_control` system + rolling-tail breakpoints |
| `lib/tool-schema.ts` | Prompts + `apply_dom_patch` / `app_results` tool schemas |
| `lib/claude.ts` | Anthropic client + model id (the only module that touches the SDK) |
| `lib/engine.ts` | `searchApps` / `openWindow` / `patchWindow` (orchestration) |
| `components/Spotlight.tsx` | Search overlay + results grid |
| `components/WindowFrame.tsx` | Glass window chrome + iframe + click→patch wiring |
| `components/Taskbar.tsx` | Floating taskbar (search button + open-window pills) |

Test files live next to their module as `*.test.ts(x)`.

---

## Task 0: Scaffold the project + test harness

**Files:** Create `package.json` (via npm), `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `vitest.config.ts`, `vitest.setup.ts`, `.env.local`.

- [ ] **Step 1: Initialize package and install deps**

Run:
```bash
cd ~/vibe-desktop
npm init -y >/dev/null
npm install next@latest react@latest react-dom@latest @anthropic-ai/sdk@latest
npm install -D typescript @types/node @types/react @types/react-dom \
  tailwindcss @tailwindcss/postcss \
  vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom
```
Expected: installs complete with no error.

- [ ] **Step 2: Set scripts in `package.json`**

Edit `package.json` so the `"scripts"` block is exactly:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

`postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: true },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
});
```

`vitest.setup.ts`:
```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 4: Write the minimal app shell + Tailwind entry**

`app/globals.css`:
```css
@import "tailwindcss";
html, body { height: 100%; margin: 0; }
```

`app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "VibeDesktop" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (temporary placeholder, replaced in Task 11):
```tsx
export default function Page() {
  return <main className="grid place-items-center h-screen text-slate-600">VibeDesktop boots here.</main>;
}
```

- [ ] **Step 5: Create the env file**

```bash
printf 'ANTHROPIC_API_KEY=%s\n' "${ANTHROPIC_API_KEY:-sk-ant-REPLACE_ME}" > .env.local
```
(`.env.local` is already gitignored.)

- [ ] **Step 6: Verify it boots and tests run**

Run:
```bash
npm run build
npx vitest run --passWithNoTests
```
Expected: `next build` completes; vitest exits 0 with no tests yet.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app + Vitest harness"
```

---

## Task 1: Shared types

**Files:** Create `lib/types.ts`.

- [ ] **Step 1: Write the types**

`lib/types.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";

/** A DOM edit as emitted by the model (validated/applied host-side). */
export interface RawOp {
  op: "setText" | "setAttr" | "removeAttr" | "addClass" | "removeClass" | "replaceHTML" | "insertHTML" | "remove";
  id: string;
  attr?: string;
  value?: string;
  position?: "before" | "after" | "firstChild" | "lastChild";
}

/** One fabricated app result from the search backend. */
export interface AppCard {
  id: string;
  name: string;
  icon: string;
  blurb: string;
}

/** One window's entire state = its Claude conversation. */
export interface WindowSession {
  id: string;
  appName: string;
  messages: Anthropic.MessageParam[];
  clickCount: number;
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add lib/types.ts && git commit -m "feat: shared types"
```

---

## Task 2: HTML sanitizer (TDD)

**Files:** Create `lib/sanitize.ts`, `lib/sanitize.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/sanitize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("removes <script> tags but keeps surrounding markup", () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("strips on* event handlers and javascript: urls", () => {
    const out = sanitizeHtml('<a id="x" href="javascript:alert(1)" onclick="x()">go</a>');
    expect(out).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("go");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sanitize.test.ts`
Expected: FAIL — `sanitizeHtml` not exported.

- [ ] **Step 3: Implement**

`lib/sanitize.ts`:
```ts
/** Defense-in-depth: the iframe runs without `allow-scripts`, but we still
 *  scrub model-authored HTML before inserting it. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sanitize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sanitize.ts lib/sanitize.test.ts && git commit -m "feat: html sanitizer"
```

---

## Task 3: DOM op applier (TDD)

**Files:** Create `lib/apply-ops.ts`, `lib/apply-ops.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/apply-ops.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyOps } from "./apply-ops";
import type { RawOp } from "./types";

function docWith(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("applyOps", () => {
  it("applies setText to an element by id", () => {
    const d = docWith('<div id="a">old</div>');
    const r = applyOps(d, [{ op: "setText", id: "a", value: "new" }]);
    expect(d.getElementById("a")!.textContent).toBe("new");
    expect(r.applied).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

  it("drops ops that target a nonexistent id", () => {
    const d = docWith('<div id="a"></div>');
    const r = applyOps(d, [{ op: "setText", id: "ghost", value: "x" } as RawOp]);
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(0);
  });

  it("strips event-handler attributes on setAttr", () => {
    const d = docWith('<button id="b">x</button>');
    applyOps(d, [{ op: "setAttr", id: "b", attr: "onclick", value: "evil()" }]);
    expect(d.getElementById("b")!.hasAttribute("onclick")).toBe(false);
  });

  it("removes an element", () => {
    const d = docWith('<div id="a"></div><div id="b"></div>');
    applyOps(d, [{ op: "remove", id: "a" }]);
    expect(d.getElementById("a")).toBeNull();
    expect(d.getElementById("b")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/apply-ops.test.ts`
Expected: FAIL — `applyOps` not exported.

- [ ] **Step 3: Implement**

`lib/apply-ops.ts`:
```ts
import { sanitizeHtml } from "./sanitize";
import type { RawOp } from "./types";

const isUnsafeAttr = (a: string) => a.toLowerCase().startsWith("on");

export function applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] } {
  const applied: RawOp[] = [];
  const dropped: RawOp[] = [];
  for (const op of ops) {
    const el = op.id ? doc.getElementById(op.id) : null;
    if (!el) { dropped.push(op); continue; }
    try {
      switch (op.op) {
        case "setText": el.textContent = op.value ?? ""; break;
        case "setAttr":
          if (!op.attr || isUnsafeAttr(op.attr)) { dropped.push(op); continue; }
          el.setAttribute(op.attr, op.value ?? ""); break;
        case "removeAttr": if (op.attr) el.removeAttribute(op.attr); break;
        case "addClass": if (op.value) el.classList.add(op.value); break;
        case "removeClass": if (op.value) el.classList.remove(op.value); break;
        case "replaceHTML": el.innerHTML = sanitizeHtml(op.value ?? ""); break;
        case "insertHTML": insertHtml(el, op); break;
        case "remove": el.remove(); break;
        default: dropped.push(op); continue;
      }
      applied.push(op);
    } catch {
      dropped.push(op);
    }
  }
  return { applied, dropped };
}

function insertHtml(el: Element, op: RawOp) {
  const holder = el.ownerDocument.createElement("div");
  holder.innerHTML = sanitizeHtml(op.value ?? "");
  const nodes = Array.from(holder.childNodes);
  const pos = op.position ?? "lastChild";
  for (const n of nodes) {
    if (pos === "before") el.parentNode?.insertBefore(n, el);
    else if (pos === "after") el.parentNode?.insertBefore(n, el.nextSibling);
    else if (pos === "firstChild") el.insertBefore(n, el.firstChild);
    else el.appendChild(n);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/apply-ops.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/apply-ops.ts lib/apply-ops.test.ts && git commit -m "feat: dom op applier"
```

---

## Task 4: Session store (TDD)

**Files:** Create `lib/sessions.ts`, `lib/sessions.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/sessions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newSession, getSession, deleteSession } from "./sessions";

describe("session store", () => {
  it("creates, retrieves, and deletes a session", () => {
    const s = newSession("Calculator");
    expect(s.id).toBeTruthy();
    expect(s.appName).toBe("Calculator");
    expect(s.messages).toEqual([]);
    expect(s.clickCount).toBe(0);
    expect(getSession(s.id)).toBe(s);
    deleteSession(s.id);
    expect(getSession(s.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sessions.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

`lib/sessions.ts`:
```ts
import type { WindowSession } from "./types";

// Survive Next.js dev HMR by hanging the map off globalThis.
const g = globalThis as unknown as { __vibeSessions?: Map<string, WindowSession> };
const store: Map<string, WindowSession> = g.__vibeSessions ?? new Map();
g.__vibeSessions = store;

export function newSession(appName: string): WindowSession {
  const session: WindowSession = { id: crypto.randomUUID(), appName, messages: [], clickCount: 0 };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): WindowSession | undefined {
  return store.get(id);
}

export function deleteSession(id: string): void {
  store.delete(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sessions.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/sessions.ts lib/sessions.test.ts && git commit -m "feat: in-memory session store"
```

---

## Task 5: Caching helpers (TDD)

**Files:** Create `lib/cache.ts`, `lib/cache.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/cache.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { frozenSystem, cacheLastTurn } from "./cache";

describe("cache helpers", () => {
  it("frozenSystem marks the system block ephemeral", () => {
    const sys = frozenSystem("hello");
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("cacheLastTurn puts a breakpoint on the last block of the last message", () => {
    const msgs = cacheLastTurn([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    const last: any = msgs[msgs.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content[last.content.length - 1].cache_control).toEqual({ type: "ephemeral" });
    // earlier message left untouched
    expect((msgs[0] as any).content).toBe("first");
  });

  it("returns empty array unchanged", () => {
    expect(cacheLastTurn([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/cache.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

`lib/cache.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";

/** System prompt as a cached (frozen) prefix block. */
export function frozenSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** Return a copy of `messages` with a cache breakpoint on the last content
 *  block of the last message (the rolling multi-turn pattern). The growing
 *  prefix before it is matched as a cheap cache read on the next request. */
export function cacheLastTurn(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const copy = messages.map((m) => ({ ...m }));
  const last = copy[copy.length - 1];
  const content =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content } as Anthropic.TextBlockParam]
      : last.content.map((b) => ({ ...b }));
  const tail = content[content.length - 1] as { cache_control?: unknown };
  tail.cache_control = { type: "ephemeral" };
  last.content = content as Anthropic.MessageParam["content"];
  return copy;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/cache.ts lib/cache.test.ts && git commit -m "feat: prompt-cache breakpoint helpers"
```

---

## Task 6: Prompts + tool schemas

**Files:** Create `lib/tool-schema.ts`.

- [ ] **Step 1: Write the module**

`lib/tool-schema.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";

export const WINDOW_SYSTEM = (appName: string): string =>
`You are simulating the UI of a single desktop application as a live HTML fragment. App: "${appName}".
Rules:
1) Output ONLY an HTML fragment for the window body. No <html>, <head>, <script>, or <style> tags. Style with inline style="" attributes only.
2) EVERY interactive element MUST have a unique, stable id (e.g. id="r1", id="display"). Reuse the same id across turns — never renumber an existing element.
3) There is no code behind this UI. Maintain ALL app state yourself from the click history in this conversation; the rendered values are the source of truth.
4) On the initial turn, return the full HTML. On later turns, you will be told which element id was clicked and must return a minimal DOM patch via the apply_dom_patch tool.
5) Make it look like a real, modern version of the app.`;

export const SEARCH_SYSTEM =
`You are the search backend of a whimsical operating system that can conjure any app on demand. Given the user's query, invent up to 6 plausible, fun applications that fit it. Each app needs a short name, a single emoji icon, and a one-line blurb. Always respond by calling the app_results tool.`;

export const APPLY_DOM_PATCH_TOOL: Anthropic.Tool = {
  name: "apply_dom_patch",
  description:
    "Return the minimal set of DOM edits that result from the user's click. Target elements ONLY by their existing id. To add new elements use insertHTML and give every new element a unique id.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["ops"],
    properties: {
      ops: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["op", "id"],
          properties: {
            op: {
              type: "string",
              enum: ["setText", "setAttr", "removeAttr", "addClass", "removeClass", "replaceHTML", "insertHTML", "remove"],
            },
            id: { type: "string" },
            attr: { type: "string" },
            value: { type: "string" },
            position: { type: "string", enum: ["before", "after", "firstChild", "lastChild"] },
          },
        },
      },
    },
  } as Anthropic.Tool["input_schema"],
};

export const APP_CARDS_TOOL: Anthropic.Tool = {
  name: "app_results",
  description: "Return the list of fabricated apps that match the user's search.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "icon", "blurb"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            icon: { type: "string" },
            blurb: { type: "string" },
          },
        },
      },
    },
  } as Anthropic.Tool["input_schema"],
};
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add lib/tool-schema.ts && git commit -m "feat: prompts + tool schemas"
```

---

## Task 7: Claude client

**Files:** Create `lib/claude.ts`.

- [ ] **Step 1: Write the module**

`lib/claude.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";

// The ONLY module that constructs the SDK client. Engine + routes import these;
// tests mock this module so the real API is never called.
export const MODEL = "claude-haiku-4-5";
export const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add lib/claude.ts && git commit -m "feat: anthropic client module"
```

---

## Task 8: Engine — search / open / patch (TDD, SDK mocked)

**Files:** Create `lib/engine.ts`, `lib/engine.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/engine.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("./claude", () => ({ MODEL: "claude-haiku-4-5", anthropic: { messages: { create } } }));

import { searchApps, openWindow, patchWindow } from "./engine";

beforeEach(() => create.mockReset());

describe("engine", () => {
  it("searchApps returns the tool's cards array", async () => {
    create.mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "app_results", input: { cards: [{ id: "1", name: "Synthy", icon: "🎹", blurb: "make noise" }] } }],
      usage: {},
    });
    const cards = await searchApps("a synth");
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Synthy");
  });

  it("openWindow returns html and stores a session", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "<div id=\"d\">0</div>" }], usage: {} });
    const { windowId, html } = await openWindow("Calculator");
    expect(windowId).toBeTruthy();
    expect(html).toContain("id=\"d\"");
  });

  it("patchWindow returns the op list for a known window", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "<div id=\"d\">0</div>" }], usage: {} });
    const { windowId } = await openWindow("Calculator");
    create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t2", name: "apply_dom_patch", input: { ops: [{ op: "setText", id: "d", value: "7" }] } }],
      usage: { cache_read_input_tokens: 1234 },
    });
    const { ops, cacheReadTokens } = await patchWindow(windowId, "btn7");
    expect(ops[0]).toMatchObject({ op: "setText", id: "d", value: "7" });
    expect(cacheReadTokens).toBe(1234);
  });

  it("patchWindow throws on unknown window", async () => {
    await expect(patchWindow("nope", "x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine.test.ts`
Expected: FAIL — `engine` exports missing.

- [ ] **Step 3: Implement**

`lib/engine.ts`:
```ts
import { anthropic, MODEL } from "./claude";
import { frozenSystem, cacheLastTurn } from "./cache";
import { WINDOW_SYSTEM, SEARCH_SYSTEM, APPLY_DOM_PATCH_TOOL, APP_CARDS_TOOL } from "./tool-schema";
import { newSession, getSession } from "./sessions";
import type { AppCard, RawOp } from "./types";

const NO_THINK = { type: "disabled" } as const;

export async function searchApps(query: string): Promise<AppCard[]> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: NO_THINK,
    system: SEARCH_SYSTEM,
    tools: [APP_CARDS_TOOL],
    tool_choice: { type: "tool", name: "app_results" },
    messages: [{ role: "user", content: query }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  return ((block.input as { cards?: AppCard[] }).cards ?? []);
}

export async function openWindow(appName: string): Promise<{ windowId: string; html: string }> {
  const session = newSession(appName);
  session.messages.push({ role: "user", content: "Render the initial screen of the app." });
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: NO_THINK,
    system: frozenSystem(WINDOW_SYSTEM(appName)),
    messages: cacheLastTurn(session.messages),
  });
  const html = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  session.messages.push({ role: "assistant", content: res.content });
  return { windowId: session.id, html };
}

export async function patchWindow(
  windowId: string,
  elementId: string,
  domSnapshot?: string,
): Promise<{ ops: RawOp[]; cacheReadTokens: number }> {
  const session = getSession(windowId);
  if (!session) throw new Error(`unknown window: ${windowId}`);

  if (domSnapshot) {
    session.messages.push({
      role: "user",
      content: `The current DOM is:\n${domSnapshot}\nContinue from this exact state.`,
    });
  }
  session.messages.push({
    role: "user",
    content: `The user clicked the element with id "${elementId}". Update the app state and return the DOM patch.`,
  });
  session.clickCount += 1;

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine.ts lib/engine.test.ts && git commit -m "feat: engine (search/open/patch)"
```

---

## Task 9: API routes (TDD, engine mocked)

**Files:** Create `app/api/search/route.ts`, `app/api/window/open/route.ts`, `app/api/window/patch/route.ts`, and `app/api/routes.test.ts`.

- [ ] **Step 1: Write the failing test**

`app/api/routes.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const searchApps = vi.fn();
const openWindow = vi.fn();
const patchWindow = vi.fn();
vi.mock("@/lib/engine", () => ({ searchApps, openWindow, patchWindow }));

import { POST as searchPOST } from "./search/route";
import { POST as openPOST } from "./window/open/route";
import { POST as patchPOST } from "./window/patch/route";

const post = (body: unknown) =>
  new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { searchApps.mockReset(); openWindow.mockReset(); patchWindow.mockReset(); });

describe("api routes", () => {
  it("search returns cards", async () => {
    searchApps.mockResolvedValue([{ id: "1", name: "X", icon: "⭐", blurb: "b" }]);
    const res = await searchPOST(post({ query: "x" }));
    expect(await res.json()).toEqual({ cards: [{ id: "1", name: "X", icon: "⭐", blurb: "b" }] });
  });

  it("search 400s on missing query", async () => {
    const res = await searchPOST(post({}));
    expect(res.status).toBe(400);
  });

  it("open returns windowId + html", async () => {
    openWindow.mockResolvedValue({ windowId: "w1", html: "<div id=\"d\"></div>" });
    const res = await openPOST(post({ appName: "Calc" }));
    expect(await res.json()).toEqual({ windowId: "w1", html: "<div id=\"d\"></div>" });
  });

  it("patch returns ops", async () => {
    patchWindow.mockResolvedValue({ ops: [{ op: "setText", id: "d", value: "7" }], cacheReadTokens: 5 });
    const res = await patchPOST(post({ windowId: "w1", elementId: "b7" }));
    expect(await res.json()).toEqual({ ops: [{ op: "setText", id: "d", value: "7" }], cacheReadTokens: 5 });
  });

  it("patch 404s on unknown window", async () => {
    patchWindow.mockRejectedValue(new Error("unknown window"));
    const res = await patchPOST(post({ windowId: "ghost", elementId: "b" }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/routes.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 3: Implement the three routes**

`app/api/search/route.ts`:
```ts
import { NextResponse } from "next/server";
import { searchApps } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  const cards = await searchApps(query);
  return NextResponse.json({ cards });
}
```

`app/api/window/open/route.ts`:
```ts
import { NextResponse } from "next/server";
import { openWindow } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { appName } = await req.json().catch(() => ({}));
  if (!appName || typeof appName !== "string") {
    return NextResponse.json({ error: "appName required" }, { status: 400 });
  }
  const { windowId, html } = await openWindow(appName);
  return NextResponse.json({ windowId, html });
}
```

`app/api/window/patch/route.ts`:
```ts
import { NextResponse } from "next/server";
import { patchWindow } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { windowId, elementId, domSnapshot } = await req.json().catch(() => ({}));
  if (!windowId || !elementId) {
    return NextResponse.json({ error: "windowId and elementId required" }, { status: 400 });
  }
  try {
    const { ops, cacheReadTokens } = await patchWindow(windowId, elementId, domSnapshot);
    return NextResponse.json({ ops, cacheReadTokens });
  } catch {
    return NextResponse.json({ error: "unknown window" }, { status: 404 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api && git commit -m "feat: search/open/patch API routes"
```

---

## Task 10: Spotlight component (TDD, fetch mocked)

**Files:** Create `components/Spotlight.tsx`, `components/Spotlight.test.tsx`.

- [ ] **Step 1: Write the failing test**

`components/Spotlight.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Spotlight } from "./Spotlight";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    json: async () => ({ cards: [{ id: "1", name: "Synthy", icon: "🎹", blurb: "make noise" }] }),
  })));
});

describe("Spotlight", () => {
  it("searches and opens a result card", async () => {
    const onOpen = vi.fn();
    render(<Spotlight onOpen={onOpen} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/type any app/i), { target: { value: "a synth" } });
    fireEvent.submit(screen.getByPlaceholderText(/type any app/i));
    const card = await screen.findByText("Synthy");
    fireEvent.click(card);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "Synthy" })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/Spotlight.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

`components/Spotlight.tsx`:
```tsx
"use client";
import { useState } from "react";
import type { AppCard } from "@/lib/types";

export function Spotlight({ onOpen, onClose }: { onOpen: (card: AppCard) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<AppCard[]>([]);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setCards([]);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await r.json();
      setCards(data.cards ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <div className="w-[36rem] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={search}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type any app…  (e.g. a synth, Excel 95, Minesweeper)"
            className="w-full rounded-xl px-4 py-3 text-slate-800 bg-white/90 shadow-2xl outline-none"
          />
        </form>
        {loading && <p className="mt-3 text-sm text-white/80">Conjuring apps…</p>}
        {cards.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {cards.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpen(c)}
                className="flex items-center gap-3 rounded-xl p-3 bg-white/90 hover:bg-white text-left shadow"
              >
                <span className="text-2xl">{c.icon}</span>
                <span>
                  <span className="block font-medium text-slate-800">{c.name}</span>
                  <span className="block text-xs text-slate-500">{c.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/Spotlight.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add components/Spotlight.tsx components/Spotlight.test.tsx && git commit -m "feat: spotlight search component"
```

---

## Task 11: WindowFrame + Taskbar (TDD for chrome; iframe wiring verified manually)

**Files:** Create `components/WindowFrame.tsx`, `components/WindowFrame.test.tsx`, `components/Taskbar.tsx`.

- [ ] **Step 1: Write the failing test**

`components/WindowFrame.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowFrame, type WinState } from "./WindowFrame";

const win: WinState = { id: "w1", title: "Calculator", html: "<div id=\"d\">0</div>", x: 10, y: 10, z: 1, minimized: false };

describe("WindowFrame", () => {
  it("shows the title and closes on the close button", () => {
    const onClose = vi.fn();
    render(<WindowFrame win={win} onClose={onClose} onFocus={() => {}} onMove={() => {}} />);
    expect(screen.getByText("Calculator")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledWith("w1");
  });

  it("renders nothing when minimized", () => {
    const { container } = render(<WindowFrame win={{ ...win, minimized: true }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement WindowFrame**

`components/WindowFrame.tsx`:
```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/WindowFrame.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement Taskbar**

`components/Taskbar.tsx`:
```tsx
"use client";
import type { WinState } from "./WindowFrame";

export function Taskbar({
  windows,
  onSearch,
  onFocus,
}: {
  windows: WinState[];
  onSearch: () => void;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl px-3 py-2 bg-white/70 backdrop-blur-xl shadow-2xl border border-white/40">
      <button onClick={onSearch} aria-label="Search" className="w-9 h-9 rounded-xl bg-blue-500 text-white grid place-items-center text-lg">
        ⌕
      </button>
      {windows.map((w) => (
        <button
          key={w.id}
          onClick={() => onFocus(w.id)}
          className="px-3 h-9 rounded-xl bg-white/80 text-sm text-slate-700 max-w-[10rem] truncate"
        >
          {w.title}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/WindowFrame.tsx components/WindowFrame.test.tsx components/Taskbar.tsx && git commit -m "feat: window frame + taskbar"
```

---

## Task 12: Wire the desktop shell

**Files:** Replace `app/page.tsx`.

- [ ] **Step 1: Replace the placeholder page**

`app/page.tsx`:
```tsx
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
```

- [ ] **Step 2: Full typecheck + test suite + build**

Run:
```bash
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: tsc clean; all tests pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx && git commit -m "feat: wire desktop shell"
```

---

## Task 13: Manual end-to-end verification

**Files:** none (manual). Requires a real `ANTHROPIC_API_KEY` in `.env.local`.

- [ ] **Step 1: Run the app**

Run: `npm run dev` and open `http://localhost:3000`.
Expected: a blue→purple Win11-glass desktop with a floating taskbar and the Spotlight open.

- [ ] **Step 2: Walk the acceptance criteria from the spec**

Verify each:
1. Desktop, taskbar, and Spotlight are present.
2. Type a query (e.g. "a synth") → within a couple seconds a 2-column grid of ~6 app cards appears.
3. Click a card → a draggable, resizable glass window opens and paints a hallucinated UI.
4. Click elements inside the window → it updates within ~1.5–2s and state persists (try a calculator: `7 8 + 9 =`).
5. Open several apps (re-open Spotlight from the taskbar ⌕) → each window behaves independently.
6. Open the browser devtools console → after repeat clicks in a window you see `cache_read_input_tokens = <n>` with n > 0.
7. In the Network tab, confirm no request carries the API key, and that injected `<script>` never executes (the iframe has no `allow-scripts`).

- [ ] **Step 3: Note any gaps**

If a criterion fails, capture the symptom and fix in a follow-up task. Common tuning: if the model renumbers ids or loses state, strengthen rule (2)/(3) in `WINDOW_SYSTEM`; if patches are sluggish, lower `max_tokens` on patches; if cache reads are 0, confirm the system prompt is byte-stable (no interpolated timestamps) and that `WINDOW_SYSTEM(appName)` exceeds the model's minimum cacheable prefix.

- [ ] **Step 4: Final commit (docs/notes only, if any)**

```bash
git add -A && git commit -m "docs: e2e verification notes" || echo "nothing to commit"
```

---

## Notes & deviations from spec (intentional, for a weekend demo)

- **`strict: true` on tools is omitted.** We force the tool via `tool_choice` and validate/drop ops host-side in `applyOps` instead. This avoids any beta-header/SDK-version friction; add `strict: true` later if you want grammar-level guarantees.
- **Resync** is implemented as an optional `domSnapshot` the client sends every 10th click (drift mitigation), not a separate endpoint.
- **Window reset at ~60–100K tokens** (cost guard) and **minimize** are left as obvious follow-ups; the `WinState.minimized` field and `Taskbar` are already in place to hang them on.
- **Resize** is the cheap CSS `resize: both` handle, sufficient for a demo.
