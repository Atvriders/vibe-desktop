/** Byte-accurate caps for anything that goes into a request body.
 *
 *  http-guard rejects on `content-length`, which counts BYTES, so every client-side
 *  cap has to be measured the same way. `String.prototype.slice` counts UTF-16 code
 *  units instead — a different number for every non-ASCII character — so a payload
 *  that looked capped could still be three or four times the limit on the wire. */

// One encoder for the module: constructing one per call is the expensive part.
const encoder = new TextEncoder();

/** UTF-8 length of `value` in bytes — the unit `content-length` reports. */
export function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** UTF-8 size of one code point. Mirrors what TextEncoder does, including the
 *  3-byte U+FFFD it substitutes for an unpaired surrogate (which is < 0x10000). */
function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Cut `value` down to at most `maxBytes` UTF-8 bytes, always on a character
 *  boundary. Iteration is by code point, so an astral character (emoji, rarer CJK)
 *  is kept or dropped whole: cutting between its two surrogates would leave a lone
 *  surrogate, which JSON.stringify happily emits and which is not valid UTF-8 —
 *  the body would arrive corrupted rather than merely truncated. */
export function truncateBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (byteLength(value) <= maxBytes) return value;
  let used = 0;
  let i = 0;
  while (i < value.length) {
    const codePoint = value.codePointAt(i)!;
    const size = utf8Size(codePoint);
    if (used + size > maxBytes) return value.slice(0, i);
    used += size;
    i += codePoint > 0xffff ? 2 : 1;
  }
  return value;
}

/** Build a field map that holds at most `maxBytes` of key+value text in total,
 *  taking fields in the order given. The value that crosses the budget is
 *  truncated and every later field is dropped — deliberately the same shape as
 *  the server's own cap (lib/engine.ts slices the front of the joined clause and
 *  discards the rest), so the client cannot send text the server would ignore.
 *  Keys are never truncated: half a DOM id addresses nothing, so a field whose id
 *  alone will not fit is dropped instead. */
export function capFieldMap(
  fields: Iterable<readonly [string, string]>,
  maxBytes: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  let used = 0;
  for (const [key, value] of fields) {
    const keyBytes = byteLength(key);
    if (used + keyBytes > maxBytes) break;
    used += keyBytes;
    const capped = truncateBytes(value, maxBytes - used);
    used += byteLength(capped);
    out[key] = capped;
  }
  return out;
}
