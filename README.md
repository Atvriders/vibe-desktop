# VibeDesktop

**A browser-based "Windows 11" desktop where every app is hallucinated by Claude in real time — there is no application code behind any of it.**

You type the name of an app into a Spotlight search; Claude invents it and renders its UI as HTML. You click a button; Claude looks at what you clicked and renders the next screen. Open a calculator and it adds up. Open a "web browser" and type a URL — Claude hallucinates the page. None of these apps exist as code: each window is a single ongoing conversation with the model, and the model *is* the program.

It's a homage to Steve Sanderson's "Vibe OS" demo from Microsoft Build, rebuilt from scratch on the [Claude API](https://docs.claude.com).

---

## The core idea

A normal app is code: buttons wired to event handlers wired to logic. VibeDesktop has none of that. Instead:

1. **Each open window is its own Claude conversation.** When you open "Calculator", the server starts a conversation: *"You are simulating the UI of a Calculator. Output HTML. Put an id on every interactive element."* Claude returns the HTML for a calculator, and that becomes the window.
2. **A click is a message, not an event.** When you click, the host doesn't run any app logic — it tells Claude *"the user clicked here"* (the element's id **and** where on the window you clicked, as coordinates). Claude, which still has the whole window in its conversation, figures out what you clicked and replies with a small **patch** — a list of DOM edits — that the host applies to the window.
3. **State is the conversation.** The "running total" of the calculator, the rows in a form, the page you're browsing — none of it lives in a database or a variable. It lives only in the model's conversation history. Close the window and it's gone. (Sanderson called this "fake statefulness"; on the Claude API it's *literally* a client-held message array.)

So the host is a dumb courier: it forwards clicks and applies patches. Everything that looks like software is the model continuing its own story.

---

## How it works (the three round trips)

```
Browser (Next.js client)        Next.js API routes (server)        Claude API
─────────────────────────       ──────────────────────────        ──────────
Desktop shell (Win11 glass)     🔑 ANTHROPIC_API_KEY (server only) Haiku 4.5
Spotlight search                /api/search   ── query → app cards thinking: disabled
Start menu + desktop icons      /api/window/open ── app → first HTML strict apply_dom_patch tool
Sandboxed iframe per window     /api/window/patch ── click → DOM ops prompt caching
                                {windowId → messages[]} (in memory)
```

1. **Search** — you type "a synth"; `/api/search` asks Claude for ~6 made-up apps; a grid of cards appears.
2. **Open** — you click a card (or a Start-menu/desktop icon); `/api/window/open` starts that window's conversation and returns the first HTML; a window paints it.
3. **Interact** — you click element `r7` at `x=40, y=62`; `/api/window/patch` appends that to the window's conversation, and Claude returns `{ ops: [...] }` — a flat, id-addressed patch (`setText`, `setAttr`, `replaceHTML`, …) that the host applies to the iframe.

**Why a flat op-list instead of "here's the new HTML"?** It's smaller (faster, cheaper), and it's the shape Claude's structured-output mode can guarantee — the host never has to guess whether the model's reply is valid. Every op targets an element by `id`, so applying it is exact.

**Prompt caching** helps — but on Haiku it doesn't help from the first turn, and the reason is more interesting than it looks. Each window's conversation grows with every click and the whole thing is re-sent each time, so the growing prefix is a natural cache candidate. But a prefix shorter than the model's minimum simply doesn't cache — silently, with no error and `cache_creation_input_tokens: 0` — and **that minimum is not monotonic across tiers**:

| Model | Min cacheable prefix | This app's ~700-token system + tool prefix |
| --- | --- | --- |
| Claude Haiku 4.5 | **4096 tokens** | never caches on its own |
| Claude Sonnet 5 | 1024 tokens | never caches on its own |
| Claude Opus 5 | **512 tokens** | **caches from the very first turn** |

So on the default Haiku 4.5 the breakpoint on the system block never engages by itself: caching starts only once the *transcript itself* — system + tools + the accumulated renders and patches — crosses 4096 tokens, typically a few clicks into a window. On Opus 5 the fixed prefix is over the floor immediately and caches from turn one. The cheapest model has the highest bar; the most expensive has the lowest.

Once a prefix does cache it is re-read at ~0.1× input cost, against a one-time write premium of 2× — the breakpoints in `lib/cache.ts` use the 1-hour TTL, which needs at least three reads to beat no caching at all (the 5-minute default writes at 1.25× and breaks even on the second read). A click loop refreshes the entry well inside five minutes, so the 1-hour TTL is buying very little here. The telemetry chip in each title bar reports the cached-token count for every turn, so you can watch it switch on.

**Model:** Claude **Haiku 4.5** (`claude-haiku-4-5`) with thinking disabled — the fastest, cheapest tier, because this is a latency-sensitive UI loop. Expect **~1.5–2 seconds per click**: a charming, slightly-laggy hallucinated OS, not a native one — every interaction is a model round trip.

### Swapping the model

Higher tiers draw better apps. The swap is the one `MODEL` line in `lib/claude.ts` — **except on Opus 5, where the thinking config has to change too, and the reason matters** (see the warning below).

| | Haiku 4.5 | Sonnet 5 | Opus 5 |
| --- | --- | --- | --- |
| Model ID | `claude-haiku-4-5` | `claude-sonnet-5` | `claude-opus-5` |
| Price in / out per Mtok | $1 / $5 | $3 / $15 <br>($2 / $10 intro thru 2026-08-31) | $5 / $25 |
| Context | 200K | 1M | 1M |
| Min cacheable prefix | 4096 | 1024 | 512 |
| `effort` parameter | **rejected — errors** | `low`–`max` | `low`–`max` |
| Thinking config for this app | `disabled` ✅ | `disabled` ✅ | **use adaptive, not `disabled`** ⚠️ |

> ⚠️ **Do not just swap `MODEL` to `claude-opus-5` and leave `thinking: {type: "disabled"}` in place.** Both of this app's model calls that matter are *forced* tool calls — `apply_dom_patch` on every click and `app_results` on every search — and on Opus 5 with thinking disabled the model can write a tool call into its **visible text** instead of emitting a `tool_use` block. The request returns HTTP 200, nothing raises, `stop_reason` looks normal — and the call never runs. In this app that is indistinguishable from the empty-patch bug: you click, the busy pill spins, and the window doesn't change. The same configuration can also leak `<thinking>` tags into the visible response, which here means they render *inside the hallucinated app*. Use `thinking: {type: "adaptive"}` with `output_config: {effort: "low"}` instead — it costs less than it sounds like and removes both failure modes. (Related: on Opus 5 thinking is **on by default**, so omitting the field is not the same as disabling it, and `max_tokens` then caps thinking *plus* output — the `OPEN_MAX_TOKENS` budget in `lib/claude.ts` is sized for output alone.)
>
> `thinking: {type: "disabled"}` on Opus 5 is also only accepted at `effort` `high` or below — pairing it with `xhigh`/`max` is a 400.

Two smaller gotchas when you swap: `effort` is **rejected outright on Haiku 4.5**, so it can't be set uniformly across models; and Sonnet 5 uses a newer tokenizer that produces roughly 30% more tokens for the same text, so its cost per click isn't simply its price ratio against Haiku.

---

## Using it

- **Search carries your actual words into the app.** Type *"a synth with 3 oscillators and a step sequencer"* and Spotlight comes back with deliberately coined names like *"Lumefold"*. Both the card's one-line blurb **and the raw sentence you typed** ride along with the open request and are stored on the window's session — so every screen the model draws, the first one and every patch after it, is briefed with what you actually asked for instead of one invented word. Built-in apps (Start menu, desktop icons) pass their blurb the same way, so "Web Browser" opens knowing it is a browser.
- **Enter works.** Press Enter in any field the model drew — an address bar, a terminal prompt, a search box — and the host sends a *submit* turn along with every field's current value. Shift+Enter is left alone for multi-line fields. Individual keystrokes are **not** forwarded: one model round trip per keypress would be unusable.
- **The ✨ instruction bar.** Every title bar has a small ✨ field. Type anything — *"make the buttons bigger"*, *"undo that"*, *"show me the settings screen"* — and it goes to the same window conversation as a free-text instruction, through the same patch pipeline. It's also the only recovery path when a patch mangles a window, because applied ops live in the iframe and there is no undo.
- **Ctrl+K / ⌘K** toggles Spotlight; **Escape** closes Spotlight, the Start menu or the desktop context menu. Both work from inside an open app too, which takes explicit wiring: a keydown raised in a same-origin iframe does **not** propagate to the parent document, so the shell's own handler would go inert the moment you clicked into any window (and stay inert for a maximized one). `WindowFrame` watches for those two keys in the frame and re-dispatches them on the host document. Desktop icons open on a **single** click as well as on Enter/Space, so the desktop works from the keyboard and on touch — and a double-click, which a browser delivers as two `click` events, is de-duplicated into one window rather than two.
- **Minimize actually minimizes.** The amber dot hides a window without ending its conversation, and its taskbar button toggles it back. Closing is what deletes the session — that distinction is the whole point, since a window's state exists nowhere else.
- **The telemetry chip.** Each title bar shows a dim chip for the last turn — `1.7s · 4.1k cached`, or just `1.7s` before the cache engages — and the busy pill ticks elapsed seconds while the model is thinking. Latency here is the product, not a defect; the chip puts the time and the cached-token count of every click on screen instead of hiding them in `console.log`.

---

## Security & sandbox model

Everything Claude generates is untrusted by construction, so the apps run in a **pure walled sandbox**:

- **No scripts.** Generated HTML renders in an `<iframe sandbox="allow-same-origin">` **without** `allow-scripts`. Any `<script>` or `onclick` the model emits simply never executes. (`allow-same-origin` is present only so the host can read your clicks and apply patches; without `allow-scripts` the classic sandbox-escape doesn't apply.)
- **No outbound requests from generated content.** Each window's HTML is wrapped in a strict `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'`). Nothing an app draws can reach the network — no fetch, no remote image, no web font, no form submission, no `<base>` retarget. What it *can* do is inline CSS, plus whatever that CSS inlines: a `data:` URL inside a `style="…"` attribute or a model-authored `<style>` block is still fetchable, which is what `img-src data:` and `font-src data:` are there for. A `data:` URL written as an **attribute** — `<img src="data:…">` — is a different story: the attribute policy below deletes it before the CSP is ever consulted, so that one directive is doing less work than it looks like it is (see the next bullet).
- **Links can't navigate the frame off-origin.** A CSP cannot stop a frame from navigating *itself*, so the one path a strict CSP leaves open is a model-authored `<a href="http://…">`: clicking it would issue a real outbound request. What actually closes it is the host's capture-phase click listener, which calls `preventDefault()` on **every** click — a click here is a message to Claude, never an in-frame navigation, so no in-frame default is ever wanted. Two things narrow the surface further: URL-valued attributes (`href`/`src`/`action`/`formaction`/`poster`/`background`/`ping`) are refused unless the value is a `#` fragment or a `/`, `./` or `../` relative path — absolute, protocol-relative (`//host`), `mailto:`, `tel:`, `javascript:` and `data:` are all rejected — and the *initial* HTML goes through the same sanitizer as every patch, rather than straight into `srcDoc`. That allowlist is **one** function (`lib/attr-policy.ts`) called from both `applyOps` and `sanitizeHtml`, so it applies identically to a `setAttr` op and to an `<a>` buried in a `replaceHTML`/`insertHTML` payload. (It was written twice before, and the copy on the hot path was the weaker one: the link `setAttr` refused landed in the document anyway.) One practical consequence is worth stating plainly, because it is easy to misread the CSP: **`<img src="data:…">` no longer renders.** `src` is URL-valued, `data:` is not on the allowlist, and the attribute is deleted in `sanitizeHtml`/`applyOps` — so for the attribute path the CSP's `img-src data:` is unreachable, the image is gone a layer earlier. The directive is *not* dead, though, and shouldn't be removed: the allowlist governs attributes only, so `style="background-image:url(data:…)"` and a `@font-face` inside a model-authored `<style>` block sail through it untouched, and `img-src data:` / `font-src data:` are exactly what decide whether those load. Inline CSS is the surviving route to a `data:` asset; the attribute is not.
- **The "browser" never really browses.** When you type a URL into the hallucinated Web Browser, the server does **not** fetch it. Claude *imagines* the page. So the server's only outbound traffic is to the Anthropic API — there is no SSRF or LAN path through the app.
- **Sanitized patches.** Every DOM-patch payload is sanitized before it's applied: `<script>` and `<template>` elements are removed whole (a nested `<template>`'s children live in its `.content`, which `querySelectorAll` does not walk but `innerHTML` does serialize, so anything hidden in one used to come back out unscrubbed), and every attribute is run through the shared allowlist above — defense-in-depth on top of the no-scripts sandbox. A patch whose markup sanitizes down to nothing is reported as *dropped*, which queues a full-DOM resync instead of silently diverging from the model's idea of the window. So is a `setText` whose value contained tags: the text is written literally, exactly as asked, but the model believes it just rendered a `<button>`, and the resync is what corrects it.
- **Your key stays server-side.** `ANTHROPIC_API_KEY` is read only by the Next.js API routes; it is never sent to the browser.
- **Guarded API surface.** All four routes go through one shared guard (`lib/http-guard.ts`): `application/json` only, any request whose `Sec-Fetch-Site` is `cross-site` refused, bodies capped at **256 KB**, and a token bucket of **60 requests per minute**. The client stays under that body cap on purpose rather than by luck: the DOM snapshot and the harvested field values are both truncated **by UTF-8 byte length** (`lib/byte-cap.ts`) before the POST, because bytes are what `Content-Length` — and therefore the guard — counts. Capping by `String.slice` instead would let a window of CJK or emoji through at three times its apparent size, and a 413 is the one failure this loop cannot absorb: it queues a resync, which re-sends the same oversize body on every later click until the window is dead. The content-type rule is what does the real work — `application/json` is not a CORS-simple type, so it forces a preflight this app never answers, and a cross-origin `no-cors` POST can no longer bill a Claude call against your key. Two honest boundaries. First, this is *not* strict same-origin: `Sec-Fetch-Site: same-site` (a sibling subdomain) and `none` (a typed URL or a bookmark) are both allowed through. Second, the bucket is keyed on `X-Forwarded-For` and is therefore **per-IP only behind a proxy that sets it**; run directly, as `docker-compose.yml` does, every caller shares one bucket and the limit is a single global 60/min ceiling. That is deliberate — keying on a header the client can set would let anyone mint unlimited full buckets — and it is the right shape for the single-user deployment this app documents.
- **Non-persistent, and bounded.** Window state lives only in memory; nothing is written to disk. Closing a window deletes its server session and a server restart wipes everything. Sessions that were abandoned rather than closed — a shut tab, a refresh, an open that failed — are swept after **30 minutes** idle, with a hard cap of **200** live windows, so a stranded transcript can't sit in memory forever.

---

## Configure your key

The app needs exactly one secret, `ANTHROPIC_API_KEY`.

```bash
cp .env.example .env      # then open .env and paste your key
```

`.env` is git-ignored, and it is the single source for **both** ways of running the app: Next.js loads it for `npm run dev`, and Docker Compose auto-loads it for `docker compose up`.

**Nothing tracked in this repo ever contains a key.** Both compose files declare

```yaml
ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}
```

so Compose refuses to start with a clear message rather than booting a keyless container. Get a key at <https://console.anthropic.com/settings/keys>.

## Run locally (Node)

```bash
npm install
npm run dev              # http://localhost:3000 — reads .env
```

Or pass the key inline for a one-off, without writing a file:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

## Run with Docker Compose (prebuilt image)

`docker-compose.yml` pulls the image GitHub Actions publishes to GHCR on every push to `master` (`ghcr.io/atvriders/vibe-desktop:latest`). It's built for `linux/amd64` **and** `linux/arm64`, so it runs on Apple Silicon and on a Raspberry Pi as well as on x86.

```bash
cp .env.example .env     # once — paste your key
docker compose up        # pulls the image → http://localhost:3000
```

To build the image locally instead of pulling it:

```bash
docker compose -f docker-compose.dev.yml up --build
```

> The container runs as an unprivileged `nextjs` user (uid 1001) on a `node:22-alpine` base. For a hard network guarantee, run it with egress restricted to `api.anthropic.com` — the app needs no other network access.

## How it's deployed (CI → GHCR)

`.github/workflows/docker-publish.yml` runs on every push to `master`, on every pull request, and on a manual *Run workflow*:

1. **`test`** — `npm ci`, `npx tsc --noEmit`, `npm test`, then `npm audit --omit=dev --audit-level=high`.
2. **`build-and-push`** — declares `needs: test`, so a red suite can never publish. Builds the `Dockerfile` (Next.js standalone output) with Buildx + QEMU for `linux/amd64,linux/arm64` and pushes `:latest` plus a per-commit `:<sha>` tag to `ghcr.io/atvriders/vibe-desktop`. Pull requests build `linux/amd64` only and never push.

A `concurrency` group keyed on the ref cancels superseded runs. The build never calls Claude, so CI needs no API key. **The repo and its GHCR package are public and must stay public** — `docker-compose.yml` pulls the image anonymously.

`.github/dependabot.yml` opens weekly update PRs for npm dependencies and GitHub Actions. The audit step is deliberately **non-blocking**: the outstanding `next` / `postcss` / `sharp` advisories have no fix on a stable release. `npm audit fix` isn't a no-op — it would bump `next` to `16.2.12` — but `16.2.12` is still inside the vulnerable range, so it resolves none of the three; the first patched `next` is a `16.3.0-preview`, which `^16.2.7` will never select. And none of them reach this app — there are no Server Actions, no `middleware.ts`, no custom server and no `next/image` here, and `postcss` is build-time only and absent from the shipped standalone tree. The step still surfaces new advisories as a warning annotation on every run.

---

## Project structure

```
app/
  page.tsx                     desktop shell (windows, spotlight, start menu, context menu, keyboard shortcuts)
  layout.tsx, globals.css      root HTML + Tailwind
  api/search/route.ts          query → fabricated app cards
  api/window/open/route.ts     app name + blurb/query → first HTML (starts a window's conversation)
  api/window/patch/route.ts    click / right-click / Enter / ✨ instruction → DOM ops
  api/window/close/route.ts    delete a window's server session
components/
  Spotlight.tsx                search overlay + results grid
  StartMenu.tsx, DesktopIcons.tsx, DesktopContextMenu.tsx   launchers + right-click menu
  WindowFrame.tsx              glass window: sandboxed iframe, click/Enter→patch, ✨ instruction bar, telemetry chip, drag clamp, boot screen
  Taskbar.tsx, Clock.tsx       taskbar with start/search, running windows, tray + live clock
lib/
  engine.ts                    searchApps / openWindow / patchWindow (builds Claude requests)
  tool-schema.ts               system prompts + the apply_dom_patch / app_results tool schemas
  claude.ts                    the one Anthropic client (mocked in tests)
  sessions.ts                  in-memory windowId → conversation store, with TTL sweep + cap
  apply-ops.ts                 applies a DOM op list to the iframe (client-side)
  attr-policy.ts               the one attribute allowlist, shared by apply-ops and sanitize
  sanitize.ts, sandbox-doc.ts  HTML sanitizer + the strict-CSP iframe wrapper
  http-guard.ts                shared route guard: JSON-only, cross-site refused, body cap, rate limit
  cache.ts                     prompt-cache breakpoint helpers (1h ephemeral)
  types.ts, html.ts            shared types + prompt-length clamps; code-fence stripper
  geometry.ts, builtin-apps.ts viewport clamp + the built-in app list
docs/superpowers/              the specs and implementation plans this was built from
```

---

## Honest limitations (by design)

- **It's slow-ish.** ~1.5–2s per click on Haiku — a model round trip every time (see [Swapping the model](#swapping-the-model) for higher fidelity, and read the Opus 5 warning there before you do). Great for a demo, not a daily driver.
- **No published per-model latency numbers here.** Latency for this workload is dominated by your network path, region, and time of day, so a single measurement from one machine wouldn't generalize — and inventing a table would be worse than having none. The telemetry chip in each title bar is the honest measurement: it reports the real round-trip time and cached-token count for every click on *your* connection, which is the number that actually applies to you.
- **It hallucinates.** Apps are plausible, not correct. The calculator can be wrong; the "facts" in a hallucinated browser are invented. That's the whole joke.
- **State drifts.** Over a long session the model's idea of the window can drift from what's on screen; the app periodically re-syncs the real DOM back to the model to correct it, and reseeds the transcript from that snapshot so a long-lived window doesn't walk into the context limit.
- **Single-user, local, ephemeral.** No accounts, no persistence, no multi-user. Run it with your own key and have fun.

## Tests

```bash
npm test             # vitest — unit (lib), route (mocked SDK), and component (RTL) tests
npx tsc --noEmit     # typecheck
npm run build        # production build; emits .next/standalone/server.js
```

---

Built spec-first: see `docs/superpowers/specs/` for the designs and `docs/superpowers/plans/` for the step-by-step implementation plans this project was generated from.
