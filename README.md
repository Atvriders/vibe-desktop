# VibeDesktop

A local, single-user "hallucinated Windows 11" desktop. Type any app into the
Spotlight search and Claude (Haiku 4.5) generates its UI and click-by-click
behavior in real time — there is no application code behind the apps. Each window
is its own Claude conversation; clicking an element asks the model for a minimal
DOM patch, which is applied to a sandboxed iframe.

Inspired by Steve Sanderson's "Vibe OS" demo, rebuilt on the Claude API.

## Run locally (Node)

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev    # http://localhost:3000
```

## Run with Docker Compose (prebuilt GHCR image)

`docker-compose.yml` pulls the image that GitHub Actions publishes on every push
to `master` (`ghcr.io/atvriders/vibe-desktop:latest`). Open `docker-compose.yml`,
replace `sk-ant-REPLACE_WITH_YOUR_KEY` with your Anthropic API key, then:

```bash
docker compose up        # pulls the image -> http://localhost:3000
```

Build the image locally instead of pulling it:

```bash
docker compose -f docker-compose.dev.yml up --build
```

> **Keep your key local — this repo is public.** After pasting your key into
> `docker-compose.yml`, run `git update-index --skip-worktree docker-compose.yml`
> so git ignores the change and you can't accidentally commit it.

> The published image only exists after the **Build and publish Docker image**
> workflow has run on `master` at least once (automatically on push to `master`,
> or manually via the Actions tab -> Run workflow). The GHCR package is public.

Your Anthropic API key is only ever read server-side (Next.js API routes); it is
never sent to the browser. Generated app HTML runs in an iframe **without**
`allow-scripts`, and DOM-patch values are sanitized before they are applied.

## How it works

- `app/api/search` — turns a query into ~6 fabricated app cards.
- `app/api/window/open` — starts a per-window Claude conversation, returns the initial HTML.
- `app/api/window/patch` — appends the clicked element id, returns a flat DOM op list.
- `lib/` — the engine, prompt-cache helpers, session store, op applier, and sanitizer.
- `components/` — the Win11-glass shell: Spotlight, WindowFrame, Taskbar.

> Prompt caching only engages once a window's system prompt + initial HTML exceeds Haiku's ~2048-token minimum cacheable prefix, so `cache_read_input_tokens` may be 0 on very small apps.

## Tests

```bash
npm test             # vitest (unit + route + component tests)
```
