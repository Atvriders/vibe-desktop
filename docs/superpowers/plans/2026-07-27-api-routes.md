# API Routes: Request Guard, Validation, and Typed Error Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a single shared request guard in front of all four API handlers, teach `/api/window/open` to accept and forward the `blurb`/`query` detail, and replace the blanket `catch → 502` in every route with the frozen, most-specific-first error mapping.

**Architecture:** One new dependency-light module, `lib/http-guard.ts`, exports `guardRequest(req)` (a synchronous pre-flight that returns a rejection `Response` or `null`) and `errorResponse(e, verb)` (the Anthropic-SDK-typed status mapper). Every route handler becomes the same four-part shape: guard → validate body fields → call the engine → map thrown errors. The rate limiter is a per-IP token bucket in a module-level `Map` hung off `globalThis`, exactly the pattern `lib/sessions.ts:3-6` already uses so Next.js dev HMR does not reset it.

**Tech Stack:** Next.js 16 app router (`runtime = "nodejs"` route handlers), TypeScript strict, `@anthropic-ai/sdk` 0.102.0 error classes, Vitest 4 + jsdom.

## Global Constraints

- Next.js 16 app router, React 19, TypeScript, Tailwind v4, Vitest + jsdom + Testing Library.
- Tests are **colocated** next to source: `lib/foo.ts` → `lib/foo.test.ts`; all four route handlers share `app/api/routes.test.ts`. **Never create a `tests/` directory.**
- Run one file: `npx vitest run lib/http-guard.test.ts`. Whole suite: `npm test`. Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- Baseline is commit `7a48390`, **17 test files / 56 tests passing**, `npx tsc --noEmit` clean. Never leave the suite red.
- Style: 2-space indent, double quotes, semicolons, named exports, **no default exports in `lib/`**. Terse comments only where the reasoning is non-obvious. Match the surrounding code.
- **Commit policy — this overrides the writing-plans skill's default.** The user's standing preference is ONE commit at the very end of ALL FIVE plans, after full verification. Every task here ends with **Verify**, never Commit. Do **not** write `git add` or `git commit` at any point.
- Never put real LAN IPs or hostnames in tests. All test IPs below are RFC 5737 documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).

### Frozen shared contract this plan implements

```ts
// lib/http-guard.ts  (owned by THIS plan, NEW file)
export function guardRequest(req: Request): Response | null   // null == allowed
export const MAX_BODY_BYTES = 256 * 1024
```

Frozen HTTP contract (this plan implements it; Plan 3 — the client — consumes it):

- `POST /api/search`       req `{ query }`                                  → 200 `{ cards }`
- `POST /api/window/open`  req `{ appName, blurb?, query? }`                → 200 `{ windowId, html, usage }`
- `POST /api/window/patch` req `{ windowId, elementId, x, y, action?, inputs?, domSnapshot?, instruction? }` → 200 `{ ops, stopReason, usage }`
- `POST /api/window/close` req `{ windowId }`                               → 200 `{ ok: true }`

Error status mapping, checked most-specific-first:

| condition | status | body |
| --- | --- | --- |
| `guardRequest` rejection | whatever it returned (400 / **403** / 413 / 429) | — |

> **Documented extension to the frozen contract's parenthetical.** The frozen mapping row
> reads "whatever guardRequest returned (400 / 413 / 429)". The rule — routes return the
> guard's `Response` untouched — is honored exactly; the enumeration is one status short,
> because the spec's F2 mandates **four** gates (same-origin, `application/json`, 256KB body,
> token bucket) and the same-origin gate needs a status of its own. `403` is that status;
> `400`/`413`/`429` do not fit "cross-site". This is the only deviation in this plan, it is
> additive, and Plan 3 already handles it: `WindowFrame` special-cases 404 and routes every
> other failure status to the same `BANNER_UNAVAILABLE` banner, so no client change is
> needed. Plan 3's Global Constraints lists 403 explicitly. **Do not renumber it without
> updating Plan 3's error list in the same pass.**
| missing/invalid body field | 400 | `{ error: "<field> required" }` |
| `UnknownWindowError` | 404 | `{ error: "unknown window" }` |
| Anthropic `RateLimitError`, or any `APIError` with `status === 529` | 503 | `{ error: "overloaded" }` |
| Anthropic `APIConnectionError` (incl. `APIConnectionTimeoutError`) | 504 | `{ error: "timeout" }` |
| anything else (incl. `TruncatedResponseError`) | 502 | `{ error: "<verb> failed" }` |

### Cross-plan dependency (read before starting Task 5)

Tasks **1, 2, 3, 4 and 7 have no cross-plan dependencies** — run them any time.

Tasks **5 and 6 require Plan 1 (`lib/types.ts`, `lib/engine.ts`) to have landed first**, because they import and call:

```ts
// lib/types.ts        — Plan 1
export interface AppDetail { blurb?: string; query?: string }
export interface CallUsage { ms: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }
// lib/engine.ts       — Plan 1
export class UnknownWindowError extends Error {}
export class TruncatedResponseError extends Error {}
export function openWindow(appName: string, detail?: AppDetail): Promise<{ windowId: string; html: string; usage: CallUsage }>
export interface PatchInput { elementId?: string | null; x: number; y: number; action?: "click" | "contextmenu" | "submit"; inputs?: Record<string, string>; domSnapshot?: string; instruction?: string }
export function patchWindow(windowId: string, input: PatchInput): Promise<{ ops: RawOp[]; usage: CallUsage; stopReason: string | null }>
export const MAX_QUERY_LEN = 500
export const MAX_BLURB_LEN = 200
export const MAX_SNAPSHOT_LEN = 200_000
```

The **vitest runs in Tasks 5 and 6 pass regardless** — `app/api/routes.test.ts` mocks `@/lib/engine` entirely (including a locally-declared `TruncatedResponseError` class, so nothing in the test file imports the real one). Only `npx tsc --noEmit` needs Plan 1. Run against the current tree, these are the **exact and complete** errors each task produces — verified by compiling both files against the pre-Plan-1 `lib/engine.ts`:

```
# after Task 5, before Plan 1
app/api/window/open/route.ts(4,15): error TS2305: Module '"@/lib/types"' has no exported member 'AppDetail'.
app/api/window/open/route.ts(28,29): error TS2339: Property 'usage' does not exist on type '{ windowId: string; html: string; }'.
app/api/window/open/route.ts(28,65): error TS2554: Expected 1 arguments, but got 2.

# after Task 6, before Plan 1
app/api/window/patch/route.ts(31,30): error TS2339: Property 'usage' does not exist on type '{ ops: RawOp[]; cacheReadTokens: number; stopReason: string | null; }'.
app/api/window/patch/route.ts(35,7): error TS2322: Type '"click" | "contextmenu" | "submit"' is not assignable to type '"click" | "contextmenu" | undefined'.
  Type '"submit"' is not assignable to type '"click" | "contextmenu" | undefined'.
```

Note there is **no** error for the `instruction` property: TypeScript suppresses the excess-property check on that object literal because the literal already failed on `action`. Once Plan 1 widens `PatchInput`, all five errors disappear together.

That is the signal to land Plan 1, not a defect in this plan. Do not "fix" it by reverting to the old signature.

### Boundary note — length caps are NOT this plan's job

WP-A caps `query` at 500 chars and `blurb` at 200, trims both, and collapses newlines. Those constants (`MAX_QUERY_LEN`, `MAX_BLURB_LEN`) live in `lib/engine.ts`, which **Plan 1 owns**. The route validates **type only** (string or absent) and passes the raw strings through. Task 5 includes a test that pins this boundary so nobody double-implements the cap. The 256KB body guard from Task 1 is what bounds the payload at the HTTP layer.

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `lib/http-guard.ts` | **Create** | The only module that decides whether a request is allowed to bill a Claude call, and the only module that knows the Anthropic error class → HTTP status mapping. Exports `guardRequest`, `MAX_BODY_BYTES`, `errorResponse`. No imports from `lib/engine` or `lib/sessions` — its only import is the SDK's error classes. |
| `lib/http-guard.test.ts` | **Create** | Colocated unit tests for the guard's four gates, the token bucket's refill/per-IP/HMR-survival/prune behavior, and every branch of `errorResponse`. |
| `app/api/search/route.ts` | Modify (currently 18 lines) | `POST /api/search`: guard → require string `query` → `searchApps` → typed error mapping. |
| `app/api/window/open/route.ts` | Modify (currently 18 lines) | `POST /api/window/open`: guard → require string `appName`, accept optional string `blurb`/`query` → build `AppDetail` → `openWindow(appName, detail)` → return `{ windowId, html, usage }` → typed error mapping. |
| `app/api/window/patch/route.ts` | Modify (currently 29 lines) | `POST /api/window/patch`: guard → validate `windowId`/`x`/`y`/`domSnapshot`/`instruction`, normalize `action` and `inputs` → `patchWindow` → return `{ ops, stopReason, usage }` → `UnknownWindowError` 404 first, then typed error mapping. |
| `app/api/window/close/route.ts` | Modify (currently 10 lines) | `POST /api/window/close`: guard → require string `windowId` → `deleteSession` → 200 `{ ok: true }`. |
| `app/api/routes.test.ts` | Modify (currently 54 lines) | The shared route test file. Gains a unique-IP request helper (so the real token bucket can never starve a later test), a `TruncatedResponseError` entry in the engine mock, and per-route coverage of guard rejection, field validation and every error status. |

**Not owned by this plan — do not edit:** `lib/types.ts`, `lib/engine.ts`, `lib/sessions.ts`, `lib/claude.ts`, `lib/tool-schema.ts`, `lib/cache.ts` (Plan 1); `lib/apply-ops.ts`, `lib/sanitize.ts`, `lib/sandbox-doc.ts` (Plan 2); `app/page.tsx`, `components/**` (Plan 3).

---

## Task 1: `lib/http-guard.ts` — content-type, cross-site and body-size gates

**Why:** All four handlers today go straight to `await req.json()` with no checks — `app/api/search/route.ts:7`, `app/api/window/open/route.ts:7`, `app/api/window/patch/route.ts:8`, `app/api/window/close/route.ts:7`. A cross-origin `fetch(..., { mode: "no-cors", headers: { "content-type": "text/plain" } })` is a **CORS-simple** request: the browser sends it without a preflight, the response is opaque to the attacker, but the server still runs the handler and bills a Claude call. Rejecting a non-JSON content-type kills that attack outright, because `application/json` is *not* a CORS-simple content type and therefore forces a preflight the route never answers.

**Files:**
- Create: `lib/http-guard.ts`
- Test: `lib/http-guard.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const MAX_BODY_BYTES = 256 * 1024;
  export function guardRequest(req: Request): Response | null; // null == allowed
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/http-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { guardRequest, MAX_BODY_BYTES } from "./http-guard";

// RFC 5737 documentation addresses. Every test uses its own address so the
// per-IP token bucket added in Task 2 can never starve a later test.
function req(headers: Record<string, string>): Request {
  return new Request("http://test/api/window/open", { method: "POST", headers, body: "{}" });
}
function jsonReq(ip: string): Request {
  return req({ "content-type": "application/json", "x-forwarded-for": ip });
}

describe("guardRequest — content type", () => {
  it("allows a plain application/json POST", () => {
    expect(guardRequest(jsonReq("192.0.2.1"))).toBeNull();
  });

  it("allows application/json with a charset parameter", () => {
    const res = guardRequest(req({ "content-type": "application/json; charset=utf-8", "x-forwarded-for": "192.0.2.2" }));
    expect(res).toBeNull();
  });

  it("rejects the CORS-simple text/plain body with 400", async () => {
    const res = guardRequest(req({ "content-type": "text/plain", "x-forwarded-for": "192.0.2.3" }));
    expect(res?.status).toBe(400);
    expect(await res!.json()).toEqual({ error: "expected application/json" });
  });

  it("rejects a request with no content-type header at all with 400", () => {
    const bare = new Request("http://test/api", { method: "POST", headers: { "x-forwarded-for": "192.0.2.4" } });
    expect(bare.headers.get("content-type")).toBeNull();
    expect(guardRequest(bare)?.status).toBe(400);
  });

  it("rejects a string body sent with no explicit content-type (fetch defaults it to text/plain)", () => {
    const b = new Request("http://test/api", { method: "POST", headers: { "x-forwarded-for": "192.0.2.5" }, body: "{}" });
    expect(b.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(guardRequest(b)?.status).toBe(400);
  });
});

describe("guardRequest — cross-site origin", () => {
  it("rejects Sec-Fetch-Site: cross-site with 403", async () => {
    const res = guardRequest(req({ "content-type": "application/json", "sec-fetch-site": "cross-site", "x-forwarded-for": "192.0.2.6" }));
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ error: "cross-site request rejected" });
  });

  it("allows same-origin, same-site and none", () => {
    ["same-origin", "same-site", "none"].forEach((site, i) => {
      const res = guardRequest(req({ "content-type": "application/json", "sec-fetch-site": site, "x-forwarded-for": `192.0.2.1${i}` }));
      expect(res).toBeNull();
    });
  });
});

describe("guardRequest — body size", () => {
  it("MAX_BODY_BYTES is 256KB", () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it("rejects a content-length over MAX_BODY_BYTES with 413", async () => {
    const res = guardRequest(req({
      "content-type": "application/json",
      "content-length": String(MAX_BODY_BYTES + 1),
      "x-forwarded-for": "192.0.2.20",
    }));
    expect(res?.status).toBe(413);
    expect(await res!.json()).toEqual({ error: "body too large" });
  });

  it("allows a content-length exactly at MAX_BODY_BYTES", () => {
    const res = guardRequest(req({
      "content-type": "application/json",
      "content-length": String(MAX_BODY_BYTES),
      "x-forwarded-for": "192.0.2.21",
    }));
    expect(res).toBeNull();
  });

  it("allows a request with no content-length header", () => {
    expect(guardRequest(jsonReq("192.0.2.22"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run lib/http-guard.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./http-guard" from "lib/http-guard.test.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `lib/http-guard.ts`:

```ts
/** The only gate between an unauthenticated POST and a billed Claude call.
 *  Synchronous and body-free: it reads headers only, so a rejected request
 *  never costs a JSON parse. */

export const MAX_BODY_BYTES = 256 * 1024;

export function guardRequest(req: Request): Response | null {
  // application/json is NOT a CORS-simple content type, so requiring it forces
  // a preflight that this app never answers — killing cross-origin no-cors POSTs.
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return Response.json({ error: "expected application/json" }, { status: 400 });
  }

  // "none" is a typed URL or bookmark; "same-site" is a sibling subdomain. Only
  // a genuinely foreign initiator is refused.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "cross-site request rejected" }, { status: 403 });
  }

  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }

  return null;
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run lib/http-guard.test.ts`
Expected: PASS — `Test Files 1 passed (1)`, `Tests 11 passed (11)`.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/http-guard.test.ts
npx tsc --noEmit
```

Expected: 11 tests pass; `tsc` prints nothing and exits 0.

---

## Task 2: per-IP token bucket in `lib/http-guard.ts`

**Why:** Content-type and origin checks stop a *browser-driven* cross-origin attack, but not `curl` in a loop. A token bucket caps the blast radius. It must survive Next.js dev HMR — `lib/sessions.ts:3-6` already solves this by hanging its `Map` off `globalThis`, and the identical pattern is used here so a hot reload cannot silently reset every attacker's budget to full.

**Capacity:** 60 requests per 60 seconds per IP, refilling continuously. A real user's patch loop is bounded at roughly 30-40 requests/minute — one round trip takes ~1.5-2s and `WindowFrame`'s busy overlay blocks overlapping clicks — so 60 leaves ~2× headroom.

**Key fallback, deliberate:** with no `x-forwarded-for` header (this app run directly, with no reverse proxy in front) every client collapses into one shared `"unknown"` bucket. That is the intended failure mode: the deployment target is a single-container hobby app whose only client is the owner's own browser tab, so one 60/min bucket is still ~2× that user's ceiling, and an unproxied public deployment gets a global cap rather than no cap. Do **not** fall back to a per-request unique key — that would make the limiter a no-op, which is strictly worse than a shared bucket.

**Files:**
- Modify: `lib/http-guard.ts` (add the bucket; extend `guardRequest`)
- Test: `lib/http-guard.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `guardRequest(req: Request): Response | null`, `MAX_BODY_BYTES` from Task 1.
- Produces: no new exports. `guardRequest` gains a fourth rejection: 429 `{ error: "too many requests" }` with a `Retry-After` header in whole seconds. The bucket map lives at `globalThis.__vibeRateBuckets`.

- [ ] **Step 1: Write the failing test**

Append to `lib/http-guard.test.ts` (and add `vi` to the existing `vitest` import on line 1, so it reads `import { describe, it, expect, vi } from "vitest";`):

```ts
// The bucket holds 60 tokens and refills 60/minute; these tests hard-code 60.
describe("guardRequest — per-IP rate limit", () => {
  it("allows a full burst then 429s with a Retry-After header", async () => {
    const ip = "198.51.100.1";
    for (let i = 0; i < 60; i++) expect(guardRequest(jsonReq(ip))).toBeNull();
    const res = guardRequest(jsonReq(ip));
    expect(res?.status).toBe(429);
    expect(await res!.json()).toEqual({ error: "too many requests" });
    expect(Number(res!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("buckets are per-IP: a second address is unaffected by an exhausted one", () => {
    const hot = "198.51.100.2";
    for (let i = 0; i < 61; i++) guardRequest(jsonReq(hot));
    expect(guardRequest(jsonReq(hot))?.status).toBe(429);
    expect(guardRequest(jsonReq("198.51.100.3"))).toBeNull();
  });

  it("keys on the FIRST hop of x-forwarded-for, ignoring appended proxies", () => {
    const hdr = (tail: string) => req({ "content-type": "application/json", "x-forwarded-for": `198.51.100.4, ${tail}` });
    for (let i = 0; i < 60; i++) guardRequest(hdr("203.0.113.9"));
    expect(guardRequest(hdr("203.0.113.250"))?.status).toBe(429);
  });

  it("refills over time", () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    const ip = "198.51.100.5";
    for (let i = 0; i < 60; i++) guardRequest(jsonReq(ip));
    expect(guardRequest(jsonReq(ip))?.status).toBe(429);
    now.mockReturnValue(t0 + 60_000);
    expect(guardRequest(jsonReq(ip))).toBeNull();
    now.mockRestore();
  });

  it("prunes fully-refilled buckets once the map is full, so it cannot grow forever", () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    for (let i = 0; i < 1000; i++) guardRequest(jsonReq(`203.0.113.${i}`));
    const map = (globalThis as unknown as { __vibeRateBuckets: Map<string, unknown> }).__vibeRateBuckets;
    expect(map.size).toBeGreaterThanOrEqual(1000);
    now.mockReturnValue(t0 + 60_000);
    guardRequest(jsonReq("198.51.100.200"));
    expect(map.size).toBeLessThan(1000);
    now.mockRestore();
  });

  it("survives a module reload (Next dev HMR) because the map hangs off globalThis", async () => {
    const ip = "198.51.100.6";
    for (let i = 0; i < 60; i++) guardRequest(jsonReq(ip));
    vi.resetModules();
    const reloaded = await import("./http-guard");
    expect(reloaded.guardRequest(jsonReq(ip))?.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run lib/http-guard.test.ts`
Expected: FAIL — **all 6** new rate-limit `it`s fail (11 passed, 6 failed). The first reads
`AssertionError: expected null to have property "status"` at `expect(res?.status).toBe(429)`, because `guardRequest` currently returns `null` for every well-formed request. The prune test additionally fails with `TypeError: Cannot read properties of undefined (reading 'size')` — `globalThis.__vibeRateBuckets` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Edit `lib/http-guard.ts`. Insert the bucket block immediately **after** the `MAX_BODY_BYTES` line:

```ts
const RATE_CAPACITY = 60;          // requests per window, per IP
const RATE_WINDOW_MS = 60_000;
const REFILL_PER_MS = RATE_CAPACITY / RATE_WINDOW_MS;
const MAX_BUCKETS = 1000;          // cap the map so an IP-spraying client cannot leak memory

interface Bucket {
  tokens: number;
  last: number;
}

// Survive Next.js dev HMR by hanging the map off globalThis (same trick as lib/sessions.ts).
const g = globalThis as unknown as { __vibeRateBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = g.__vibeRateBuckets ?? new Map();
g.__vibeRateBuckets = buckets;

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (!fwd) return "unknown";
  return fwd.split(",")[0].trim() || "unknown";
}

/** Drop every bucket that has refilled to full — it is indistinguishable from a fresh one. */
function pruneBuckets(now: number): void {
  for (const [key, b] of buckets) {
    if (b.tokens + (now - b.last) * REFILL_PER_MS >= RATE_CAPACITY) buckets.delete(key);
  }
}

/** Take one token. Returns 0 when allowed, else the ms until the next token. */
function takeToken(key: string, now: number): number {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) pruneBuckets(now);
    b = { tokens: RATE_CAPACITY, last: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (b.tokens < 1) return (1 - b.tokens) / REFILL_PER_MS;
  b.tokens -= 1;
  return 0;
}
```

Then replace the `return null;` at the end of `guardRequest` with:

```ts
  const waitMs = takeToken(clientKey(req), Date.now());
  if (waitMs > 0) {
    return Response.json(
      { error: "too many requests" },
      { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil(waitMs / 1000))) } },
    );
  }

  return null;
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run lib/http-guard.test.ts`
Expected: PASS — `Tests 17 passed (17)`.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/http-guard.test.ts
npx tsc --noEmit
```

Expected: 17 tests pass; `tsc` prints nothing and exits 0.

---

## Task 3: `errorResponse` — the Anthropic-typed status mapping

**Why (E3):** Today every failure in `lib/engine.ts` collapses into one opaque 502 — `search/route.ts:16`, `open/route.ts:16`, `patch/route.ts:27`. There is no way for the client to tell "Anthropic is overloaded, retry in a moment" from "this window is permanently broken". Verified against `@anthropic-ai/sdk@0.102.0`: `RateLimitError` carries `status === 429`; a 529 overload comes back as `InternalServerError` with `status === 529`, which is **not** an instance of `RateLimitError`, so it needs its own check; and `APIConnectionTimeoutError extends APIConnectionError`, so one `instanceof APIConnectionError` covers both. All classes are named exports of `@anthropic-ai/sdk` (`node_modules/@anthropic-ai/sdk/index.d.ts:7`).

`errorResponse` deliberately does **not** import `lib/engine`. Two reasons, both concrete: (a) `lib/engine` transitively pulls in `lib/claude.ts`'s module-level `new Anthropic()`, which would put the SDK client in the import graph of a module whose whole job is header inspection; and (b) `app/api/routes.test.ts` mocks `@/lib/engine` wholesale, so an engine-importing `http-guard` would compare against the *mocked* `UnknownWindowError` in route tests and the *real* one everywhere else — an `instanceof` check that silently means two different things depending on the test file. `UnknownWindowError` is therefore checked inline in the one route that can actually throw it (Task 6), ahead of the delegation to `errorResponse`. That is consistent with the frozen mapping, not a deviation from it: `searchApps`, `openWindow` and `deleteSession` cannot throw `UnknownWindowError`, so the 404 branch is unreachable in the other three routes.

**Files:**
- Modify: `lib/http-guard.ts` (add `errorResponse`)
- Test: `lib/http-guard.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `RateLimitError`, `APIError`, `APIConnectionError` from `@anthropic-ai/sdk`.
- Produces:
  ```ts
  export function errorResponse(e: unknown, verb: string): Response;
  // RateLimitError | APIError(status 529) -> 503 { error: "overloaded" }
  // APIConnectionError (incl. timeout)    -> 504 { error: "timeout" }
  // anything else                          -> 502 { error: `${verb} failed` }
  ```

- [ ] **Step 1: Write the failing test**

Append to `lib/http-guard.test.ts`, and extend the imports at the top of the file to:

```ts
import { describe, it, expect, vi } from "vitest";
import { guardRequest, errorResponse, MAX_BODY_BYTES } from "./http-guard";
import { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from "@anthropic-ai/sdk";
```

Then append:

```ts
describe("errorResponse", () => {
  it("maps RateLimitError to 503 overloaded", async () => {
    const res = errorResponse(new RateLimitError(429, { type: "error" }, "rate limited", new Headers()), "patch");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("maps a 529 overload to 503 overloaded (it is NOT a RateLimitError)", async () => {
    const e = APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers());
    expect(e instanceof RateLimitError).toBe(false);
    const res = errorResponse(e, "patch");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("maps APIConnectionError to 504 timeout", async () => {
    const res = errorResponse(new APIConnectionError({ message: "socket hang up" }), "open");
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("maps APIConnectionTimeoutError to 504 timeout", async () => {
    const res = errorResponse(new APIConnectionTimeoutError({ message: "timed out" }), "open");
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("maps a plain 500 APIError to 502 with the verb", async () => {
    const e = APIError.generate(500, { type: "error", error: { type: "api_error", message: "oops" } }, "oops", new Headers());
    const res = errorResponse(e, "patch");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "patch failed" });
  });

  it("maps an unrecognised error to 502 with the verb", async () => {
    const res = errorResponse(new Error("boom"), "search");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "search failed" });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run lib/http-guard.test.ts`
Expected: FAIL — `SyntaxError: The requested module './http-guard' does not provide an export named 'errorResponse'` (the whole file fails to collect).

- [ ] **Step 3: Write the minimal implementation**

Add this import at the very top of `lib/http-guard.ts`, above the file comment:

```ts
import { APIConnectionError, APIError, RateLimitError } from "@anthropic-ai/sdk";
```

Append to the end of `lib/http-guard.ts`:

```ts
/** Frozen error mapping, checked most-specific-first. `verb` is the route's own
 *  word ("search" | "open" | "patch" | "close") used only in the 502 fallback. */
export function errorResponse(e: unknown, verb: string): Response {
  // 529 (overloaded) surfaces as InternalServerError, not RateLimitError — check status too.
  if (e instanceof RateLimitError || (e instanceof APIError && e.status === 529)) {
    return Response.json({ error: "overloaded" }, { status: 503 });
  }
  // APIConnectionTimeoutError extends APIConnectionError, so this covers both.
  if (e instanceof APIConnectionError) {
    return Response.json({ error: "timeout" }, { status: 504 });
  }
  return Response.json({ error: `${verb} failed` }, { status: 502 });
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run lib/http-guard.test.ts`
Expected: PASS — `Tests 23 passed (23)`.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/http-guard.test.ts
npx tsc --noEmit
npm test
```

Expected: 23 tests in `lib/http-guard.test.ts`; `tsc` silent, exit 0; full suite green at **18 test files / 79 tests** (baseline 17/56 plus this new file).

---

## Task 4: `/api/search` — guard first, typed errors, and the shared test harness

**Why:** `app/api/search/route.ts:7` parses the body with no guard, and `:14-17` swallows every failure into one 502. This task also rewrites the top of `app/api/routes.test.ts` (currently lines 1-17) so all four routes get a request helper that stamps a **unique** `x-forwarded-for` per call — without it, the real token bucket added in Task 2 is shared by every test in the file and a later test would start seeing 429s.

**Files:**
- Modify: `app/api/search/route.ts` (whole file — currently 18 lines)
- Modify: `app/api/routes.test.ts:1-17` (imports, mocks, helper) and the two search `it` blocks at `:20-29`
- Test: `app/api/routes.test.ts`

**Interfaces:**
- Consumes: `guardRequest(req: Request): Response | null` and `errorResponse(e: unknown, verb: string): Response` from `@/lib/http-guard`; `searchApps(query: string): Promise<AppCard[]>` from `@/lib/engine`.
- Produces: `POST /api/search` — req `{ query }` → 200 `{ cards }`.

- [ ] **Step 1: Write the failing test**

Replace `app/api/routes.test.ts` **lines 1-17** (everything from `import { describe...` through the `beforeEach(...)` line) with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIConnectionError, RateLimitError } from "@anthropic-ai/sdk";

const searchApps = vi.hoisted(() => vi.fn());
const openWindow = vi.hoisted(() => vi.fn());
const patchWindow = vi.hoisted(() => vi.fn());
const UnknownWindowError = vi.hoisted(() => class UnknownWindowError extends Error {});
const TruncatedResponseError = vi.hoisted(() => class TruncatedResponseError extends Error {});
vi.mock("@/lib/engine", () => ({ searchApps, openWindow, patchWindow, UnknownWindowError, TruncatedResponseError }));

import { POST as searchPOST } from "./search/route";
import { POST as openPOST } from "./window/open/route";
import { POST as patchPOST } from "./window/patch/route";
import { POST as closePOST } from "./window/close/route";

// Every request gets its own RFC 5737 documentation address so the real per-IP
// token bucket in lib/http-guard.ts can never leak budget between tests.
let ipCounter = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ipCounter}`, ...headers },
    body: JSON.stringify(body),
  });

const rateLimited = () => new RateLimitError(429, { type: "error" }, "rate limited", new Headers());
const connFailed = () => new APIConnectionError({ message: "socket hang up" });

beforeEach(() => {
  searchApps.mockReset();
  openWindow.mockReset();
  patchWindow.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
```

Then replace the two search `it` blocks (baseline `app/api/routes.test.ts:20-29`, `"search returns cards"` and `"search 400s on missing query"`) with:

```ts
  it("search returns cards", async () => {
    searchApps.mockResolvedValue([{ id: "1", name: "X", icon: "⭐", blurb: "b" }]);
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: [{ id: "1", name: "X", icon: "⭐", blurb: "b" }] });
  });

  it("search 400s on missing query", async () => {
    const res = await searchPOST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "query required" });
    expect(searchApps).not.toHaveBeenCalled();
  });

  it("search 400s on a non-string query", async () => {
    const res = await searchPOST(post({ query: 42 }));
    expect(res.status).toBe(400);
    expect(searchApps).not.toHaveBeenCalled();
  });

  it("search rejects a text/plain body before touching the engine", async () => {
    const res = await searchPOST(post({ query: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
    expect(searchApps).not.toHaveBeenCalled();
  });

  it("search 503s on an Anthropic rate limit", async () => {
    searchApps.mockRejectedValue(rateLimited());
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("search 504s on a connection failure", async () => {
    searchApps.mockRejectedValue(connFailed());
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("search 502s on anything else", async () => {
    searchApps.mockRejectedValue(new Error("boom"));
    const res = await searchPOST(post({ query: "x" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "search failed" });
  });
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run app/api/routes.test.ts`
Expected: FAIL — three failures:
- `search rejects a text/plain body...` → `AssertionError: expected 200 to be 400` (no guard yet).
- `search 503s on an Anthropic rate limit` → `expected 502 to be 503`.
- `search 504s on a connection failure` → `expected 502 to be 504`.

- [ ] **Step 3: Write the minimal implementation**

Replace the entire contents of `app/api/search/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { searchApps } from "@/lib/engine";
import { guardRequest, errorResponse } from "@/lib/http-guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  try {
    const cards = await searchApps(query);
    return NextResponse.json({ cards });
  } catch (e) {
    console.error("search failed", e);
    return errorResponse(e, "search");
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run app/api/routes.test.ts`
Expected: PASS — `Tests 11 passed (11)` (7 search + the untouched open/patch/close tests).

- [ ] **Step 5: Verify**

```bash
npx vitest run app/api/routes.test.ts
npx tsc --noEmit
```

Expected: 11 tests pass; `tsc` silent, exit 0.

---

## Task 5: `/api/window/open` — accept and forward `blurb` + `query` (WP-A), guard, typed errors

**Why (WP-A):** `app/api/window/open/route.ts:7` destructures only `appName`, and `:12` calls `openWindow(appName)` with one argument, so the Spotlight query the user typed and the blurb the model just invented are both discarded. `SEARCH_SYSTEM` (`lib/tool-schema.ts:15` — "Every app NAME must be ORIGINAL and made-up … avoid plain dictionary words") forces **coined, non-dictionary** names, so the window is briefed with a single meaningless token like `"Lumefold"` and has to re-invent the app from scratch. This task makes the route the pass-through: validate types, build an `AppDetail`, hand it to `openWindow`.

**Requires Plan 1** (`AppDetail` in `lib/types.ts`; two-argument `openWindow` returning `usage`). See "Cross-plan dependency" in Global Constraints.

**Files:**
- Modify: `app/api/window/open/route.ts` (whole file — currently 18 lines)
- Modify: `app/api/routes.test.ts` — replace the `"open returns windowId + html"` `it` (baseline `:31-35`)
- Test: `app/api/routes.test.ts`

**Interfaces:**
- Consumes:
  ```ts
  import type { AppDetail } from "@/lib/types";      // { blurb?: string; query?: string }
  import { openWindow } from "@/lib/engine";
  // openWindow(appName: string, detail?: AppDetail): Promise<{ windowId: string; html: string; usage: CallUsage }>
  import { guardRequest, errorResponse } from "@/lib/http-guard";
  ```
- Produces: `POST /api/window/open` — req `{ appName, blurb?, query? }` → 200 `{ windowId, html, usage }`.

- [ ] **Step 1: Write the failing test**

In `app/api/routes.test.ts`, replace the single `it("open returns windowId + html", ...)` block with:

```ts
  const okOpen = { windowId: "w1", html: "<div id=\"d\"></div>", usage: { ms: 120, inputTokens: 800, outputTokens: 900, cacheReadTokens: 0 } };

  it("open returns windowId, html and usage", async () => {
    openWindow.mockResolvedValue(okOpen);
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okOpen);
  });

  it("open with appName alone passes NO detail through, so the prompt stays byte-identical", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Calc" }));
    expect(openWindow).toHaveBeenCalledWith("Calc", undefined);
  });

  it("open forwards blurb and query as an AppDetail", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Lumefold", blurb: "folds waveforms into light", query: "a synth with 3 oscillators" }));
    expect(openWindow).toHaveBeenCalledWith("Lumefold", { blurb: "folds waveforms into light", query: "a synth with 3 oscillators" });
  });

  it("open forwards a blurb with no query (the builtin-app case)", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Web Browser", blurb: "browse the web" }));
    expect(openWindow).toHaveBeenCalledWith("Web Browser", { blurb: "browse the web", query: undefined });
  });

  it("open forwards a query with no blurb", async () => {
    openWindow.mockResolvedValue(okOpen);
    await openPOST(post({ appName: "Lumefold", query: "make me a synth" }));
    expect(openWindow).toHaveBeenCalledWith("Lumefold", { blurb: undefined, query: "make me a synth" });
  });

  it("open 400s on a non-string blurb", async () => {
    const res = await openPOST(post({ appName: "Calc", blurb: 7 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "blurb required" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("open 400s on a non-string query", async () => {
    const res = await openPOST(post({ appName: "Calc", query: { evil: true } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "query required" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("open 400s on a missing appName", async () => {
    const res = await openPOST(post({ blurb: "b" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "appName required" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  // Boundary pin: length caps (MAX_BLURB_LEN / MAX_QUERY_LEN) live in lib/engine.ts.
  // The route must NOT truncate, or the cap would be applied twice.
  it("open passes over-long values through verbatim — capping is the engine's job", async () => {
    openWindow.mockResolvedValue(okOpen);
    const longQuery = "q".repeat(900);
    const longBlurb = "b".repeat(400);
    await openPOST(post({ appName: "Calc", blurb: longBlurb, query: longQuery }));
    expect(openWindow).toHaveBeenCalledWith("Calc", { blurb: longBlurb, query: longQuery });
  });

  it("open rejects a text/plain body before touching the engine", async () => {
    const res = await openPOST(post({ appName: "Calc" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("open 503s on an Anthropic rate limit", async () => {
    openWindow.mockRejectedValue(rateLimited());
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("open 504s on a connection failure", async () => {
    openWindow.mockRejectedValue(connFailed());
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("open 502s on a truncated response", async () => {
    openWindow.mockRejectedValue(new TruncatedResponseError("hit max_tokens"));
    const res = await openPOST(post({ appName: "Calc" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "open failed" });
  });
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run app/api/routes.test.ts`
Expected: FAIL — **11 of the 13** open `it`s fail:

- `open returns windowId, html and usage` — `AssertionError: expected { windowId: 'w1', …(1) } to deeply equal { windowId: 'w1', …(2) }`; the current route returns `{ windowId, html }` with no `usage`.
- `open with appName alone passes NO detail through` — `AssertionError: expected "vi.fn()" to be called with arguments: [ 'Calc', undefined ]`, received `[ 'Calc' ]`. (Vitest's arity check makes this a genuine red: a 1-argument call does **not** satisfy a 2-argument expectation, even when the second is `undefined`. Verified against Vitest 4.1.8.)
- `open forwards blurb and query`, `open forwards a blurb with no query`, `open forwards a query with no blurb`, `open passes over-long values through verbatim` — all fail the same way, received `[ 'Lumefold' ]` / `[ 'Web Browser' ]` / `[ 'Calc' ]`.
- `open 400s on a non-string blurb`, `open 400s on a non-string query`, `open rejects a text/plain body` — each reports `expected 502 to be 400`, **not** 200: today the extra fields are simply dropped on the floor, the route reaches `openWindow`, whose mock is unconfigured for these three tests and resolves `undefined`, the `const { windowId, html } = undefined` destructure throws, and the blanket catch turns it into a 502.
- `open 503s` / `open 504s` — `expected 502 to be 503` / `504`.

The other 2 — `open 400s on a missing appName` and `open 502s on a truncated response` — already pass. They are regression pins on behavior this task must preserve, not red steps; do not "strengthen" them into something that fails.

- [ ] **Step 3: Write the minimal implementation**

Replace the entire contents of `app/api/window/open/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { openWindow } from "@/lib/engine";
import { guardRequest, errorResponse } from "@/lib/http-guard";
import type { AppDetail } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { appName, blurb, query } = await req.json().catch(() => ({}));
  if (!appName || typeof appName !== "string") {
    return NextResponse.json({ error: "appName required" }, { status: 400 });
  }
  if (blurb !== undefined && typeof blurb !== "string") {
    return NextResponse.json({ error: "blurb required" }, { status: 400 });
  }
  if (query !== undefined && typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  // Stay undefined when neither is present so WINDOW_SYSTEM's output is byte-identical to today's.
  // Trim, newline-collapse and the MAX_BLURB_LEN/MAX_QUERY_LEN caps are applied engine-side.
  const detail: AppDetail | undefined =
    blurb === undefined && query === undefined ? undefined : { blurb, query };

  try {
    const { windowId, html, usage } = await openWindow(appName, detail);
    return NextResponse.json({ windowId, html, usage });
  } catch (e) {
    console.error("open failed", e);
    return errorResponse(e, "open");
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run app/api/routes.test.ts`
Expected: PASS — `Tests 23 passed (23)` (7 search + 13 open + the untouched patch/close tests).

- [ ] **Step 5: Verify**

```bash
npx vitest run app/api/routes.test.ts
npx tsc --noEmit
```

Expected: 23 tests pass. `tsc` silent, exit 0 — **provided Plan 1 has landed**. If it has not, tsc reports exactly the three `app/api/window/open/route.ts` errors quoted in "Cross-plan dependency" (TS2305 at 4,15; TS2339 at 28,29; TS2554 at 28,65) and nothing else; land Plan 1 rather than reverting.

---

## Task 6: `/api/window/patch` — guard, `submit`/`instruction` passthrough, `UnknownWindowError` 404 first

**Why (E3 + frozen contract):** `app/api/window/patch/route.ts:23-25` already maps `UnknownWindowError` to 404, and that must be **preserved and kept above** the new mapping — a post-restart window (sessions live only in the in-process `Map` at `lib/sessions.ts:5`) must be distinguishable from a model outage. `:26-27` is the blanket 502 to replace. Separately, `:17` coerces `action` with `action === "contextmenu" ? "contextmenu" : "click"`, which silently downgrades the `"submit"` action that the frozen `PatchInput` now accepts, and `:8` never destructures `instruction` — both are in the frozen HTTP contract, and this route file is the only place they can be wired.

**Requires Plan 1** (`TruncatedResponseError`; `PatchInput.instruction` and the `"submit"` action; `patchWindow` returning `usage`).

**Files:**
- Modify: `app/api/window/patch/route.ts` (whole file — currently 29 lines)
- Modify: `app/api/routes.test.ts` — replace the `"patch returns ops"` and `"patch 404s on unknown window"` `it` blocks (baseline `:37-48`)
- Test: `app/api/routes.test.ts`

**Interfaces:**
- Consumes:
  ```ts
  import { patchWindow, UnknownWindowError } from "@/lib/engine";
  // patchWindow(windowId: string, input: PatchInput): Promise<{ ops: RawOp[]; usage: CallUsage; stopReason: string | null }>
  // PatchInput = { elementId?: string | null; x: number; y: number;
  //                action?: "click" | "contextmenu" | "submit";
  //                inputs?: Record<string, string>; domSnapshot?: string; instruction?: string }
  import { guardRequest, errorResponse } from "@/lib/http-guard";
  ```
- Produces: `POST /api/window/patch` → 200 `{ ops, stopReason, usage }`.

- [ ] **Step 1: Write the failing test**

In `app/api/routes.test.ts`, replace the `it("patch returns ops", ...)` and `it("patch 404s on unknown window", ...)` blocks with:

```ts
  const okPatch = {
    ops: [{ op: "setText", id: "d", value: "7" }],
    stopReason: "tool_use",
    usage: { ms: 900, inputTokens: 1200, outputTokens: 60, cacheReadTokens: 4100 },
  };

  // The mock resolves an EXTRA `cacheReadTokens` — exactly what today's engine returns —
  // because today's route does `NextResponse.json(result)` and echoes the engine's whole
  // object. The frozen contract is a three-field projection, so echoing must stop.
  // (Without the extra field this test would pass against the unmodified route: Vitest's
  // toHaveBeenCalledWith ignores explicit-undefined properties, so the missing `instruction`
  // key alone does not fail the arg assertion. Verified.)
  it("patch returns exactly ops, stopReason and usage — engine extras are not echoed", async () => {
    patchWindow.mockResolvedValue({ ...okPatch, cacheReadTokens: 5 });
    const res = await patchPOST(post({ windowId: "w1", elementId: "b7", x: 10, y: 20, action: "click" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okPatch);
    expect(patchWindow).toHaveBeenCalledWith("w1", {
      elementId: "b7", x: 10, y: 20, action: "click",
      inputs: {}, domSnapshot: undefined, instruction: undefined,
    });
  });

  it("patch forwards the submit action", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "url", x: 5, y: 5, action: "submit" }));
    expect(patchWindow.mock.calls[0][1].action).toBe("submit");
  });

  it("patch forwards contextmenu, and falls back to click for an unknown action", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "a", x: 1, y: 1, action: "contextmenu" }));
    expect(patchWindow.mock.calls[0][1].action).toBe("contextmenu");
    await patchPOST(post({ windowId: "w1", elementId: "a", x: 1, y: 1, action: "dblclick" }));
    expect(patchWindow.mock.calls[1][1].action).toBe("click");
  });

  it("patch forwards a free-text instruction", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: null, x: 0, y: 0, instruction: "undo that" }));
    expect(patchWindow.mock.calls[0][1].instruction).toBe("undo that");
  });

  it("patch forwards inputs and domSnapshot", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "u", x: 0, y: 0, inputs: { u: "hi" }, domSnapshot: "<div id=\"app-root\"></div>" }));
    expect(patchWindow.mock.calls[0][1].inputs).toEqual({ u: "hi" });
    expect(patchWindow.mock.calls[0][1].domSnapshot).toBe("<div id=\"app-root\"></div>");
  });

  it("patch replaces a non-object inputs with an empty record", async () => {
    patchWindow.mockResolvedValue(okPatch);
    await patchPOST(post({ windowId: "w1", elementId: "u", x: 0, y: 0, inputs: "haha" }));
    expect(patchWindow.mock.calls[0][1].inputs).toEqual({});
  });

  it("patch 400s on a missing windowId, x or y", async () => {
    expect((await patchPOST(post({ elementId: "b", x: 1, y: 1 }))).status).toBe(400);
    expect((await patchPOST(post({ windowId: "w1", elementId: "b", y: 1 }))).status).toBe(400);
    expect((await patchPOST(post({ windowId: "w1", elementId: "b", x: 1 }))).status).toBe(400);
    expect(patchWindow).not.toHaveBeenCalled();
  });

  // Today `!windowId` lets any truthy non-string through and it reaches getSession as-is.
  it("patch 400s on a non-string windowId", async () => {
    patchWindow.mockResolvedValue(okPatch);
    const res = await patchPOST(post({ windowId: 5, elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "windowId, x and y required" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch 400s on a non-string instruction", async () => {
    const res = await patchPOST(post({ windowId: "w1", elementId: null, x: 0, y: 0, instruction: 9 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "instruction required" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch 400s on a non-string domSnapshot", async () => {
    const res = await patchPOST(post({ windowId: "w1", elementId: null, x: 0, y: 0, domSnapshot: 9 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "domSnapshot required" });
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch rejects a text/plain body before touching the engine", async () => {
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(patchWindow).not.toHaveBeenCalled();
  });

  it("patch 404s on unknown window — checked before every other error", async () => {
    patchWindow.mockRejectedValue(new UnknownWindowError("unknown window: ghost"));
    const res = await patchPOST(post({ windowId: "ghost", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown window" });
  });

  it("patch 503s on an Anthropic rate limit", async () => {
    patchWindow.mockRejectedValue(rateLimited());
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "overloaded" });
  });

  it("patch 504s on a connection failure", async () => {
    patchWindow.mockRejectedValue(connFailed());
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "timeout" });
  });

  it("patch 502s on a truncated response", async () => {
    patchWindow.mockRejectedValue(new TruncatedResponseError("hit max_tokens"));
    const res = await patchPOST(post({ windowId: "w1", elementId: "b", x: 0, y: 0 }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "patch failed" });
  });
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run app/api/routes.test.ts`
Expected: FAIL — **10 of the 15** patch `it`s fail:

- `patch returns exactly ops, stopReason and usage` — `AssertionError: expected { …(4) } to deeply equal { …(3) }`; `:21` echoes the engine's whole object, so the extra `cacheReadTokens` reaches the client.
- `patch forwards the submit action` — `expected 'click' to be 'submit'`; `:17` coerces anything that is not `"contextmenu"` down to `"click"`.
- `patch forwards a free-text instruction` — `expected undefined to be 'undo that'`; `:8` never destructures it.
- `patch replaces a non-object inputs with an empty record` — `expected 'haha' to deeply equal {}`; `:18` is a bare `inputs ?? {}`.
- `patch 400s on a non-string windowId` — `expected 200 to be 400`; `:9` only tests `!windowId`, so a truthy `5` sails through.
- `patch 400s on a non-string instruction` and `patch 400s on a non-string domSnapshot` — `expected 200 to be 400`; neither field is validated today.
- `patch rejects a text/plain body before touching the engine` — `expected 200 to be 400`; no guard yet.
- `patch 503s` / `patch 504s` — `expected 502 to be 503` / `504`.

The other 5 — `patch forwards contextmenu, and falls back to click for an unknown action`, `patch forwards inputs and domSnapshot`, `patch 400s on a missing windowId, x or y`, `patch 404s on unknown window`, `patch 502s on a truncated response` — already pass. They pin behavior this task must not regress; do not "strengthen" them into reds.

- [ ] **Step 3: Write the minimal implementation**

Replace the entire contents of `app/api/window/patch/route.ts` with:

```ts
// SSRF-safe: this route never fetches a user URL — "browser" pages are hallucinated by Claude, not fetched.
import { NextResponse } from "next/server";
import { patchWindow, UnknownWindowError } from "@/lib/engine";
import { guardRequest, errorResponse } from "@/lib/http-guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { windowId, elementId, x, y, action, inputs, domSnapshot, instruction } =
    await req.json().catch(() => ({}));
  if (!windowId || typeof windowId !== "string" || typeof x !== "number" || typeof y !== "number") {
    return NextResponse.json({ error: "windowId, x and y required" }, { status: 400 });
  }
  if (domSnapshot !== undefined && typeof domSnapshot !== "string") {
    return NextResponse.json({ error: "domSnapshot required" }, { status: 400 });
  }
  if (instruction !== undefined && typeof instruction !== "string") {
    return NextResponse.json({ error: "instruction required" }, { status: 400 });
  }
  const safeAction: "click" | "contextmenu" | "submit" =
    action === "contextmenu" || action === "submit" ? action : "click";
  // A non-object `inputs` would otherwise be walked by Object.entries in patchWindow
  // and paste index keys straight into the prompt.
  const safeInputs: Record<string, string> =
    inputs && typeof inputs === "object" && !Array.isArray(inputs) ? inputs : {};

  try {
    const { ops, stopReason, usage } = await patchWindow(windowId, {
      elementId: typeof elementId === "string" ? elementId : null,
      x,
      y,
      action: safeAction,
      inputs: safeInputs,
      domSnapshot,
      instruction,
    });
    return NextResponse.json({ ops, stopReason, usage });
  } catch (e) {
    // Most specific first: a dead session must not look like a model outage.
    if (e instanceof UnknownWindowError) {
      return NextResponse.json({ error: "unknown window" }, { status: 404 });
    }
    console.error("patch failed", e);
    return errorResponse(e, "patch");
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run app/api/routes.test.ts`
Expected: PASS — `Tests 36 passed (36)` (7 search + 13 open + 15 patch + 1 close).

- [ ] **Step 5: Verify**

```bash
npx vitest run app/api/routes.test.ts
npx tsc --noEmit
```

Expected: 36 tests pass. `tsc` silent, exit 0 — **provided Plan 1 has landed**. Without it, tsc reports exactly the two `app/api/window/patch/route.ts` errors quoted in "Cross-plan dependency" (TS2339 at 31,30 for the missing `usage`; TS2322 at 35,7 for `"submit"`), plus whatever Task 5 already contributes. There is **no** `TruncatedResponseError` error — that class is declared locally in the test via `vi.hoisted`, never imported from `@/lib/engine` — and **no** TS2353 for `instruction`, because TypeScript suppresses the excess-property check on a literal that already failed on `action`.

---

## Task 7: `/api/window/close` — guard, required `windowId`, 200 `{ ok: true }`

**Why:** `app/api/window/close/route.ts:8-9` silently returns 204 for any body — including one with no `windowId` at all, so a client bug that never sends an id looks identical to a successful close while the transcript leaks in the session `Map` forever. The frozen HTTP contract also specifies 200 `{ ok: true }` rather than 204. `app/page.tsx:59` fires this request with `.catch(() => {})` and never reads the response, so the status change is safe for the current client.

**Files:**
- Modify: `app/api/window/close/route.ts` (whole file — currently 10 lines)
- Modify: `app/api/routes.test.ts` — replace the `"close returns 204"` `it` (baseline `:50-53`)
- Test: `app/api/routes.test.ts`

**Interfaces:**
- Consumes: `deleteSession(id: string): void` from `@/lib/sessions` (NOT mocked in the route tests — the real store is exercised end-to-end); `guardRequest` from `@/lib/http-guard`. **Not** `errorResponse`: `deleteSession` is a `Map.delete` and cannot throw or make a network call, so a `try`/`catch` here would be an unreachable branch that no test could turn red. The other three routes need it because they call the model.
- Produces: `POST /api/window/close` — req `{ windowId }` → 200 `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

Add this import to the import block at the top of `app/api/routes.test.ts`, directly below the four route imports:

```ts
import { newSession, getSession } from "@/lib/sessions";
```

Then replace the `it("close returns 204", ...)` block with:

```ts
  it("close deletes the session and returns 200 { ok: true }", async () => {
    const s = newSession("Calculator");
    expect(getSession(s.id)).toBeDefined();
    const res = await closePOST(post({ windowId: s.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getSession(s.id)).toBeUndefined();
  });

  it("close 400s on a missing windowId", async () => {
    const res = await closePOST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "windowId required" });
  });

  it("close 400s on a non-string windowId", async () => {
    const res = await closePOST(post({ windowId: 5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "windowId required" });
  });

  it("close rejects a text/plain body", async () => {
    const res = await closePOST(post({ windowId: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected application/json" });
  });
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run app/api/routes.test.ts`
Expected: FAIL — `close deletes the session and returns 200 { ok: true }` fails with `AssertionError: expected 204 to be 200`; both 400 tests fail with `expected 204 to be 400`; `close rejects a text/plain body` fails with `expected 204 to be 400`.

- [ ] **Step 3: Write the minimal implementation**

Replace the entire contents of `app/api/window/close/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/sessions";
import { guardRequest } from "@/lib/http-guard";

export const runtime = "nodejs";

// No try/catch and no errorResponse here: deleteSession is a Map.delete with no
// model call behind it, so there is no failure mode left to map.
export async function POST(req: Request) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  const { windowId } = await req.json().catch(() => ({}));
  if (!windowId || typeof windowId !== "string") {
    return NextResponse.json({ error: "windowId required" }, { status: 400 });
  }
  deleteSession(windowId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run app/api/routes.test.ts`
Expected: PASS — `Tests 39 passed (39)` (7 search + 13 open + 15 patch + 4 close).

- [ ] **Step 5: Verify**

```bash
npx vitest run app/api/routes.test.ts
npx vitest run lib/http-guard.test.ts
npx tsc --noEmit
npm test
```

Expected: 39 route tests and 23 guard tests pass; `tsc` silent, exit 0; `npm test` green across the whole suite. With this plan alone applied on top of the baseline, the suite reports **18 test files** (17 baseline + `lib/http-guard.test.ts`) and **112 tests** — 56 baseline, minus the 6 route tests this plan replaced, plus 39 route tests, plus 23 guard tests. If the other plans have also landed, the counts are higher; the only thing that matters is that nothing is red. Do **not** commit — the single commit happens after all five plans and the full `tsc` + `npm test` + `npm run build` pass.

---

## Post-plan checks (run once, after all five plans have landed)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm test` — green.
- [ ] `npm run build` — clean.
- [ ] Manual: with the dev server running, `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/search -H 'content-type: text/plain' -d '{"query":"x"}'` prints `400`, and the same request with `-H 'content-type: application/json'` prints `200`. The 400 path must never appear in the Claude API usage dashboard.
