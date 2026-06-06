# VibeDesktop — Design Spec

- **Date:** 2026-06-06
- **Status:** Approved (brainstorm complete) → ready for implementation plan
- **One-liner:** A browser-based "Windows 11" desktop where a Spotlight search lets you type *anything* and Claude generates the app — UI and behavior — in real time, with no application code behind it. A local, single-user homage to Steve Sanderson's "Vibe OS" Build 2026 demo, rebuilt on the Claude API.

## Goal

Recreate the "type anything → an app appears and actually responds to clicks" magic as a polished-feeling Win11 desktop. Optimize for **wow-factor and weekend-buildability**, run locally with the developer's own Anthropic API key. The headline moment: search "a synth" → a grid of plausible fake apps → click one → a working (hallucinated) window opens and reacts to clicks.

This is a **fun demo / portfolio piece**, explicitly *not* a product.

## Non-goals (YAGNI)

Out of scope for this build: user accounts / auth, any database or persistence, multi-user, saved or shareable apps, mobile/responsive, a real filesystem, inter-window communication. These would each turn a weekend demo into a product and add no wow.

*Possible later (not now):* stream the first render for perceived speed; a per-window "upgrade to Sonnet" quality toggle.

## Decisions (locked during brainstorm)

| Axis | Decision |
|---|---|
| Target | Fun demo / portfolio; local; developer's own API key |
| Shell | Build a minimal custom shell (not a fork of an existing web desktop) |
| Aesthetic | Modern **Windows 11 / glass** — rounded translucent windows, soft shadows, floating centered taskbar |
| Launch UX | **Search → app-results grid → click to open** (the literal "search for any app"; 2 LLM calls: results, then app) |
| Stack | **Fresh Next.js** (App Router) + Tailwind. **Do not reuse anything from `~/vibeOS`.** Next API routes are the key-safe proxy |
| Engine model | **Claude Haiku 4.5** default, `thinking` disabled |

## Feasibility basis

A 10-agent adversarial feasibility pass (architecture / latency / cost / reliability / prototype) concluded **feasible** for all five dimensions. Key verified facts baked into this design:
- The Claude **Messages API maps ~1:1** onto Sanderson's per-window-LLM-session pattern; the stateless API makes "fake statefulness" literally a client-held `messages[]` array.
- Per-click latency ≈ **1.4s (Haiku) / 2.2s (Sonnet) / 2.7s (Opus)** for a small diff — "deliberate remote-desktop feel," fine for a demo, not a daily driver. Streaming barely helps a patch (must arrive complete before applying).
- **Prompt caching is mandatory** and must cache the *frozen* prefix, not the live HTML (cache the system + initial render + a rolling tail breakpoint). ~$0.6 per 80-click Haiku window cached vs ~$3.1 uncached.
- **Recursive schemas are unsupported** in structured outputs → the patch must be a **flat id-addressed op list**, not a nested HTML tree.
- **State drift** (model's belief vs actual DOM) is the dominant long-session risk → periodic resync.

## Architecture

```
Browser (Next.js client)        Next.js API routes (server)        Claude API
─────────────────────────       ──────────────────────────        ──────────
Desktop shell (Win11 glass)      🔑 ANTHROPIC_API_KEY               Haiku 4.5
Spotlight search                 /api/search                       strict apply_dom_patch tool
Window manager (drag/resize/     /api/window/open                  prompt caching
  min/close, taskbar)            /api/window/patch
Sandboxed iframe × N             🗃 sessions: {windowId → messages[]} (in-memory)
```

The browser only ever talks to our own Next.js server; the API key never reaches the client.

### The three round trips

1. **Search** — user types a query → `POST /api/search` → Haiku returns ~6 fabricated app cards `{id, name, icon, blurb}` → grid renders in the Spotlight overlay.
2. **Open** — user clicks a card → `POST /api/window/open` starts that window's conversation (system prompt + "render <app>") → Haiku returns the initial HTML fragment → a new sandboxed iframe paints it.
3. **Interact** — user clicks element `R7` inside a window → `POST /api/window/patch {windowId, elementId}` → server appends to that window's `messages[]`, forces `apply_dom_patch` → Haiku returns `{ops:[…]}` → client applies ops to the iframe DOM.

## Engine design

### Model configuration
- Model `claude-haiku-4-5`; `thinking: { type: "disabled" }` (latency-sensitive UI; do not pass an `effort` param to Haiku).
- `max_tokens`: ~4096 for the initial render, ~1024 for per-click patches.
- Patch responses are received **in full** before applying (no partial/streamed apply).

### `apply_dom_patch` tool (forced via `tool_choice`)
Flat op list — chosen because structured outputs forbid recursive schemas. The model is instructed to put a **unique, stable `id` on every interactive element** and reuse ids across turns (matches Sanderson's "clicked element R1" design).

```jsonc
{
  "name": "apply_dom_patch",
  "strict": true,
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["ops"],
    "properties": {
      "ops": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["op", "id"],
          "properties": {
            "op":   { "type": "string",
                      "enum": ["setText","setAttr","removeAttr","addClass",
                               "removeClass","replaceHTML","insertHTML","remove"] },
            "id":   { "type": "string" },
            "attr": { "type": "string" },
            "value":{ "type": "string" },
            "position": { "type": "string",
                          "enum": ["before","after","firstChild","lastChild"] }
          }
        }
      }
    }
  }
}
```
Per-op string length cannot be bounded in-schema → cap op count and value length **host-side**.

### Prompt caching strategy (must get right)
- `cache_control: { type: "ephemeral" }` on the **stable prefix**: the system prompt + the initial-render assistant turn (these never change), **plus a rolling breakpoint on the last appended turn** each request (so the growing history reads at ~0.1×).
- **Do not** put the breakpoint on the live, per-click-mutated HTML — that invalidates every click.
- Keep the system prompt **frozen** (no timestamps / per-request ids), max 4 breakpoints.
- Verify in every response: `usage.cache_read_input_tokens > 0`; if stuck at 0, a silent invalidator is breaking the prefix.

## Per-window session & state model

- Server keeps `sessions: Map<windowId, messages[]>` in memory. The conversation **is** the window's entire state. Closing a window drops its entry — statefulness vanishes (by design).
- **Drift handling (resync):** every ~10 clicks, or whenever an op is dropped, append a user turn: *"The current DOM is: `<serialized innerHTML>`. Continue from this exact state."* Appending re-anchors the model without invalidating the cached prefix.
- **Lifecycle / cost guard:** when a window's history crosses ~60–100K tokens, reset by reseeding a fresh session from the current serialized DOM (cheap relative to full history). Idle windows incur no cost (cost is per-click only).
- **Recovery ladder:**
  - Unknown-id / unsafe op → host drops it, applies the rest, feeds back *"ops for ids [...] were dropped; current DOM is ..."* → model self-corrects next turn.
  - `stop_reason == "max_tokens"` → truncated op array → apply nothing, re-ask (or reseed).
  - `stop_reason == "refusal"` → treat as no-op, show a benign placeholder.
  - Unrecoverable window → discard its conversation and reseed the iframe from the original "render <app>" prompt (windows are independent, so this is cheap).

## Security model

- Render model HTML into an iframe via **`srcdoc`** with **`sandbox="allow-same-origin"` but NOT `allow-scripts`**. The host can read clicks and apply ops through `contentDocument`, while any `<script>` / `onerror` the model emits **never executes**. (Because `allow-scripts` is absent, the classic `allow-scripts + allow-same-origin` sandbox-escape does not apply.)
- **Sanitize** any raw-HTML op values (`replaceHTML` / `insertHTML` / `setAttr`): strip `<script>`, `on*` handler attributes, and `javascript:` URLs, as defense-in-depth.
- `ANTHROPIC_API_KEY` lives only in server env (`.env.local`), never shipped to the browser. The client calls only our own API routes.

## Project structure (fresh Next.js App Router)

```
~/vibe-desktop/
  app/
    page.tsx                      # desktop shell entry
    api/search/route.ts           # query → app result cards
    api/window/open/route.ts      # app name → initial HTML (starts session)
    api/window/patch/route.ts     # {windowId, elementId} → ops
  components/
    Desktop.tsx                   # wallpaper + window layer + taskbar
    Spotlight.tsx                 # search overlay + results grid
    WindowFrame.tsx               # Win11 glass chrome: drag/resize/min/close, hosts the iframe
    Taskbar.tsx                   # floating centered taskbar, open-window pills
  lib/
    claude.ts                     # Anthropic client + per-call config (model, thinking, caching)
    tool-schema.ts                # apply_dom_patch schema + system prompts
    sessions.ts                   # in-memory windowId → messages[] store, resync/reset helpers
    apply-ops.ts                  # client-side op applier (mirror of the op enum)
    sanitize.ts                   # HTML/attr sanitizer for raw-HTML ops
  .env.local                      # ANTHROPIC_API_KEY=...
```

## Tech stack

Next.js (App Router) + React + Tailwind CSS; official `@anthropic-ai/sdk`. No vibeOS code reused.

## Acceptance criteria (demo is "done")

1. Open the desktop → a Win11-glass wallpaper, a floating taskbar, and a Spotlight search are present.
2. Type a query → within a couple of seconds, a grid of ~6 fabricated app cards appears.
3. Click a card → a draggable/resizable glass window opens and paints a hallucinated UI for that app.
4. Click interactive elements inside the window → the UI updates correctly within ~1.5–2s per click, with state persisting across clicks (e.g. a calculator accumulates, a form keeps its rows).
5. Open several windows at once → each behaves as its own independent app.
6. `usage.cache_read_input_tokens > 0` on repeat clicks within a window (caching confirmed).
7. Network tab shows the API key is never sent to the browser; the model's `<script>` never executes.
