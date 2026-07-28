# Ops and Docs — Secrets, CI, Container, Build Layout, README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the Anthropic API key out of every git-tracked file, put a test gate and a multi-arch build in front of the GHCR publish, harden the container (supported base + non-root), make the standalone build layout deterministic and self-checking, and correct every false or stale claim in the README.

**Architecture:** Five independent ops surfaces, each fixed in isolation. Secrets move from hardcoded compose values to Compose's required-variable interpolation (`${VAR:?msg}`) fed by a git-ignored `.env` that the repo ships a template for. CI grows a `test` job that the existing `build-and-push` job now `needs:`. The Dockerfile moves to `node:22-alpine`, gains an unprivileged `nextjs` user, and asserts its own output layout at build time. `next.config.ts` pins `turbopack.root` so the standalone output can never nest. The README is rewritten to match what the code actually does after the other four plans land.

**Tech Stack:** Docker / Docker Compose (Compose spec v2 interpolation), GitHub Actions (`docker/build-push-action@v6`, Buildx + QEMU), Dependabot v2, Next.js 16.2.7 (Turbopack, `output: "standalone"`), Node 22 LTS, Markdown.

## Global Constraints

- Baseline is commit `7a48390`, **17 test files / 56 tests passing**, `npx tsc --noEmit` clean. Never leave the suite red.
- **ONE commit at the very end of ALL five plans**, after full verification (`npx tsc --noEmit` + `npm test` + `npm run build`). The final step of every task below is **Verify**, never Commit. Do **not** write `git add` or `git commit` into any step.
- This plan creates two files that are currently untracked: `.env.example` and `.github/dependabot.yml`. Both are non-ignored (verified: `git check-ignore .env.example` exits 1), so the single final commit must stage them — use `git add -A` when that commit is finally made by whoever closes out all five plans.
- **This plan has no unit tests of its own.** Its red/green cycles are real, runnable shell assertions (`node -e` / `python3 -c` / `grep` / `test -f`) plus `npm run build`. Do not add files under `lib/`, `components/` or `app/` — another plan owns every one of those.
- **File ownership — this plan may modify ONLY these files:** `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example` (new), `.github/workflows/docker-publish.yml`, `.github/dependabot.yml` (new), `next.config.ts`, `README.md`. Every other file in the repo belongs to another plan; do not touch them, not even to fix something you notice.
- **Do NOT rewrite git history.** No real key was ever committed — only the placeholder string `sk-ant-REPLACE_WITH_YOUR_KEY`. Fix the pattern, leave history alone.
- **Do NOT chase the current `next` / `postcss` / `sharp` advisories.** Verified on this tree by running the commands: `npm audit --omit=dev --audit-level=high` exits 1 with 3 high (`next` `9.3.4-canary.0 - 16.3.0-preview.7`, `postcss <=8.5.17`, `sharp <0.35.0`). `npm audit fix --dry-run --omit=dev` is **not** a no-op — it reports `added 62 packages, changed 4 packages` (it would bump `next` `16.2.7` → `16.2.12`, the current `latest` dist-tag) — but it **resolves none of the three advisories**, because `16.2.12` is still inside the vulnerable range. The first `next` release above that range is `16.3.0-preview.8`, a prerelease that `^16.2.7` will never resolve to. `postcss` is build-time only and absent from the shipped standalone tree, and every `next` advisory needs a surface this app lacks (no Server Actions, no `middleware.ts`, no custom server, no `next/image`). The audit step is therefore advisory-only.
- **The repo and its GHCR package are public and must stay public.** `docker-compose.yml` pulls `ghcr.io/atvriders/vibe-desktop:latest` anonymously; making the package private breaks every user.
- **Keep the existing image tags and cache exactly as they are:** `ghcr.io/atvriders/vibe-desktop:latest` and `ghcr.io/atvriders/vibe-desktop:${{ github.sha }}`, `cache-from: type=gha`, `cache-to: type=gha,mode=max`.
- All three Dockerfile stages move to `node:22-alpine` (Node 20 went EOL 2026-04-30).
- Never put a real LAN IP, hostname or host path into a tracked file. Placeholders only.
- Markdown/YAML style: 2-space indent, no trailing whitespace, keep the README's existing voice (second person, em dashes, bold lead-ins on bullets).
- `docker` is **not installed** on the development machine used to write this plan (`which docker` → nothing). Every task that names `docker build` / `docker compose` states an equivalent static assertion to run when Docker is absent. Do not skip the assertion just because Docker is missing.

### Cross-plan dependencies (read before starting)

**Tasks 1–5 depend on nothing and can run at any time — they touch no file any other plan
owns and import no symbol from `lib/`, `app/` or `components/`. Task 6 (the README) must run
LAST, after the other four plans have landed**, because it documents behavior they implement.
It states these numbers and strings, which are frozen elsewhere and must match byte-for-byte:

| README claim | Owner | Frozen value |
| --- | --- | --- |
| sessions swept after **30 minutes**, cap **200** | Plan 1 `lib/sessions.ts` | `SESSION_TTL_MS = 30 * 60 * 1000`, `SESSION_MAX = 200` |
| bodies capped at **256 KB**, same-origin + JSON-only + per-IP bucket | Plan 4 `lib/http-guard.ts` | `MAX_BODY_BYTES = 256 * 1024` |
| the CSP directive list quoted in "Security & sandbox model" | Plan 2 `lib/sandbox-doc.ts` | `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'` |
| `preventDefault()` on every in-frame click; initial HTML sanitized | Plan 3 `components/WindowFrame.tsx` | Task 12 there |
| the `setAttr` URL allowlist (relative and `#` only) | Plan 2 `lib/apply-ops.ts` | Task 5 there |
| the telemetry chip text `1.7s · 4.1k cached` | Plan 3 `formatUsage` | Task 13 there — **no price component** |
| blurb + query reach the window's whole life | Plan 1 `WINDOW_SYSTEM(appName, detail?)` | Task 2 there |
| Enter → submit turn; ✨ instruction bar; Ctrl+K / Escape; minimize | Plan 3 | Tasks 5, 10, 11 there |

If any of those change, this README changes with them. Nothing in any other plan depends on
this one.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `.env.example` | **create** | The only place a key placeholder lives. Documents `ANTHROPIC_API_KEY` and the `cp .env.example .env` flow. Tracked, contains no secret value. |
| `docker-compose.yml` | modify | Prebuilt-image runner. Sources the key from the environment via `${ANTHROPIC_API_KEY:?…}` instead of hardcoding it. |
| `docker-compose.dev.yml` | modify | Local-build runner. Same key change. |
| `next.config.ts` | modify | Pins `turbopack.root` to this directory so `output: "standalone"` always emits `.next/standalone/server.js` at the flat path the Dockerfile's `CMD` assumes. |
| `Dockerfile` | modify | Three stages on `node:22-alpine`; build stage asserts the flat standalone layout; runner stage runs as unprivileged `nextjs` (uid 1001). |
| `.github/workflows/docker-publish.yml` | modify | Adds a `test` job (install / typecheck / test / advisory audit), makes `build-and-push` depend on it, adds `pull_request` + `concurrency`, and builds `linux/amd64,linux/arm64`. |
| `.github/dependabot.yml` | **create** | Weekly npm + github-actions update PRs. |
| `README.md` | modify | Corrects the prompt-caching claim (line 41) and the "No network — not even your LAN" claim (line 52), replaces the "paste your key into docker-compose.yml" instructions, documents the CI gate, and adds a "Using it" section covering search-detail passthrough, Enter, the ✨ instruction bar, Ctrl+K/Escape, minimize and the telemetry chip. |

**Task order matters.** Task 2 and Task 3 both edit `Dockerfile`; Task 3 shows the complete expected file so line drift is impossible. Task 6 asserts, repo-wide, that Tasks 1–5 left no placeholder key behind.

---

### Task 1: Secrets out of every tracked file (G1)

**Files:**
- Create: `.env.example`
- Modify: `docker-compose.yml:7-10` (the `environment:` block)
- Modify: `docker-compose.dev.yml:6-9` (the `environment:` block)
- Test: no test file — shell assertions below

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the environment-variable contract `ANTHROPIC_API_KEY`, sourced from a git-ignored `.env` in the repo root, consumed by (a) Docker Compose interpolation in both compose files and (b) Next.js's automatic `.env` loading for `npm run dev`. Task 6's README documents exactly this flow with the literal command `cp .env.example .env`.

Current state, verified:

```
docker-compose.yml:10       ANTHROPIC_API_KEY: "sk-ant-REPLACE_WITH_YOUR_KEY"
docker-compose.dev.yml:9    ANTHROPIC_API_KEY: "sk-ant-REPLACE_WITH_YOUR_KEY"
```

`.gitignore` already contains `.env` and `.env*.local`, and `.env.example` is **not** ignored (`git check-ignore -v .env.example` exits 1). Compose auto-loads `.env` from the project directory and uses it for `${…}` interpolation.

- [ ] **Step 1: Write the failing check**

Save nothing — run this exact command from `/home/kasm-user/vibe-desktop`:

```bash
node -e '
const fs = require("fs");
let bad = 0;
for (const f of ["docker-compose.yml", "docker-compose.dev.yml"]) {
  const t = fs.readFileSync(f, "utf8");
  if (t.includes("sk-ant-REPLACE_WITH_YOUR_KEY")) { console.error("FAIL " + f + ": hardcodes the placeholder key"); bad++; }
  if (!t.includes("${ANTHROPIC_API_KEY:?")) { console.error("FAIL " + f + ": no required-env interpolation"); bad++; }
}
if (!fs.existsSync(".env.example")) { console.error("FAIL: .env.example does not exist"); bad++; }
if (bad) { console.error(bad + " failure(s)"); process.exit(1); }
console.log("OK: the key comes from the environment, and .env.example exists");
'
```

- [ ] **Step 2: Run it and see it fail**

Run the command from Step 1.
Expected: exit 1, with exactly these five `FAIL` lines plus the summary line on stderr (six lines total):

```
FAIL docker-compose.yml: hardcodes the placeholder key
FAIL docker-compose.yml: no required-env interpolation
FAIL docker-compose.dev.yml: hardcodes the placeholder key
FAIL docker-compose.dev.yml: no required-env interpolation
FAIL: .env.example does not exist
5 failure(s)
```

- [ ] **Step 3: Create `.env.example`**

Write `/home/kasm-user/vibe-desktop/.env.example` with exactly this content:

```
# VibeDesktop needs one secret. Copy this file and paste your key into the copy:
#
#   cp .env.example .env
#
# .env is git-ignored (see .gitignore). This repo is PUBLIC — never put a real
# key in a tracked file, and never edit docker-compose.yml to hold one.
#
# The same .env feeds both ways of running the app:
#   npm run dev        Next.js loads .env automatically
#   docker compose up  Compose loads .env automatically for ${...} interpolation
#
# Get a key: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=
```

The value is deliberately empty: Compose's `:?` form fails loudly on unset **or empty**, so a user who copies the file and forgets to paste gets a clear error instead of a container that boots and 500s on the first click.

- [ ] **Step 4: Rewrite the `environment:` block in `docker-compose.yml`**

Replace lines 7–10 (`    environment:` through the `ANTHROPIC_API_KEY:` line) so the whole file reads:

```yaml
services:
  vibe-desktop:
    image: ghcr.io/atvriders/vibe-desktop:latest
    pull_policy: always
    ports:
      - "3000:3000"
    environment:
      # Read from your shell or from the git-ignored .env file — never hardcoded.
      # Compose refuses to start if it is unset or empty. See .env.example.
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}
    restart: unless-stopped
```

The interpolation is intentionally unquoted. Verified with `yaml.safe_load`: an unquoted scalar beginning with `$` and containing `:?` and an em dash parses to the literal string `${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}`.

- [ ] **Step 5: Rewrite the `environment:` block in `docker-compose.dev.yml`**

Replace lines 6–9 so the whole file reads:

```yaml
services:
  vibe-desktop:
    build: .
    ports:
      - "3000:3000"
    environment:
      # Read from your shell or from the git-ignored .env file — never hardcoded.
      # Compose refuses to start if it is unset or empty. See .env.example.
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}
    restart: unless-stopped
```

- [ ] **Step 6: Run the check and see it pass**

Run the Step 1 command again.
Expected: exit 0 and the single line `OK: the key comes from the environment, and .env.example exists`.

- [ ] **Step 7: Prove the YAML still parses and the `:?` semantics are what we want**

Note the **single** quotes around the `python3 -c` argument — with double quotes the shell would try to expand `${ANTHROPIC_API_KEY:?…}` itself before Python ever saw it.

```bash
python3 -c '
import yaml
for f in ["docker-compose.yml", "docker-compose.dev.yml"]:
    d = yaml.safe_load(open(f))
    v = d["services"]["vibe-desktop"]["environment"]["ANTHROPIC_API_KEY"]
    assert v.startswith("${ANTHROPIC_API_KEY:?"), (f, v)
    assert "sk-ant" not in v, (f, v)
    print(f, "->", v)
print("both compose files parse and interpolate")
'
( unset ANTHROPIC_API_KEY; bash -c 'echo "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}"' ); echo "EXIT=$?"
```

Expected: both files print

```
docker-compose.yml -> ${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}
docker-compose.dev.yml -> ${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env — see .env.example}
both compose files parse and interpolate
```

then the subshell prints `bash: line 1: ANTHROPIC_API_KEY: set ANTHROPIC_API_KEY in .env — see .env.example` on stderr and `EXIT=127` (bash's exit code for an unset-parameter expansion error). Docker Compose implements the same `:?` semantics with its own wording — `error while interpolating services.vibe-desktop.environment.ANTHROPIC_API_KEY: required variable ANTHROPIC_API_KEY is missing a value: set ANTHROPIC_API_KEY in .env — see .env.example`, exit 1. The point being proved is the fail-closed behavior, not the exact string.

- [ ] **Step 8: Verify**

```bash
cd /home/kasm-user/vibe-desktop
grep -rn "sk-ant-REPLACE_WITH_YOUR_KEY" docker-compose.yml docker-compose.dev.yml .env.example ; echo "grep exit=$? (1 = clean)"
npx tsc --noEmit && npm test
```

Expected: `grep exit=1 (1 = clean)`, `tsc` silent, and `Test Files 17 passed (17) / Tests 56 passed (56)` (higher counts are fine once other plans have landed their tests; the number must never go **down** and no test may fail).

If Docker is available on your machine, additionally run `docker compose config` with and without a key to see the guard work; if it is not installed, the Step 7 bash subshell is the equivalent proof and is sufficient.

---

### Task 2: Deterministic standalone build layout (G4)

**Files:**
- Modify: `next.config.ts:2` (the single `nextConfig` line)
- Modify: `Dockerfile:12` (append an assertion immediately after `RUN npm run build`)
- Test: no test file — `npm run build` plus a `test -f` assertion

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the guarantee that `npm run build` emits `.next/standalone/server.js` at the **flat** path. `Dockerfile`'s runner stage (`COPY --from=build /app/.next/standalone ./` + `CMD ["node", "server.js"]`, rewritten in Task 3) depends on this exact path. Task 3 must keep the assertion line it adds here.

Why this is real and not theoretical, verified on this tree:

- `/home/kasm-user/package-lock.json` exists one directory above the repo.
- `npm run build` today prints, verbatim (four lines, note the leading space on the continuation lines):

  ```
  ⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
   We detected multiple lockfiles and selected the directory of /home/kasm-user/package-lock.json as the root directory.
   To silence this warning, set `turbopack.root` in your Next.js config, or consider removing one of the lockfiles if it's not needed.
     See https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory for more information.
  ```

- and emits **`.next/standalone/vibe-desktop/server.js`** — nested. `CMD ["node", "server.js"]` would fail with `Cannot find module '/app/server.js'` at container start.
- With `turbopack: { root: import.meta.dirname }` the warning disappears and the output is `.next/standalone/server.js` — flat. Also confirmed `npx tsc --noEmit` stays clean with `import.meta.dirname` under this `tsconfig.json` (`"module": "esnext"`, `"moduleResolution": "bundler"`).
- `TurbopackOptions.root?: string` is a real field in `node_modules/next/dist/server/config-shared.d.ts` for Next 16.2.7.

- [ ] **Step 1: Write the failing check**

```bash
cd /home/kasm-user/vibe-desktop
rm -rf .next/standalone
npm run build > /tmp/vd-build.log 2>&1; echo "build exit=$?"
if test -f .next/standalone/server.js; then
  echo "PASS: flat standalone layout"
else
  echo "FAIL: server.js is not at .next/standalone/server.js — found at:"
  find .next/standalone -maxdepth 3 -name server.js
  exit 1
fi
grep -c "We detected multiple lockfiles" /tmp/vd-build.log
```

- [ ] **Step 2: Run it and see it fail**

Run the Step 1 block.
Expected on a machine with a stray parent lockfile (this one has `/home/kasm-user/package-lock.json`):

```
build exit=0
FAIL: server.js is not at .next/standalone/server.js — found at:
.next/standalone/vibe-desktop/server.js
```

If your machine has **no** parent lockfile the check will already print `PASS` and `grep -c` will print `0`. Make the change anyway — the point is that the layout must not depend on what happens to sit above the checkout. In that case treat Step 6's `grep -c … = 0` and the presence of `turbopack.root` in `next.config.ts` as the passing evidence.

- [ ] **Step 3: Pin the Turbopack root**

Replace the entire contents of `/home/kasm-user/vibe-desktop/next.config.ts` with:

```ts
import type { NextConfig } from "next";
// Pin the workspace root. Without it, a lockfile in any parent directory makes
// Turbopack infer that directory as the root and emit the standalone output at
// .next/standalone/<pkg-name>/server.js — but the Dockerfile copies the tree flat
// and runs `node server.js`, so the container would start and immediately die.
const nextConfig: NextConfig = { output: "standalone", turbopack: { root: import.meta.dirname } };
export default nextConfig;
```

- [ ] **Step 4: Run the check and see it pass**

```bash
cd /home/kasm-user/vibe-desktop
rm -rf .next/standalone
npm run build > /tmp/vd-build.log 2>&1; echo "build exit=$?"
test -f .next/standalone/server.js && echo "PASS: flat standalone layout"
grep -c "We detected multiple lockfiles" /tmp/vd-build.log
```

Expected:

```
build exit=0
PASS: flat standalone layout
0
```

(`grep -c` printing `0` exits 1; that is expected and is not a failure of this step.)

- [ ] **Step 5: Make the Dockerfile assert the same thing**

In `/home/kasm-user/vibe-desktop/Dockerfile`, insert two comment lines and one `RUN` immediately after line 12 (`RUN npm run build`), so the build stage reads:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Fail here, not at container start: if the standalone output ever nests
# (.next/standalone/<pkg-name>/server.js) the runner's CMD ["node","server.js"] breaks.
RUN test -f /app/.next/standalone/server.js
```

Leave the `FROM node:20-alpine` lines alone — Task 3 bumps all three together.

- [ ] **Step 6: Verify**

```bash
cd /home/kasm-user/vibe-desktop
node -e '
const fs = require("fs");
const cfg = fs.readFileSync("next.config.ts", "utf8");
const df  = fs.readFileSync("Dockerfile", "utf8");
let bad = 0;
if (!/turbopack:\s*\{\s*root:\s*import\.meta\.dirname\s*\}/.test(cfg)) { console.error("FAIL: next.config.ts does not pin turbopack.root"); bad++; }
if (!df.includes("RUN test -f /app/.next/standalone/server.js")) { console.error("FAIL: Dockerfile has no standalone layout assertion"); bad++; }
if (bad) process.exit(1);
console.log("OK: build layout is pinned and self-checking");
'
npx tsc --noEmit && npm test
test -f .next/standalone/server.js && echo "flat layout confirmed"
```

Expected: `OK: build layout is pinned and self-checking`, `tsc` silent, the suite green (≥ 17 files / 56 tests, none failing), and `flat layout confirmed`.

---

### Task 3: Container hardening — supported base + non-root runner (G3, first half)

**Files:**
- Modify: `Dockerfile` — lines 2, 7 and 14 (`FROM node:20-alpine`), and the runner stage's three `COPY` lines plus a new `RUN adduser` and `USER nextjs`
- Test: no test file — shell assertions plus `docker build` where available

**Interfaces:**
- Consumes: `RUN test -f /app/.next/standalone/server.js` from Task 2 — keep it exactly as Task 2 left it.
- Produces: an image whose entrypoint process runs as uid 1001 (`nextjs:nodejs`) on `node:22-alpine`. Task 5's CI builds this Dockerfile for `linux/amd64,linux/arm64`; Task 6's README states "runs as an unprivileged `nextjs` user (uid 1001) on a `node:22-alpine` base" — those three facts must stay in sync.

Current state, verified: `Dockerfile:2`, `:7` and `:14` are all `FROM node:20-alpine` (Node 20 reached end-of-life 2026-04-30), and the runner stage has no `USER` directive, so `node server.js` runs as root.

`node:22-alpine` ships a `node` user at uid/gid 1000, so 1001 is free. BusyBox `addgroup`/`adduser` in Alpine accept `-S` (system), `-g GID`, `-u UID` and `-G GROUP` — this is the pattern in Next.js's own official standalone Dockerfile.

- [ ] **Step 1: Write the failing check**

```bash
cd /home/kasm-user/vibe-desktop
node -e '
const fs = require("fs");
const df = fs.readFileSync("Dockerfile", "utf8");
const lines = df.split("\n");
let bad = 0;
if (df.includes("node:20-alpine")) { console.error("FAIL: Dockerfile still targets the EOL node:20-alpine base"); bad++; }
const n22 = (df.match(/FROM node:22-alpine/g) || []).length;
if (n22 !== 3) { console.error("FAIL: expected 3 node:22-alpine stages, found " + n22); bad++; }
if (!df.includes("RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs")) { console.error("FAIL: no unprivileged nextjs user is created"); bad++; }
const chown = (df.match(/--chown=nextjs:nodejs/g) || []).length;
if (chown !== 3) { console.error("FAIL: expected 3 --chown=nextjs:nodejs COPY lines, found " + chown); bad++; }
const iUser = lines.findIndex((l) => l.trim() === "USER nextjs");
const iExpose = lines.findIndex((l) => l.trim() === "EXPOSE 3000");
if (iUser === -1) { console.error("FAIL: no USER nextjs directive — the runner still runs as root"); bad++; }
else if (iUser > iExpose) { console.error("FAIL: USER nextjs must come before EXPOSE 3000"); bad++; }
if (!df.includes("RUN test -f /app/.next/standalone/server.js")) { console.error("FAIL: Task 2 layout assertion was lost"); bad++; }
if (bad) process.exit(1);
console.log("OK: node:22-alpine everywhere, runner runs as nextjs (uid 1001)");
'
```

- [ ] **Step 2: Run it and see it fail**

Run the Step 1 command.
Expected: exit 1 with

```
FAIL: Dockerfile still targets the EOL node:20-alpine base
FAIL: expected 3 node:22-alpine stages, found 0
FAIL: no unprivileged nextjs user is created
FAIL: expected 3 --chown=nextjs:nodejs COPY lines, found 0
FAIL: no USER nextjs directive — the runner still runs as root
```

(If you also see `FAIL: Task 2 layout assertion was lost`, Task 2 has not been done yet — go do it first; Task 3 must not be the thing that introduces that line.)

- [ ] **Step 3: Rewrite the Dockerfile**

Replace the entire contents of `/home/kasm-user/vibe-desktop/Dockerfile` with exactly this (it already includes Task 2's assertion — do not drop it):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Fail here, not at container start: if the standalone output ever nests
# (.next/standalone/<pkg-name>/server.js) the runner's CMD ["node","server.js"] breaks.
RUN test -f /app/.next/standalone/server.js

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# uid/gid 1000 are taken by the image's own `node` user; 1001 is free.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

The `--chown` on all three COPYs matters beyond tidiness. Verified on this tree: `.next/standalone/` contains `.next/`, `node_modules/`, `package.json` and `server.js`, so `/app/.next` is created by the **first** COPY (the standalone tree), not the second — which is exactly why the first COPY needs `--chown` too. With all three chowned, `/app/.next` is owned by `nextjs` and the standalone server can create `.next/cache` at runtime instead of crashing on a parent directory it does not own.

- [ ] **Step 4: Run the check and see it pass**

Run the Step 1 command again.
Expected: exit 0 and `OK: node:22-alpine everywhere, runner runs as nextjs (uid 1001)`.

- [ ] **Step 5: Build the image if Docker is available**

```bash
cd /home/kasm-user/vibe-desktop
if command -v docker >/dev/null 2>&1; then
  docker build -t vibe-desktop:verify .
  docker run --rm --entrypoint sh vibe-desktop:verify -c 'id -un; id -u; ls -l /app/server.js'
else
  echo "docker not installed — static assertions in Step 1 + CI (Task 5) cover this"
fi
```

Expected with Docker: the build succeeds (the `RUN test -f …` layer passes), and the run prints `nextjs`, `1001`, and a listing showing `/app/server.js` owned by `nextjs nodejs`.
Expected without Docker (the case on this machine): the single fallback line. Do not treat the missing binary as a pass for the *content* checks — Step 1 is what proves those.

- [ ] **Step 6: Verify**

```bash
cd /home/kasm-user/vibe-desktop
grep -n "^FROM\|^USER\|--chown\|RUN test -f\|^RUN addgroup" Dockerfile
npx tsc --noEmit && npm test
```

Expected: the grep lists three `FROM node:22-alpine` stages, one `RUN addgroup …`, three `--chown=nextjs:nodejs` COPYs, one `RUN test -f /app/.next/standalone/server.js` and one `USER nextjs`; `tsc` silent; suite green (≥ 17 files / 56 tests, none failing).

---

### Task 4: Dependabot (G3, second half)

**Files:**
- Create: `.github/dependabot.yml`
- Test: no test file — a YAML-schema assertion

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: weekly automated update PRs for the `npm` and `github-actions` ecosystems at the repo root. Task 6's README states this in the "How it's deployed" section; keep the two ecosystem names and the `weekly` interval in sync with it.

Current state, verified: `.github` contains exactly one file, `.github/workflows/docker-publish.yml`. There is no `dependabot.yml`.

- [ ] **Step 1: Write the failing check**

```bash
cd /home/kasm-user/vibe-desktop
python3 -c "
import os, sys, yaml
p = '.github/dependabot.yml'
if not os.path.exists(p):
    print('FAIL: ' + p + ' does not exist'); sys.exit(1)
d = yaml.safe_load(open(p))
bad = 0
if d.get('version') != 2:
    print('FAIL: version must be 2, got ' + repr(d.get('version'))); bad += 1
ecos = {u['package-ecosystem']: u for u in d.get('updates', [])}
for name in ('npm', 'github-actions'):
    if name not in ecos:
        print('FAIL: no updates entry for ' + name); bad += 1
    elif ecos[name]['schedule']['interval'] != 'weekly':
        print('FAIL: ' + name + ' interval is not weekly'); bad += 1
sys.exit(1 if bad else 0)
" && echo "OK: dependabot covers npm + github-actions weekly"
```

- [ ] **Step 2: Run it and see it fail**

Run the Step 1 command.
Expected: exit 1 with the single line `FAIL: .github/dependabot.yml does not exist` and **no** `OK:` line.

- [ ] **Step 3: Create the file**

Write `/home/kasm-user/vibe-desktop/.github/dependabot.yml` with exactly this content:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      npm-minor-and-patch:
        patterns:
          - "*"
        update-types:
          - "minor"
          - "patch"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
```

Minor and patch npm bumps are grouped into one PR so a weekly run produces one review, not fifteen; majors still arrive as individual PRs because they need a human to read the changelog.

- [ ] **Step 4: Run the check and see it pass**

Run the Step 1 command again.
Expected: exit 0 and `OK: dependabot covers npm + github-actions weekly`.

- [ ] **Step 5: Verify**

```bash
cd /home/kasm-user/vibe-desktop
python3 -c "import yaml,json; print(json.dumps(yaml.safe_load(open('.github/dependabot.yml')), indent=2))"
git status --short .github/dependabot.yml
npx tsc --noEmit && npm test
```

Expected: the parsed YAML prints with `"version": 2` and two `updates` entries; `git status --short` shows `?? .github/dependabot.yml` (untracked and **not** ignored — the single final commit must pick it up); `tsc` silent; suite green.

---

### Task 5: CI test gate, PR trigger, concurrency, multi-arch build (G2 + the audit half of G3)

**Files:**
- Modify: `.github/workflows/docker-publish.yml` (currently 38 lines: checkout → login → buildx → build-push, with no tests)
- Test: no test file — a YAML-structure assertion plus running the test job's commands locally

**Interfaces:**
- Consumes: the `Dockerfile` as Tasks 2 and 3 left it (`node:22-alpine`, layout assertion, non-root runner) and the repo's existing npm scripts — `npm test` is `vitest run`, `npm run build` is `next build` (see `package.json:8-14`). There is **no** `lint` script and no eslint in `devDependencies`; do not invent one.
- Produces: a `test` job that `build-and-push` declares `needs: test`, so a red suite can never publish `:latest`. Image tags, GHCR registry and gha cache are unchanged. Task 6's README describes this pipeline; keep the two in sync.

Verified facts that shape this task:

- `npm audit --omit=dev --audit-level=high` **exits 1 today** (3 high: `next`, `postcss`, `sharp`). `npm audit fix --dry-run --omit=dev` would change the tree (`added 62 packages, changed 4 packages` — it bumps `next` to `16.2.12`) but still ends on `3 high severity vulnerabilities`, because `16.2.12` is inside the vulnerable range `9.3.4-canary.0 - 16.3.0-preview.7`; the first `next` above that range is `16.3.0-preview.8`, a prerelease `^16.2.7` will never select. The step is therefore added with `continue-on-error: true`: it surfaces new advisories as a warning annotation on every run without wedging the publish pipeline on advisories the spec explicitly decided not to chase.
- `linux/arm64` on a GitHub-hosted amd64 runner needs `docker/setup-qemu-action@v3` before Buildx, or the arm64 leg fails with `exec format error`.
- On a pull request, `secrets.GITHUB_TOKEN` has no `packages: write` for forks, so the login step is gated and `push:` is false; PRs still build `linux/amd64` to prove the Dockerfile compiles, without paying for an emulated arm64 build on every push to a branch.
- `yaml.safe_load` parses the `on:` key as Python boolean `True` (verified). The assertion below handles that.

- [ ] **Step 1: Write the failing check**

```bash
cd /home/kasm-user/vibe-desktop
python3 -c "
import sys, yaml
d = yaml.safe_load(open('.github/workflows/docker-publish.yml'))
trig = d.get(True, d.get('on'))
jobs = d.get('jobs', {})
bad = []
if 'pull_request' not in trig: bad.append('no pull_request trigger')
if 'push' not in trig or trig['push'].get('branches') != ['master']: bad.append('push:branches[master] trigger changed or missing')
c = d.get('concurrency')
if not c: bad.append('no concurrency group')
elif c.get('cancel-in-progress') is not True or 'github.ref' not in str(c.get('group')): bad.append('concurrency not keyed on the ref with cancel-in-progress')
t = jobs.get('test')
if not t: bad.append('no test job')
else:
    runs = ' ; '.join(s.get('run', '') for s in t['steps'])
    for cmd in ('npm ci', 'npx tsc --noEmit', 'npm test', 'npm audit --omit=dev --audit-level=high'):
        if cmd not in runs: bad.append('test job never runs: ' + cmd)
b = jobs.get('build-and-push')
if not b: bad.append('build-and-push job disappeared')
else:
    if b.get('needs') != 'test' and b.get('needs') != ['test']: bad.append('build-and-push does not need: test')
    bp = [s for s in b['steps'] if str(s.get('uses','')).startswith('docker/build-push-action')]
    if not bp: bad.append('no build-push step')
    else:
        w = bp[0]['with']
        if 'platforms' not in w or 'linux/arm64' not in str(w['platforms']): bad.append('build does not target linux/arm64')
        if 'ghcr.io/atvriders/vibe-desktop:latest' not in str(w['tags']): bad.append('the :latest tag was lost')
        if 'github.sha' not in str(w['tags']): bad.append('the per-commit tag was lost')
        if w.get('cache-from') != 'type=gha' or w.get('cache-to') != 'type=gha,mode=max': bad.append('the gha cache config was lost')
    if not any(str(s.get('uses','')).startswith('docker/setup-qemu-action') for s in b['steps']): bad.append('no QEMU setup — the arm64 leg will fail')
for m in bad: print('FAIL: ' + m)
sys.exit(1 if bad else 0)
" && echo "OK: CI tests before it publishes, and publishes multi-arch"
```

- [ ] **Step 2: Run it and see it fail**

Run the Step 1 command.
Expected: exit 1, no `OK:` line, and exactly these six lines (verified against the current workflow):

```
FAIL: no pull_request trigger
FAIL: no concurrency group
FAIL: no test job
FAIL: build-and-push does not need: test
FAIL: build does not target linux/arm64
FAIL: no QEMU setup — the arm64 leg will fail
```

- [ ] **Step 3: Rewrite the workflow**

Replace the entire contents of `/home/kasm-user/vibe-desktop/.github/workflows/docker-publish.yml` with exactly this:

```yaml
name: Build and publish Docker image

on:
  push:
    branches: [master]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install
        run: npm ci

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Unit, route and component tests
        run: npm test

      # Advisory only, on purpose. The outstanding next/postcss/sharp advisories have
      # no fix on a stable release (`npm audit fix` is a no-op; the first patched next
      # is a 16.3.0-preview) and none of them reach this app — no Server Actions, no
      # middleware.ts, no custom server, no next/image, and postcss is build-time only
      # and absent from the shipped standalone tree. This step surfaces NEW advisories
      # as a warning annotation without wedging the publish pipeline.
      - name: Audit production dependencies (advisory)
        continue-on-error: true
        run: npm audit --omit=dev --audit-level=high

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # Required for the linux/arm64 leg on an amd64 runner.
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          # Pull requests build to prove the Dockerfile still compiles, but never push
          # (a fork's GITHUB_TOKEN has no packages:write) and skip the slow emulated arm64 leg.
          push: ${{ github.event_name != 'pull_request' }}
          platforms: ${{ github.event_name == 'pull_request' && 'linux/amd64' || 'linux/amd64,linux/arm64' }}
          tags: |
            ghcr.io/atvriders/vibe-desktop:latest
            ghcr.io/atvriders/vibe-desktop:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Nothing here changes the GHCR package's visibility. The package is **public** and must stay public — `docker-compose.yml` pulls it anonymously.

- [ ] **Step 4: Run the check and see it pass**

Run the Step 1 command again.
Expected: exit 0 and `OK: CI tests before it publishes, and publishes multi-arch`.

- [ ] **Step 5: Run the test job's commands locally**

```bash
cd /home/kasm-user/vibe-desktop
npx tsc --noEmit; echo "tsc exit=$?"
npm test;          echo "test exit=$?"
npm audit --omit=dev --audit-level=high; echo "audit exit=$? (1 today — this is why the step is continue-on-error)"
```

Expected: `tsc exit=0`, `test exit=0` with the suite green, and `audit exit=1` listing `next`, `postcss` and `sharp` as high. That non-zero audit exit is the whole justification for `continue-on-error: true`; if it ever becomes `0`, the `continue-on-error` line can be dropped in a follow-up (not in this plan).

Note the audit output ends with `fix available via \`npm audit fix\`` — **do not run it.** Verified: `npm audit fix --dry-run --omit=dev` reports `added 62 packages, changed 4 packages` and still finishes on `3 high severity vulnerabilities`. The "fix" is a bump to `next@16.2.12`, which is still inside the vulnerable range. Leave the dependency tree alone; this plan does not touch `package.json` or `package-lock.json`.

- [ ] **Step 6: Verify**

```bash
cd /home/kasm-user/vibe-desktop
python3 -c "
import yaml, json
d = yaml.safe_load(open('.github/workflows/docker-publish.yml'))
print('triggers:', sorted(str(k) for k in (d.get(True) or d.get('on'))))
print('jobs:', list(d['jobs']))
print('needs:', d['jobs']['build-and-push']['needs'])
print('concurrency:', d['concurrency'])
"
npx tsc --noEmit && npm test
```

Expected: `triggers: ['pull_request', 'push', 'workflow_dispatch']`, `jobs: ['test', 'build-and-push']`, `needs: test`, a concurrency mapping keyed on `github.ref` with `cancel-in-progress: True`; `tsc` silent; suite green (≥ 17 files / 56 tests, none failing).

---

### Task 6: README — correct the two false claims, document the new behavior, repo-wide secret sweep

**Files:**
- Modify: `README.md` — full rewrite (138 lines today). The specific corrections are at `README.md:41` (prompt caching), `README.md:52` (network claim), `README.md:56` (persistence), `README.md:60-67` (run locally), `README.md:69-86` (Docker Compose + the "paste your key into docker-compose.yml" note), `README.md:88-90` (CI), `README.md:96-119` (project structure).
- Test: no test file — content assertions plus the repo-wide placeholder sweep

**Interfaces:**
- Consumes: everything Tasks 1–5 produced (`cp .env.example .env`, `node:22-alpine` + uid 1001, the `test` → `build-and-push` gate, `linux/amd64,linux/arm64`, weekly Dependabot), plus these **frozen-contract** facts owned by other plans, which the README states as numbers and must match exactly:
  - `SESSION_TTL_MS = 30 * 60 * 1000` and `SESSION_MAX = 200` (`lib/sessions.ts`, Plan 1)
  - `MAX_BODY_BYTES = 256 * 1024` (`lib/http-guard.ts`, Plan 4)
  - `AppDetail { blurb?: string; query?: string }` threaded through `openWindow(appName, detail?)` (Plan 1)
  - `PatchInput.action?: 'click' | 'contextmenu' | 'submit'` and `PatchInput.instruction?: string` (Plan 1, consumed by Plan 3)
  - `CallUsage { ms, inputTokens, outputTokens, cacheReadTokens }` behind the title-bar telemetry chip (Plan 1 + Plan 3)
- Produces: no code. The README is the last artifact; nothing depends on it.

The two claims being corrected, quoted from the current file:

- `README.md:41` — *"**Prompt caching** keeps it affordable: … the stable prefix (the system prompt + the first render) is cached and re-read at ~0.1× input cost instead of full price."* False from the first turn: Haiku 4.5's minimum cacheable prefix is 4096 tokens and this app's system prompt + tool schema is ~700, so the breakpoint on the system block never engages on its own.
- `README.md:52` — *"**No network — not even your LAN.** … it cannot fetch, load an image, submit a form, or reach any host on your network or the internet."* False for a model-authored `<a href="http://…">` until Plan 2 and Plan 3 land: no CSP directive governs a frame navigating *itself*, and the capture-phase click listener never called `preventDefault()`.

- [ ] **Step 1: Write the failing check**

```bash
cd /home/kasm-user/vibe-desktop
node -e '
const fs = require("fs");
const r = fs.readFileSync("README.md", "utf8");
const mustGo = [
  ["sk-ant-REPLACE_WITH_YOUR_KEY", "still tells users to paste a key into docker-compose.yml"],
  ["No network — not even your LAN", "still makes the false blanket no-network claim"],
  ["git update-index --skip-worktree", "still recommends skip-worktree instead of .env"],
  ["No `.env` file needed", "still says no .env file is needed"],
  ["**Prompt caching** keeps it affordable", "still claims caching pays from the first turn"],
];
const mustHave = [
  ["cp .env.example .env", "the .env workflow"],
  ["4096", "the real minimum cacheable prefix"],
  ["preventDefault", "how link navigation is actually blocked"],
  ["form-action 'none'", "the hardened CSP"],
  ["base-uri 'none'", "the hardened CSP"],
  ["Ctrl+K", "the Spotlight shortcut"],
  ["✨", "the instruction bar"],
  ["Enter", "the submit path"],
  ["telemetry chip", "the per-turn cost/latency readout"],
  ["linux/amd64,linux/arm64", "the multi-arch image"],
  ["needs: test", "the CI test gate"],
  ["node:22-alpine", "the supported base image"],
  ["30 minutes", "the session TTL"],
  ["http-guard.ts", "the shared route guard in the project structure"],
];
let bad = 0;
for (const [s, why] of mustGo)   if (r.includes(s)) { console.error("FAIL: README " + why + " (found " + JSON.stringify(s) + ")"); bad++; }
for (const [s, why] of mustHave) if (!r.includes(s)) { console.error("FAIL: README never mentions " + why + " (missing " + JSON.stringify(s) + ")"); bad++; }
if (bad) { console.error(bad + " failure(s)"); process.exit(1); }
console.log("OK: README matches the shipped behavior");
'
```

- [ ] **Step 2: Run it and see it fail**

Run the Step 1 command.
Expected: exit 1, with 5 `FAIL: README still …` lines and 14 `FAIL: README never mentions …` lines, ending in `19 failure(s)`.

- [ ] **Step 3: Rewrite `README.md`**

Replace the entire contents of `/home/kasm-user/vibe-desktop/README.md` with exactly this:

`````markdown
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

**Prompt caching** helps — but not from the first turn, and it's worth being precise about why. Each window's conversation grows with every click and the whole thing is re-sent each time, so the growing prefix is a natural cache candidate. But **Haiku 4.5's minimum cacheable prefix is 4096 tokens**, and this app's system prompt plus tool schema is only ~700. The cache breakpoint on the system block therefore never engages on its own: caching starts only once the *transcript itself* — system + tools + the accumulated renders and patches — crosses 4096 tokens, typically a few clicks into a window. From then on that prefix is re-read at ~0.1× input cost instead of full price. The telemetry chip in each title bar reports the cached-token count for every turn, so you can watch it switch on.

**Model:** Claude **Haiku 4.5** with thinking disabled — the fastest, cheapest tier, because this is a latency-sensitive UI loop. Expect **~1.5–2 seconds per click**: a charming, slightly-laggy hallucinated OS, not a native one — every interaction is a model round trip. (Swap the one `MODEL` line in `lib/claude.ts` to `claude-sonnet-4-6` or `claude-opus-4-8` for higher-fidelity apps at ~2–5× the latency/cost.)

---

## Using it

- **Search carries your actual words into the app.** Type *"a synth with 3 oscillators and a step sequencer"* and Spotlight comes back with deliberately coined names like *"Lumefold"*. Both the card's one-line blurb **and the raw sentence you typed** ride along with the open request and are stored on the window's session — so every screen the model draws, the first one and every patch after it, is briefed with what you actually asked for instead of one invented word. Built-in apps (Start menu, desktop icons) pass their blurb the same way, so "Web Browser" opens knowing it is a browser.
- **Enter works.** Press Enter in any field the model drew — an address bar, a terminal prompt, a search box — and the host sends a *submit* turn along with every field's current value. Shift+Enter is left alone for multi-line fields. Individual keystrokes are **not** forwarded: one model round trip per keypress would be unusable.
- **The ✨ instruction bar.** Every title bar has a small ✨ field. Type anything — *"make the buttons bigger"*, *"undo that"*, *"show me the settings screen"* — and it goes to the same window conversation as a free-text instruction, through the same patch pipeline. It's also the only recovery path when a patch mangles a window, because applied ops live in the iframe and there is no undo.
- **Ctrl+K / ⌘K** toggles Spotlight from anywhere; **Escape** closes Spotlight, the Start menu or the desktop context menu. Desktop icons open on a single click as well as on Enter/Space, so the desktop works from the keyboard and on touch, not just via double-click.
- **Minimize actually minimizes.** The amber dot hides a window without ending its conversation, and its taskbar button toggles it back. Closing is what deletes the session — that distinction is the whole point, since a window's state exists nowhere else.
- **The telemetry chip.** Each title bar shows a dim chip for the last turn — `1.7s · 4.1k cached`, or just `1.7s` before the cache engages — and the busy pill ticks elapsed seconds while the model is thinking. Latency here is the product, not a defect; the chip puts the time and the cached-token count of every click on screen instead of hiding them in `console.log`.

---

## Security & sandbox model

Everything Claude generates is untrusted by construction, so the apps run in a **pure walled sandbox**:

- **No scripts.** Generated HTML renders in an `<iframe sandbox="allow-same-origin">` **without** `allow-scripts`. Any `<script>` or `onclick` the model emits simply never executes. (`allow-same-origin` is present only so the host can read your clicks and apply patches; without `allow-scripts` the classic sandbox-escape doesn't apply.)
- **No outbound requests from generated content.** Each window's HTML is wrapped in a strict `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'`). An app can render inline styles and `data:` images and nothing else — no fetch, no remote image, no web font, no form submission, no `<base>` retarget.
- **Links can't navigate the frame off-origin.** A CSP cannot stop a frame from navigating *itself*, so the one path a strict CSP leaves open is a model-authored `<a href="http://…">`: clicking it would issue a real outbound request. What actually closes it is the host's capture-phase click listener, which calls `preventDefault()` on **every** click — a click here is a message to Claude, never an in-frame navigation, so no in-frame default is ever wanted. Two things narrow the surface further: a patch that sets a URL attribute (`setAttr` on `href`/`src`/…) is dropped unless the value is relative or a `#` fragment — absolute, protocol-relative, `mailto:`, `tel:`, `javascript:` and `data:` are all refused — and the *initial* HTML now goes through the same sanitizer as every patch, rather than straight into `srcDoc`. Note the honest boundary: the sanitizer strips `<script>`, `on*` handlers and `javascript:` values but does **not** enforce the URL allowlist inside an HTML payload, so an absolute `href` can still land in the document via `replaceHTML`/`insertHTML`. It cannot navigate, because of `preventDefault()`.
- **The "browser" never really browses.** When you type a URL into the hallucinated Web Browser, the server does **not** fetch it. Claude *imagines* the page. So the server's only outbound traffic is to the Anthropic API — there is no SSRF or LAN path through the app.
- **Sanitized patches.** Every DOM-patch payload is sanitized (`<script>` elements, `on*` handlers and `javascript:` values are stripped) before it's applied, and `setAttr` on a URL-valued attribute is dropped outright unless the value is relative or `#…` — defense-in-depth on top of the no-scripts sandbox. A patch whose markup sanitizes down to nothing is reported as *dropped*, which queues a full-DOM resync instead of silently diverging from the model's idea of the window.
- **Your key stays server-side.** `ANTHROPIC_API_KEY` is read only by the Next.js API routes; it is never sent to the browser.
- **Guarded API surface.** All four routes go through one shared guard: same-origin only, `application/json` only, request bodies capped at 256 KB, and a per-IP token bucket. A cross-origin `no-cors` POST can no longer bill a Claude call against your key.
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
  sanitize.ts, sandbox-doc.ts  HTML sanitizer + the strict-CSP iframe wrapper
  http-guard.ts                shared route guard: same-origin, JSON-only, body cap, rate limit
  cache.ts                     prompt-cache breakpoint helpers
  geometry.ts, builtin-apps.ts viewport clamp + the built-in app list
docs/superpowers/              the specs and implementation plans this was built from
```

---

## Honest limitations (by design)

- **It's slow-ish.** ~1.5–2s per click on Haiku — a model round trip every time (swap to Sonnet/Opus in `lib/claude.ts` for higher fidelity). Great for a demo, not a daily driver.
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
`````

- [ ] **Step 4: Run the check and see it pass**

Run the Step 1 command again.
Expected: exit 0 and `OK: README matches the shipped behavior`.

- [ ] **Step 5: Sweep the whole repo for the placeholder key**

```bash
cd /home/kasm-user/vibe-desktop
if git ls-files --cached --others --exclude-standard -z \
   | xargs -0 grep -Iln "sk-ant-REPLACE_WITH_YOUR_KEY" 2>/dev/null | grep -v "^docs/superpowers/"; then
  echo "FAIL: the placeholder key still appears in a file git would commit"
  exit 1
else
  echo "OK: sk-ant-REPLACE_WITH_YOUR_KEY appears in no committable file outside docs/"
fi
```

Expected: `OK: sk-ant-REPLACE_WITH_YOUR_KEY appears in no committable file outside docs/`.
`--cached --others --exclude-standard` covers tracked files **and** the two new untracked ones (`.env.example`, `.github/dependabot.yml`) while respecting `.gitignore`, so your real `.env` / `.env.local` are correctly excluded. The `docs/superpowers/` exclusion is deliberate: the spec and this plan quote the old string as evidence, and that is the point of them.

- [ ] **Step 6: Verify**

```bash
cd /home/kasm-user/vibe-desktop
grep -n "4096\|preventDefault\|cp .env.example .env\|needs: test\|node:22-alpine\|linux/amd64,linux/arm64\|30 minutes\|256 KB" README.md
npx tsc --noEmit && npm test && npm run build
test -f .next/standalone/server.js && echo "flat standalone layout confirmed"
```

Expected: the grep prints a hit for each corrected claim; `tsc` silent; suite green (≥ 17 files / 56 tests, none failing); `npm run build` exits 0 with **no** "multiple lockfiles" warning; and `flat standalone layout confirmed`.

---

## Whole-plan verification

Run after Task 6, from `/home/kasm-user/vibe-desktop`:

```bash
npx tsc --noEmit                                   # silent
npm test                                           # green, ≥ 17 files / 56 tests
npm run build                                      # exit 0, no lockfile warning
test -f .next/standalone/server.js && echo "flat"  # flat
git ls-files --cached --others --exclude-standard -z \
  | xargs -0 grep -Iln "sk-ant-REPLACE_WITH_YOUR_KEY" | grep -v "^docs/superpowers/" \
  || echo "no placeholder key in any committable file"
if command -v docker >/dev/null 2>&1; then          # `&&…||` would swallow a real build failure
  docker build -t vibe-desktop:verify . || echo "DOCKER BUILD FAILED — fix before committing"
else
  echo "docker unavailable — CI (Task 5) covers the image build"
fi
git status --short                                  # must show ?? .env.example and ?? .github/dependabot.yml
```

**Do not commit here.** All five plans converge on a single commit made after every plan's verification passes; whoever makes it must use `git add -A` so the two new untracked files are included.
