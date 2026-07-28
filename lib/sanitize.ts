import { isUnsafeAttr } from "./attr-policy";

/** Defense-in-depth: the iframe runs without `allow-scripts`, but we still
 *  scrub model-authored HTML before inserting it. Parsing happens inside a
 *  <template>, whose content model permits any element — a <body> context makes
 *  the parser foster-parent <tr>/<td> out of the fragment entirely, and
 *  "append a row" is a first-class patch. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString("<template></template>", "text/html");
  const template = doc.querySelector("template")!;
  template.innerHTML = html;
  const frag = template.content;
  // A nested <template>'s children live in its .content, which querySelectorAll
  // does NOT descend into — yet innerHTML serializes them, so anything inside one
  // came back out unscrubbed. Nothing model-authored needs a <template> (there is
  // no script to stamp one out), so drop them whole rather than recursing.
  frag.querySelectorAll("script,template").forEach((el) => el.remove());
  frag.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      // Same policy as applyOps' setAttr — see lib/attr-policy.ts.
      if (isUnsafeAttr(attr.name, attr.value)) el.removeAttribute(attr.name);
    }
  });
  return template.innerHTML;
}
