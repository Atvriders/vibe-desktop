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

/** What the card promised and what the user typed — bound to a window for its whole life. */
export interface AppDetail {
  blurb?: string;
  query?: string;
}

/** Timing + token usage for one messages.create call. */
export interface CallUsage {
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** One window's entire state = its Claude conversation. */
export interface WindowSession {
  id: string;
  appName: string;
  detail?: AppDetail;
  messages: Anthropic.MessageParam[];
  /** epoch ms, refreshed on every getSession hit; drives the TTL/LRU sweep. */
  lastUsed: number;
}

// Caps on user-authored text before it reaches a prompt. They live here rather than
// in engine.ts so tool-schema.ts can read them without an import cycle; engine.ts
// re-exports them so consumers still import from "@/lib/engine".
export const MAX_QUERY_LEN = 500;
export const MAX_BLURB_LEN = 200;
/** The DOM snapshot cap, applied CLIENT-side (WindowFrame) as well as here.
 *  It must stay well under half of http-guard's MAX_BODY_BYTES (256KB): the
 *  snapshot is JSON-escaped into the request body, and escaping the quotes in an
 *  HTML document roughly doubles it. At the old 200_000 the two constants did not
 *  compose — a ~130KB DOM 413'd at the guard, which set needsResync and forced the
 *  same oversize snapshot onto every later click, wedging the window for good.
 *
 *  The client spends this budget in BYTES (lib/byte-cap.ts), because bytes are what
 *  `content-length` — and therefore the guard — counts. The server then re-applies
 *  it as a character cap on the stored transcript, which is a no-op for anything the
 *  client sent (N bytes of UTF-8 is never more than N characters) and a real limit
 *  only for a hand-rolled POST. */
export const MAX_SNAPSHOT_LEN = 100_000;
/** Cap on the whole "Current field values: …" clause. Not MAX_SNAPSHOT_LEN: field
 *  values ride on EVERY click, so a snapshot-sized budget put up to 200KB of text
 *  on each one. Also caps a single key, which is a DOM id. */
export const MAX_FIELDS_LEN = 4000;
/** Byte budget for the whole harvested `inputs` map, applied CLIENT-side before the
 *  POST. Sized off the server's own clause cap: MAX_FIELDS_LEN characters occupy at
 *  most 3 bytes each in UTF-8 outside the astral planes, so 3 × MAX_FIELDS_LEN is
 *  the most that can survive `describeInput`'s slice — a bigger budget would only
 *  ship text the prompt throws away. It also composes with the snapshot inside
 *  http-guard's 256KB ceiling: 100KB of snapshot and 12KB of fields, each at most
 *  doubled by JSON escaping, is ~224KB. */
export const MAX_INPUTS_LEN = 3 * MAX_FIELDS_LEN;

/** Trim, collapse newlines to spaces, and cap — user text must not fake prompt structure.
 *  Lives beside the caps so both tool-schema.ts and engine.ts share one copy of the rule. */
export function promptLine(raw: string | undefined, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\r\n]+/g, " ").trim().slice(0, max).trim();
}
