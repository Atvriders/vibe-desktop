import { sanitizeHtml } from "./sanitize";
import type { RawOp } from "./types";

// Attributes whose value is a URL — these must be scheme-checked.
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "background", "ping", "xlink:href"]);
// Allowed URL schemes (plus relative / anchor paths). Everything else
// (javascript:, data:, vbscript:, ...) is rejected.
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;

// Reject event-handler attributes and nested-frame content injection outright.
const isUnsafeAttr = (a: string): boolean => {
  const lower = a.toLowerCase();
  return lower.startsWith("on") || lower === "srcdoc";
};

// Reject dangerous URL schemes on URL-valued attributes. Whitespace is stripped
// first so an obfuscated "java\tscript:" can't slip past the scheme check.
const isUnsafeAttrValue = (attr: string, value: string): boolean => {
  if (!URL_ATTRS.has(attr.toLowerCase())) return false;
  const v = value.replace(/\s+/g, "");
  return v !== "" && !SAFE_URL.test(v);
};

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
          if (!op.attr || isUnsafeAttr(op.attr) || isUnsafeAttrValue(op.attr, op.value ?? "")) { dropped.push(op); continue; }
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
