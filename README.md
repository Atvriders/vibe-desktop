# VibeDesktop

A local, single-user "hallucinated Windows 11" desktop. Type any app into the
Spotlight search and Claude (Haiku 4.5) generates its UI and click-by-click
behavior in real time — there is no application code behind the apps. Each window
is its own Claude conversation; clicking an element asks the model for a minimal
DOM patch, which is applied to a sandboxed iframe.

Inspired by Steve Sanderson's "Vibe OS" demo, rebuilt on the Claude API.

## Run locally (Node)

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
npm install
npm run dev          # http://localhost:3000
```

## Run with Docker Compose

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env   # docker compose reads .env
docker compose up --build                    # http://localhost:3000
```

Your Anthropic API key is only ever read server-side (Next.js API routes); it is
never sent to the browser. Generated app HTML runs in an iframe **without**
`allow-scripts`, and DOM-patch values are sanitized before they are applied.

## How it works

- `app/api/search` — turns a query into ~6 fabricated app cards.
- `app/api/window/open` — starts a per-window Claude conversation, returns the initial HTML.
- `app/api/window/patch` — appends the clicked element id, returns a flat DOM op list.
- `lib/` — the engine, prompt-cache helpers, session store, op applier, and sanitizer.
- `components/` — the Win11-glass shell: Spotlight, WindowFrame, Taskbar.

## Tests

```bash
npm test             # vitest (unit + route + component tests)
```
