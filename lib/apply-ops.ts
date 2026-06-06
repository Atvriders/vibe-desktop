import { sanitizeHtml } from "./sanitize";
import type { RawOp } from "./types";

const isUnsafeAttr = (a: string) => a.toLowerCase().startsWith("on");

export function applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] } {
  const applied: RawOp[] = [];
  const dropped: RawOp[] = [];
  for (const op of ops) {
    const el = op.id ? doc.getElementById(op.id) : null;
    if (!el) { dropped.push(op); continue; }
    try {
      switch (op.op) {
        case "setText": el.textContent = op.value ?? ""; break;
        case "setAttr":
          if (!op.attr || isUnsafeAttr(op.attr)) { dropped.push(op); continue; }
          el.setAttribute(op.attr, op.value ?? ""); break;
        case "removeAttr": if (op.attr) el.removeAttribute(op.attr); break;
        case "addClass": if (op.value) el.classList.add(op.value); break;
        case "removeClass": if (op.value) el.classList.remove(op.value); break;
        case "replaceHTML": el.innerHTML = sanitizeHtml(op.value ?? ""); break;
        case "insertHTML": insertHtml(el, op); break;
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

function insertHtml(el: Element, op: RawOp) {
  const holder = el.ownerDocument.createElement("div");
  holder.innerHTML = sanitizeHtml(op.value ?? "");
  const nodes = Array.from(holder.childNodes);
  const pos = op.position ?? "lastChild";
  for (const n of nodes) {
    if (pos === "before") el.parentNode?.insertBefore(n, el);
    else if (pos === "after") el.parentNode?.insertBefore(n, el.nextSibling);
    else if (pos === "firstChild") el.insertBefore(n, el.firstChild);
    else el.appendChild(n);
  }
}
