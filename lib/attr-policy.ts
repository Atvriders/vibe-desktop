/** ONE attribute policy for model-authored markup.
 *
 *  The same untrusted HTML reaches the document by two paths — `setAttr` ops go
 *  through `applyOps`, while `replaceHTML`/`insertHTML` payloads and the initial
 *  `srcDoc` go through `sanitizeHtml`. When each path carried its own copy of the
 *  rules the sanitizer's copy was weaker, so `setAttr href="https://attacker/…"`
 *  was refused while the identical link inside a `replaceHTML` payload landed in
 *  the document. Both paths call this function now. */

/** Attributes whose value is a URL — these must be scheme-checked. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "background", "ping", "xlink:href"]);

/** Model-authored URLs may only be same-document (#…) or relative. No CSP directive
 *  governs a frame navigating itself and the sandbox permits it, so one click on an
 *  absolute href would carry whatever the user typed off-origin. Protocol-relative
 *  "//host" is off-origin too, hence the (?!\/). */
const SAFE_URL = /^(#|\/(?!\/)|\.{1,2}\/)/;

/** True when this attribute must not reach the document at all. */
export function isUnsafeAttr(name: string, value: string): boolean {
  const attr = name.toLowerCase();
  // Event handlers execute nothing without allow-scripts, but they are never
  // wanted; srcdoc would smuggle a whole second document past the wrapper.
  if (attr.startsWith("on") || attr === "srcdoc") return true;
  // Whitespace is stripped first so an obfuscated "java\tscript:" can't slip past.
  const v = value.replace(/\s+/g, "").toLowerCase();
  // A scripting scheme is refused on ANY attribute, not just the URL-valued ones.
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  if (!URL_ATTRS.has(attr)) return false;
  return v !== "" && !SAFE_URL.test(v);
}
