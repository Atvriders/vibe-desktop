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

**Prompt caching** keeps it affordable: each window's conversation grows with every click, and the whole thing is re-sent each time, so the stable prefix (the system prompt + the first render) is cached and re-read at ~0.1× input cost instead of full price.

**Model:** Claude **Haiku 4.5** with thinking disabled — the fastest, cheapest tier, because this is a latency-sensitive UI loop. Expect **~1.5–2 seconds per click**: a charming, slightly-laggy hallucinated OS, not a native one — every interaction is a model round trip. (Swap the one `MODEL` line in `lib/claude.ts` to `claude-sonnet-4-6` or `claude-opus-4-8` for higher-fidelity apps at ~2–5× the latency/cost.)

---

## Security & sandbox model

Everything Claude generates is untrusted by construction, so the apps run in a **pure walled sandbox**:

- **No scripts.** Generated HTML renders in an `<iframe sandbox="allow-same-origin">` **without** `allow-scripts`. Any `<script>` or `onclick` the model emits simply never executes. (`allow-same-origin` is present only so the host can read your clicks and apply patches; without `allow-scripts` the classic sandbox-escape doesn't apply.)
- **No network — not even your LAN.** Each window's HTML is wrapped with a strict `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`). An app can render inline styles and `data:` images and *nothing else* — it cannot fetch, load an image, submit a form, or reach any host on your network or the internet.
- **The "browser" never really browses.** When you type a URL into the hallucinated Web Browser, the server does **not** fetch it. Claude *imagines* the page. So the server's only outbound traffic is to the Anthropic API — there is no SSRF or LAN path through the app.
- **Sanitized patches.** DOM-patch values are sanitized (scripts, `on*` handlers, `javascript:`/`data:` URLs on URL attributes are stripped) before they're applied — defense-in-depth on top of the no-scripts sandbox.
- **Your key stays server-side.** `ANTHROPIC_API_KEY` is read only by the Next.js API routes; it is never sent to the browser.
- **Non-persistent.** Window state lives only in memory; nothing is written to disk. Closing a window deletes its server session, and a server restart wipes everything.

---

## Run locally (Node)

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev    # http://localhost:3000
```

No `.env` file needed — the key is just an environment variable for the dev server.

## Run with Docker Compose (prebuilt image)

`docker-compose.yml` pulls the image that GitHub Actions publishes to GHCR on every push to `master` (`ghcr.io/atvriders/vibe-desktop:latest`). Open `docker-compose.yml`, replace `sk-ant-REPLACE_WITH_YOUR_KEY` with your key, then:

```bash
docker compose up        # pulls the image → http://localhost:3000
```

To build the image locally instead of pulling it:

```bash
docker compose -f docker-compose.dev.yml up --build
```

> **Keep your key out of git — this repo is public.** After pasting your key into `docker-compose.yml`, run
> `git update-index --skip-worktree docker-compose.yml` so the edit can't be committed. (Secret-scanning push protection is also enabled on the repo as a backstop.)
>
> For a hard network guarantee, run the container with egress restricted to `api.anthropic.com` — the app needs no other network access.

## How it's deployed (CI → GHCR)

`.github/workflows/docker-publish.yml` builds the `Dockerfile` (Next.js standalone output) and pushes a public image to `ghcr.io/atvriders/vibe-desktop` (`:latest` + a per-commit tag) on every push to `master` or via a manual *Run workflow*. The build never calls Claude, so CI needs no API key. `docker-compose.yml` consumes that published image.

---

## Project structure

```
app/
  page.tsx                     desktop shell (windows, spotlight, start menu, context menu)
  layout.tsx, globals.css      root HTML + Tailwind
  api/search/route.ts          query → fabricated app cards
  api/window/open/route.ts     app name → first HTML (starts a window's conversation)
  api/window/patch/route.ts    click/right-click (id + coords + field values) → DOM ops
  api/window/close/route.ts    delete a window's server session
components/
  Spotlight.tsx                search overlay + results grid
  StartMenu.tsx, DesktopIcons.tsx, DesktopContextMenu.tsx   launchers + right-click menu
  WindowFrame.tsx              glass window: sandboxed iframe, click→patch, drag clamp, boot screen
  Taskbar.tsx, Clock.tsx       taskbar with start/search, running windows, tray + live clock
lib/
  engine.ts                    searchApps / openWindow / patchWindow (builds Claude requests)
  tool-schema.ts               system prompts + the apply_dom_patch / app_results tool schemas
  claude.ts                    the one Anthropic client (mocked in tests)
  sessions.ts                  in-memory windowId → conversation store
  apply-ops.ts                 applies a DOM op list to the iframe (client-side)
  sanitize.ts, sandbox-doc.ts  HTML sanitizer + the strict-CSP iframe wrapper
  cache.ts                     prompt-cache breakpoint helpers
  geometry.ts, builtin-apps.ts viewport clamp + the built-in app list
docs/superpowers/              the spec and implementation plans this was built from
```

---

## Honest limitations (by design)

- **It's slow-ish.** ~1.5–2s per click on Haiku — a model round trip every time (swap to Sonnet/Opus in `lib/claude.ts` for higher fidelity). Great for a demo, not a daily driver.
- **It hallucinates.** Apps are plausible, not correct. The calculator can be wrong; the "facts" in a hallucinated browser are invented. That's the whole joke.
- **State drifts.** Over a long session the model's idea of the window can drift from what's on screen; the app periodically re-syncs the real DOM back to the model to correct it.
- **Single-user, local, ephemeral.** No accounts, no persistence, no multi-user. Run it with your own key and have fun.

## Tests

```bash
npm test             # vitest — unit (lib), route (mocked SDK), and component (RTL) tests
```

---

Built spec-first: see `docs/superpowers/specs/` for the designs and `docs/superpowers/plans/` for the step-by-step implementation plans this project was generated from.
