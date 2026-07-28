import { isUnsafeAttr } from "./attr-policy";
import { sanitizeHtml } from "./sanitize";
import type { RawOp } from "./types";

// A payload that contained tags but parsed to zero elements was destroyed (or was
// pure script). Report it dropped so the client resyncs, instead of silently
// losing e.g. a table row and every future op that targets its id.
// The closing ">" is required: with only "<name" + a delimiter, "if x<y then print"
// reads as a tag, and the setText check below would then queue a full-DOM resync
// on every line of ordinary prose containing a comparison.
const HAS_TAG = /<[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i;

export function applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] } {
  const applied: RawOp[] = [];
  const dropped: RawOp[] = [];
  for (const op of ops) {
    const el = op.id ? doc.getElementById(op.id) : null;
    if (!el) { dropped.push(op); continue; }
    try {
      switch (op.op) {
        // Always literal. Sniffing markup out of the value truncated ordinary
        // prose ("if x<y then print" → "if x"); the tool description tells the
        // model to use replaceHTML/insertHTML for markup.
        case "setText": {
          const text = op.value ?? "";
          el.textContent = text;
          // The write stands exactly as-is — but the model asked for a <button>
          // and got the characters of one, so its context now disagrees with the
          // screen. Reporting the op dropped queues a snapshot on the next click
          // instead of waiting up to 9 clicks for the periodic resync.
          if (HAS_TAG.test(text)) { dropped.push(op); continue; }
          break;
        }
        case "setAttr":
          if (!op.attr || isUnsafeAttr(op.attr, op.value ?? "")) { dropped.push(op); continue; }
          el.setAttribute(op.attr, op.value ?? ""); break;
        case "removeAttr": if (op.attr) el.removeAttribute(op.attr); break;
        case "addClass": if (op.value) el.classList.add(op.value); break;
        case "removeClass": if (op.value) el.classList.remove(op.value); break;
        case "replaceHTML": {
          const html = op.value ?? "";
          const frag = parseFragment(el.ownerDocument, html);
          if (fragmentLost(html, frag)) { dropped.push(op); continue; }
          el.replaceChildren(frag);
          break;
        }
        case "insertHTML":
          if (!insertHtml(el, op)) { dropped.push(op); continue; }
          break;
        case "remove": el.remove(); break;
        default: dropped.push(op); continue;
      }
      applied.push(op);
    } catch {
      dropped.push(op);
    }
  }
  return { applied, dropped };
}

// Parse model-authored fragments in a <template>: a <div> holder makes the
// parser foster-parent <tr>/<td> out of the fragment before we ever see them.
function parseFragment(doc: Document, html: string): DocumentFragment {
  const template = doc.createElement("template");
  template.innerHTML = sanitizeHtml(html);
  return template.content;
}

function fragmentLost(html: string, frag: DocumentFragment): boolean {
  return HAS_TAG.test(html) && frag.children.length === 0;
}

function insertHtml(el: Element, op: RawOp): boolean {
  // One fragment, one insertion. Inserting node-by-node re-anchored on `el` each
  // time, which reversed multi-node payloads for firstChild and after.
  const html = op.value ?? "";
  const frag = parseFragment(el.ownerDocument, html);
  if (fragmentLost(html, frag)) return false;
  const pos = op.position ?? "lastChild";
  if (pos === "before") el.parentNode?.insertBefore(frag, el);
  else if (pos === "after") el.parentNode?.insertBefore(frag, el.nextSibling);
  else if (pos === "firstChild") el.insertBefore(frag, el.firstChild);
  else el.appendChild(frag);
  return true;
}
