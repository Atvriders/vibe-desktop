import { APIConnectionError, APIError, RateLimitError } from "@anthropic-ai/sdk";

/** The only gate between an unauthenticated POST and a billed Claude call.
 *  Synchronous and body-free: it reads headers only, so a rejected request
 *  never costs a JSON parse. */

export const MAX_BODY_BYTES = 256 * 1024;

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

/** Key on the hop appended by the proxy in front of us, NOT the first entry.
 *  Every hop to the left of that one is text the caller typed, so keying on the
 *  first would let `curl -H 'x-forwarded-for: <random>'` mint an unlimited number
 *  of full buckets and bill unlimited Claude calls. TRUSTED_PROXY_HOPS counts the
 *  proxies that append a hop between the client and this server (default 1). */
function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  // Deliberate: with no proxy in front (the documented single-container deployment)
  // every caller shares the "unknown" bucket, so the limit degrades to one global
  // 60 req/min ceiling rather than a per-IP one. That is the correct behaviour here —
  // trusting a client-settable header instead would let anyone mint unlimited buckets.
  if (!fwd) return "unknown";
  const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length === 0) return "unknown";
  const trusted = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS)) || 1);
  return hops[Math.max(0, hops.length - trusted)] || "unknown";
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
    if (buckets.size >= MAX_BUCKETS) {
      pruneBuckets(now);
      // Prune only drops fully-refilled buckets, so a sustained spray frees nothing.
      // Evict the least-recently-seen entries to make MAX_BUCKETS a real ceiling.
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = [...buckets.entries()].sort((x, y) => x[1].last - y[1].last);
        const evict = buckets.size - MAX_BUCKETS + 1;
        for (let i = 0; i < evict; i++) buckets.delete(oldest[i][0]);
      }
    }
    b = { tokens: RATE_CAPACITY, last: now };
    buckets.set(key, b);
  }
  // Math.max floors the elapsed term: a backward clock step (NTP correction, VM
  // snapshot restore) would otherwise drive tokens deeply negative and 429 the
  // client for the size of the step.
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + Math.max(0, now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (b.tokens < 1) return (1 - b.tokens) / REFILL_PER_MS;
  b.tokens -= 1;
  return 0;
}

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

  const waitMs = takeToken(clientKey(req), Date.now());
  if (waitMs > 0) {
    return Response.json(
      { error: "too many requests" },
      { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil(waitMs / 1000))) } },
    );
  }

  return null;
}

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
