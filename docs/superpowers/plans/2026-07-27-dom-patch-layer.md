# DOM Patch Layer — op application, sanitizer, sandbox document — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client-side DOM patch layer apply the model's ops faithfully — correct
multi-node ordering, table rows that survive, plain text that stays plain — and harden the
sandboxed document against off-origin navigation (the `lib/`-side half of spec F1: the URL
allowlist for `setAttr` and the CSP; the `preventDefault()` half is Plan 3's).

**Architecture:** Three small pure modules, all executed in the browser inside
`components/WindowFrame.tsx`. `lib/sanitize.ts` scrubs a model-authored HTML string;
`lib/apply-ops.ts` walks a `RawOp[]` and mutates the iframe's `Document`, returning
`{applied, dropped}` (the client sets `needsResync` from `dropped.length`);
`lib/sandbox-doc.ts` wraps the initial HTML in a CSP'd document for `srcDoc`. The
common thread of this plan is *fragment parsing context*: both the sanitizer and the
inserter currently parse fragments somewhere the HTML parser refuses to keep table
content, and the inserter re-anchors on every node instead of moving one
`DocumentFragment`. Both become `<template>`-based.

**Tech Stack:** TypeScript, Next.js 16 app router, React 19, Vitest 4 + jsdom 29 +
Testing Library. No new dependencies.

## Global Constraints

- Tests are **colocated**: `lib/foo.ts` → `lib/foo.test.ts`. Never create a `tests/` dir.
- Run one file: `npx vitest run lib/foo.test.ts`. Whole suite: `npm test`.
- Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- Baseline at commit `7a48390` is **17 test files / 56 tests passing**, `tsc --noEmit` clean.
  Never leave the suite red.
- Style: 2-space indent, double quotes, semicolons, named exports, **no default exports in
  `lib/`**. Terse comments only where the reasoning is non-obvious. Match surrounding code.
- The three signatures this plan owns are **frozen** and do not change:
  - `export function applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] }`
  - `export function sanitizeHtml(html: string): string`
  - `export function wrapSandboxed(bodyHtml: string): string`
- **File ownership.** This plan may only touch `lib/apply-ops.ts`, `lib/sanitize.ts`,
  `lib/sandbox-doc.ts` and their colocated `.test.ts` files. Other plans own
  `components/`, `app/`, `lib/types.ts`, `lib/engine.ts`, `lib/sessions.ts`,
  `lib/tool-schema.ts`, `lib/claude.ts`, `lib/cache.ts`. Do not edit them, do not "fix"
  them in passing, do not add imports that would require editing them.
- `RawOp` is imported from `lib/types.ts` and is **unchanged** by this plan:
  ```ts
  export interface RawOp {
    op: "setText" | "setAttr" | "removeAttr" | "addClass" | "removeClass" | "replaceHTML" | "insertHTML" | "remove";
    id: string;
    attr?: string;
    value?: string;
    position?: "before" | "after" | "firstChild" | "lastChild";
  }
  ```
- **COMMIT POLICY — read this.** The user's standing preference is ONE commit at the very
  end of all five plans, after full verification. **Never run `git add` or `git commit` in
  this plan.** Every task ends with a **Verify** step instead. This overrides the
  writing-plans skill's default "commit frequently" guidance.
- Line numbers below are from baseline commit `7a48390`. Tasks run in order and shift each
  other's line numbers; when a number no longer matches, match on the quoted code instead.

### Cross-plan dependencies (read before starting)

**This plan depends on nothing and can run at any point.** `RawOp` already exists in
`lib/types.ts` and Plan 1 does not change it; these three modules import nothing else from a
sibling plan's files.

- **Consumed by Plan 3 (Window Shell):** `applyOps`, `sanitizeHtml` and `wrapSandboxed`, all
  with **unchanged signatures**. Plan 3 calls `sanitizeHtml` on one new input (the initial
  `win.html` before `srcDoc`) — that is a new *call site*, not a signature change, and it
  needs nothing added here.
- **F1 is split with Plan 3, deliberately.** This plan owns the CSP directives
  (`form-action 'none'`, `base-uri 'none'`, Task 6) and the `setAttr` URL allowlist (Task 5).
  Plan 3 owns the capture-phase `e.preventDefault()` and running the initial HTML through
  `sanitizeHtml`. **Neither half is sufficient alone** — see "Notes for the orchestrator" at
  the end of this file. Do not implement Plan 3's half here.
- **Nothing here depends on Plan 1, Plan 4 or Plan 5.** Plan 5's README describes the
  hardened CSP and the URL allowlist; keep the CSP directive string in Task 6 byte-identical
  to the one quoted in `README.md`.

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `lib/sanitize.ts` | Modify (whole file, 16 lines) | Scrub model-authored HTML: drop `<script>`, `on*` handlers and `javascript:` values. Parses in a `<template>` so `<tr>`/`<td>` survive. Returns a serialized fragment string. |
| `lib/sanitize.test.ts` | Modify (17 lines → +4 tests) | Sanitizer behavior incl. table fragments and plain text passthrough. |
| `lib/apply-ops.ts` | Modify (71 lines) | Apply `RawOp[]` to a `Document`. Owns: literal-text `setText`, `<template>`-parsed fragments inserted once as a `DocumentFragment`, the URL-attribute allowlist, and the `{applied, dropped}` report the client resyncs from. |
| `lib/apply-ops.test.ts` | Modify (78 lines → 27 tests) | Per-op behavior: ordering for all four `position` values, table rows, literal text, dropped-op reporting, URL allowlist. |
| `lib/sandbox-doc.ts` | Modify (7 lines) | Wrap body HTML in a `<!doctype>` document carrying the iframe CSP. |
| `lib/sandbox-doc.test.ts` | Modify (10 lines → +2 tests) | CSP directives present, single meta tag. |

Nothing is created; nothing is deleted. Three source files and three test files.

**Task order and dependencies:**

- Task 1 (sanitizer `<template>`) must land **before** Task 4 (Task 4's dropped-op tests
  assume `sanitizeHtml` preserves `<tr>`).
- Task 3 (`parseFragment` + insert-once) must land **before** Task 4 (Task 4 reuses the
  `parseFragment` helper Task 3 introduces).
- Task 2, Task 5 and Task 6 are independent of everything else *in behavior*.
- Recommended execution order: 1 → 2 → 3 → 4 → 5 → 6. **The pass/fail test counts quoted in
  every task assume this exact order** — each task's counts include the tests added by all
  earlier tasks. Run out of order and the totals will differ (the named failing/passing
  tests will not).

---

## Task 1: `sanitizeHtml` parses inside a `<template>` (spec C2, sanitizer half)

Today `sanitizeHtml` round-trips through `new DOMParser().parseFromString(html, "text/html")`
and returns `doc.body.innerHTML`. A bare `<tr>` or `<td>` is not allowed in a `<body>`
parsing context, so the parser **foster-parents** it: the tags are discarded and only their
text survives. Reproduced against the baseline tree in jsdom 29:

```
sanitizeHtml('<tr id="r2"><td>Bob</td></tr>')  →  "Bob"
sanitizeHtml('<td id="c1">x</td>')             →  "x"
```

"Append a row" is the canonical patch for a file explorer or a mail list. A `<template>`
element's content is parsed in a context that permits any element, so the same input
round-trips intact.

**Files:**
- Modify: `lib/sanitize.ts:1-16` (the whole file)
- Test: `lib/sanitize.test.ts:1-17` (append 4 tests)

**Interfaces:**
- Consumes: nothing (leaf module — only the DOM).
- Produces: `export function sanitizeHtml(html: string): string` — signature unchanged.
  Returns the serialized, scrubbed fragment. Consumed by `lib/apply-ops.ts` (Tasks 3, 4).

- [ ] **Step 1: Write the failing tests**

Append these four tests inside the existing `describe("sanitizeHtml", …)` block in
`lib/sanitize.test.ts`, immediately before its closing `});`:

```ts
  it("preserves a table row fragment instead of foster-parenting it away", () => {
    expect(sanitizeHtml('<tr id="r2"><td>Bob</td></tr>')).toBe('<tr id="r2"><td>Bob</td></tr>');
  });

  it("preserves a bare table cell fragment", () => {
    expect(sanitizeHtml('<td id="c1">x</td>')).toBe('<td id="c1">x</td>');
  });

  it("still strips a script inside a table fragment", () => {
    const out = sanitizeHtml('<tr id="r3"><td>ok</td><script>alert(1)</script></tr>');
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).toContain("<td>ok</td>");
  });

  it("returns tag-free text unchanged", () => {
    expect(sanitizeHtml("just text")).toBe("just text");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/sanitize.test.ts`

Expected: 3 failed / 3 passed. The first failure reads
`expected 'Bob' to be '<tr id="r2"><td>Bob</td></tr>'`; the second
`expected 'x' to be '<td id="c1">x</td>'`; the third fails on
`expected 'ok' to contain '<td>ok</td>'` (the baseline sanitizer already removes the
script, so only that assertion fails). "returns tag-free text unchanged" passes already —
keep it as a regression guard for Step 3.

- [ ] **Step 3: Rewrite `lib/sanitize.ts`**

Replace the entire contents of `lib/sanitize.ts` with:

```ts
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
  frag.querySelectorAll("script").forEach((el) => el.remove());
  frag.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return template.innerHTML;
}
```

Two details that are easy to get wrong: the scrub loops must run over
`template.content`, **not** over `template` — `template.querySelectorAll` does not descend
into its content fragment, so scrubbing the template itself is a silent no-op. And the
return value must be `template.innerHTML` (the getter serializes `content`), not
`doc.body.innerHTML` (which is now empty).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/sanitize.test.ts`

Expected: PASS — 6 tests. The two pre-existing tests (`removes <script> tags but keeps
surrounding markup`, `strips on* event handlers and javascript: urls`) must still pass
unchanged.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/sanitize.test.ts lib/apply-ops.test.ts
npx tsc --noEmit
```

Expected: both test files pass (`lib/apply-ops.test.ts` still 10 tests — the sanitizer
change must not disturb it), and `tsc` prints nothing.

---

## Task 2: `setText` always writes literal text (spec C3)

`lib/apply-ops.ts:32-39` guesses whether a `setText` value is markup:

```ts
if (/<[a-z][a-z0-9]*[\s/>]/i.test(v)) el.innerHTML = sanitizeHtml(v);
else el.textContent = v;
```

That heuristic fires on ordinary prose and code. Reproduced against the baseline tree:

```
setText #a "if x<y then print"   →  innerHTML "if x"   (reported as APPLIED)
```

Notepad, Terminal and Calculator are exactly the builtins that emit this. The existing test
at `lib/apply-ops.test.ts:27-31` uses `"5 < 3 = false"` and passes only because of the
space after `<` — false confidence. The tool description at `lib/tool-schema.ts:21` already
tells the model to use `replaceHTML`/`insertHTML` for markup, and Task 4's dropped-op
reporting plus the periodic resync cover disobedience. **Do not substitute a smarter
regex** — guessing intent from the value is what created the bug.

**Files:**
- Modify: `lib/apply-ops.ts:32-39` (the `setText` case)
- Test: `lib/apply-ops.test.ts:20-31` (delete one test, replace another with three)

**Interfaces:**
- Consumes: `RawOp` from `lib/types.ts` (already imported at `lib/apply-ops.ts:2`).
- Produces: `applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] }`
  — signature unchanged. Behavior change: `setText` never touches `innerHTML`.

- [ ] **Step 1: Delete the two tests that encode the old heuristic**

In `lib/apply-ops.test.ts`, delete these two tests **in full** (baseline lines 20-31):

```ts
  it("renders HTML markup put in a setText as elements, not literal text", () => {
    const d = docWith('<div id="a"></div>');
    applyOps(d, [{ op: "setText", id: "a", value: '<button id="t1">Tab 1</button>' }]);
    expect(d.getElementById("a")!.querySelector("#t1")?.textContent).toBe("Tab 1");
    expect(d.getElementById("a")!.textContent).not.toContain("<button");
  });

  it("keeps a non-tag value (e.g. math) as literal text", () => {
    const d = docWith('<div id="a"></div>');
    applyOps(d, [{ op: "setText", id: "a", value: "5 < 3 = false" }]);
    expect(d.getElementById("a")!.textContent).toBe("5 < 3 = false");
  });
```

- [ ] **Step 2: Write the three replacement tests**

Insert these three tests at exactly the position the deleted pair occupied — after the
`applies setText to an element by id` test, before `drops ops that target a nonexistent id`:

```ts
  it("keeps a '<' with no space after it as literal text", () => {
    const d = docWith('<div id="a">old</div>');
    const r = applyOps(d, [{ op: "setText", id: "a", value: "if x<y then print" }]);
    expect(d.getElementById("a")!.textContent).toBe("if x<y then print");
    expect(d.getElementById("a")!.children.length).toBe(0);
    expect(r.applied).toHaveLength(1);
  });

  it("keeps a spaced comparison as literal text", () => {
    const d = docWith('<div id="a"></div>');
    applyOps(d, [{ op: "setText", id: "a", value: "5 < 3 = false" }]);
    expect(d.getElementById("a")!.textContent).toBe("5 < 3 = false");
  });

  it("writes markup in a setText value as literal text, not as elements", () => {
    const d = docWith('<div id="a"></div>');
    applyOps(d, [{ op: "setText", id: "a", value: '<button id="t1">Tab 1</button>' }]);
    expect(d.getElementById("a")!.textContent).toBe('<button id="t1">Tab 1</button>');
    expect(d.getElementById("a")!.querySelector("#t1")).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: 2 failed / 9 passed. `keeps a '<' with no space after it as literal text` fails
with `expected 'if x' to be 'if x<y then print'`; `writes markup in a setText value as
literal text` fails with `expected 'Tab 1' to be '<button id="t1">Tab 1</button>'`.
`keeps a spaced comparison as literal text` passes already — it is the surviving half of the
deleted pair, re-added deliberately as a regression guard that the rewrite must not break.

- [ ] **Step 4: Replace the `setText` case**

In `lib/apply-ops.ts`, replace this block (baseline lines 32-39):

```ts
        case "setText": {
          const v = op.value ?? "";
          // Haiku sometimes puts HTML markup in a setText value; render it as
          // (sanitized) HTML instead of literal text. A real tag is "<" + letter + (space|>|/).
          if (/<[a-z][a-z0-9]*[\s/>]/i.test(v)) el.innerHTML = sanitizeHtml(v);
          else el.textContent = v;
          break;
        }
```

with:

```ts
        // Always literal. Sniffing markup out of the value truncated ordinary
        // prose ("if x<y then print" → "if x"); the tool description tells the
        // model to use replaceHTML/insertHTML for markup.
        case "setText": el.textContent = op.value ?? ""; break;
```

`sanitizeHtml` is still used by the `replaceHTML` and `insertHTML` cases, so leave the
import at `lib/apply-ops.ts:1` in place.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: PASS — 11 tests.

- [ ] **Step 6: Verify**

```bash
npx vitest run lib/apply-ops.test.ts
npx tsc --noEmit
```

Expected: 11 tests pass; `tsc` prints nothing.

Note: `tsconfig.json` sets neither `noUnusedLocals` nor `noUnusedParameters`, and there is no
eslint in this repo, so **`tsc` will stay silent even if the `sanitizeHtml` import is left
dangling**. Do not rely on it as a guard. Instead check by hand: after this task
`lib/apply-ops.ts` must still contain exactly two `sanitizeHtml(` call sites — the
`replaceHTML` case (baseline line 46) and `insertHtml` (baseline line 61). Confirm with
`grep -c "sanitizeHtml(" lib/apply-ops.ts` → `2`.

---

## Task 3: `insertHTML` inserts one `DocumentFragment` (spec C1)

`insertHtml` at `lib/apply-ops.ts:59-70` loops over the parsed nodes and recomputes the
anchor from `el` on every iteration, so each node lands at the same spot and pushes the
previous one down. Reproduced against the baseline tree, inserting
`'<li id="a">A</li><li id="b">B</li>'` into `<ul id="list"><li id="old">old</li></ul>`:

| position | actual (baseline) | correct |
| --- | --- | --- |
| `firstChild` | `b, a, old` | `a, b, old` |
| `after` | `old, b, a` | `old, a, b` |
| `before` | `a, b, old` | `a, b, old` |
| `lastChild` | `old, a, b` | `old, a, b` |

Two of four are wrong, and `insertHTML` has **zero** test coverage today. Building a
`DocumentFragment` and inserting it once fixes both cases at the root: fragment insertion
moves all children in order, in a single operation.

**Files:**
- Modify: `lib/apply-ops.ts:59-70` (the `insertHtml` function)
- Test: `lib/apply-ops.test.ts` (append 5 tests)

**Interfaces:**
- Consumes: `sanitizeHtml(html: string): string` from `lib/sanitize.ts` (Task 1).
- Produces (module-private, reused by Task 4):
  ```ts
  function parseFragment(doc: Document, html: string): DocumentFragment
  ```
  Not exported. `applyOps` stays the module's only export.

- [ ] **Step 1: Write the failing tests**

Append these five tests inside the existing `describe("applyOps", …)` block in
`lib/apply-ops.test.ts`, immediately before its closing `});`:

```ts
  it("inserts a multi-node payload in order at firstChild", () => {
    const d = docWith('<ul id="list"><li id="old">old</li></ul>');
    const r = applyOps(d, [{ op: "insertHTML", id: "list", position: "firstChild", value: '<li id="a">A</li><li id="b">B</li>' }]);
    expect(Array.from(d.getElementById("list")!.children).map((n) => n.id)).toEqual(["a", "b", "old"]);
    expect(r.applied).toHaveLength(1);
  });

  it("inserts a multi-node payload in order at lastChild", () => {
    const d = docWith('<ul id="list"><li id="old">old</li></ul>');
    applyOps(d, [{ op: "insertHTML", id: "list", position: "lastChild", value: '<li id="a">A</li><li id="b">B</li>' }]);
    expect(Array.from(d.getElementById("list")!.children).map((n) => n.id)).toEqual(["old", "a", "b"]);
  });

  it("inserts a multi-node payload in order before the anchor", () => {
    const d = docWith('<ul id="list"><li id="old">old</li></ul>');
    applyOps(d, [{ op: "insertHTML", id: "old", position: "before", value: '<li id="a">A</li><li id="b">B</li>' }]);
    expect(Array.from(d.getElementById("list")!.children).map((n) => n.id)).toEqual(["a", "b", "old"]);
  });

  it("inserts a multi-node payload in order after the anchor", () => {
    const d = docWith('<ul id="list"><li id="old">old</li></ul>');
    applyOps(d, [{ op: "insertHTML", id: "old", position: "after", value: '<li id="a">A</li><li id="b">B</li>' }]);
    expect(Array.from(d.getElementById("list")!.children).map((n) => n.id)).toEqual(["old", "a", "b"]);
  });

  it("defaults to lastChild when position is omitted", () => {
    const d = docWith('<ul id="list"><li id="old">old</li></ul>');
    applyOps(d, [{ op: "insertHTML", id: "list", value: '<li id="a">A</li>' }]);
    expect(Array.from(d.getElementById("list")!.children).map((n) => n.id)).toEqual(["old", "a"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: 2 failed / 14 passed. `inserts a multi-node payload in order at firstChild` fails
with `expected [ 'b', 'a', 'old' ] to deeply equal [ 'a', 'b', 'old' ]`, and
`… after the anchor` fails with
`expected [ 'old', 'b', 'a' ] to deeply equal [ 'old', 'a', 'b' ]`. The `before`,
`lastChild` and default cases pass already — they are the regression guard proving the
rewrite does not break what already worked.

- [ ] **Step 3: Rewrite `insertHtml`**

In `lib/apply-ops.ts`, replace this function (baseline lines 59-70):

```ts
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
```

with:

```ts
// Parse model-authored fragments in a <template>: a <div> holder makes the
// parser foster-parent <tr>/<td> out of the fragment before we ever see them.
function parseFragment(doc: Document, html: string): DocumentFragment {
  const template = doc.createElement("template");
  template.innerHTML = sanitizeHtml(html);
  return template.content;
}

function insertHtml(el: Element, op: RawOp) {
  // One fragment, one insertion. Inserting node-by-node re-anchored on `el` each
  // time, which reversed multi-node payloads for firstChild and after.
  const frag = parseFragment(el.ownerDocument, op.value ?? "");
  const pos = op.position ?? "lastChild";
  if (pos === "before") el.parentNode?.insertBefore(frag, el);
  else if (pos === "after") el.parentNode?.insertBefore(frag, el.nextSibling);
  else if (pos === "firstChild") el.insertBefore(frag, el.firstChild);
  else el.appendChild(frag);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: PASS — 16 tests.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/apply-ops.test.ts lib/sanitize.test.ts
npx tsc --noEmit
```

Expected: 16 + 6 tests pass; `tsc` prints nothing.

---

## Task 4: table-safe `replaceHTML` and dropped-op reporting (spec C2, apply half)

Two remaining halves of C2.

**(a) `replaceHTML` still loses table content in the wrong container.** With Task 1 in
place `sanitizeHtml` returns the `<tr>` intact, and `el.innerHTML = "<tr>…"` parses
correctly when `el` is a `<tbody>`. But when the model targets a `<div>` — which it does,
because it invented the layout — the `innerHTML` setter foster-parents the row away again.
Assigning a `<template>`-parsed `DocumentFragment` via `replaceChildren` is context-free
and keeps the row regardless of the parent. Verified in jsdom 29:
`div.replaceChildren(parseFragment(d, '<tr id="r9"><td>Z</td></tr>'))` →
`<tr id="r9"><td>Z</td></tr>`, and `doc.getElementById("r9")` resolves.

**(b) A payload that vanishes must be reported.** `components/WindowFrame.tsx:66` reads
`needsResync.current = result.dropped.length > 0`, so an op that silently applies nothing
leaves `needsResync` false, no snapshot is ever sent, and because the new id never enters
the document every later op targeting it is dropped forever. When the payload contained
tags but parsed to zero elements, push the op to `dropped` and skip the mutation instead.

The tag test is `/<[a-z][a-z0-9-]*[\s/>]/i`, which is deliberately **not** a semantic
heuristic — it never changes what an op means (C3's ban), it only decides whether a no-op
is worth a resync. It is intentionally trigger-happy: `insertHTML "if x<y then print"`
inserts no elements either way, and resyncing is the safe direction.

**Files:**
- Modify: `lib/apply-ops.ts` — the `replaceHTML` case (baseline line 46), the `insertHTML`
  case (baseline line 47), and the `insertHtml`/`parseFragment` helpers below `applyOps`
- Test: `lib/apply-ops.test.ts` (append 6 tests)

**Interfaces:**
- Consumes: `parseFragment(doc: Document, html: string): DocumentFragment` (Task 3),
  `sanitizeHtml(html: string): string` (Task 1).
- Produces: `applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] }`
  — signature unchanged; `dropped` now also carries HTML payloads that sanitized to
  nothing. `insertHtml` becomes `function insertHtml(el: Element, op: RawOp): boolean`
  (module-private; `false` means "dropped, nothing inserted").

- [ ] **Step 1: Write the failing tests**

Append these six tests inside the existing `describe("applyOps", …)` block in
`lib/apply-ops.test.ts`, immediately before its closing `});`:

```ts
  it("appends a table row into a tbody instead of destroying it", () => {
    const d = docWith('<table id="t"><tbody id="tb"><tr id="r1"><td>Al</td></tr></tbody></table>');
    const r = applyOps(d, [{ op: "insertHTML", id: "tb", position: "lastChild", value: '<tr id="r2"><td>Bob</td></tr>' }]);
    expect(Array.from(d.getElementById("tb")!.children).map((n) => n.id)).toEqual(["r1", "r2"]);
    expect(d.getElementById("r2")!.tagName).toBe("TR");
    expect(r.dropped).toHaveLength(0);
  });

  it("replaceHTML keeps a table row even when the target is a div", () => {
    const d = docWith('<div id="host"></div>');
    applyOps(d, [{ op: "replaceHTML", id: "host", value: '<tr id="r3"><td>Cy</td></tr>' }]);
    expect(d.getElementById("r3")).not.toBeNull();
    expect(d.getElementById("r3")!.tagName).toBe("TR");
  });

  it("replaceHTML discards the previous children", () => {
    const d = docWith('<div id="host"><span id="gone">g</span></div>');
    const r = applyOps(d, [{ op: "replaceHTML", id: "host", value: '<span id="fresh">f</span>' }]);
    expect(d.getElementById("gone")).toBeNull();
    expect(d.getElementById("fresh")!.textContent).toBe("f");
    expect(r.applied).toHaveLength(1);
  });

  it("drops an insertHTML whose markup sanitized down to nothing", () => {
    const d = docWith('<div id="host"></div>');
    const r = applyOps(d, [{ op: "insertHTML", id: "host", value: "<script>alert(1)</script>" }]);
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(0);
    expect(d.getElementById("host")!.innerHTML).toBe("");
  });

  it("drops a replaceHTML whose markup sanitized down to nothing and leaves the element alone", () => {
    const d = docWith('<div id="host"><span id="keep">k</span></div>');
    const r = applyOps(d, [{ op: "replaceHTML", id: "host", value: "<script>alert(1)</script>" }]);
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(0);
    expect(d.getElementById("keep")).not.toBeNull();
  });

  it("does not drop a tag-free text payload", () => {
    const d = docWith('<div id="host"></div>');
    const r = applyOps(d, [{ op: "insertHTML", id: "host", value: "just text" }]);
    expect(r.applied).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
    expect(d.getElementById("host")!.textContent).toBe("just text");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: 3 failed / 19 passed. `replaceHTML keeps a table row even when the target is a
div` fails with `expected null not to be null`; both `drops a … sanitized down to nothing`
tests fail with `expected [] to have a length of 1 but got +0`. (`appends a table row into
a tbody`, `replaceHTML discards the previous children` and `does not drop a tag-free text
payload` pass already thanks to Tasks 1 and 3 — they are regression guards.)

- [ ] **Step 3: Add the drop check and route both HTML ops through the fragment**

In `lib/apply-ops.ts`, add this constant directly below the `SAFE_URL` line near the top of
the file (baseline line 8):

```ts
// A payload that contained tags but parsed to zero elements was destroyed (or was
// pure script). Report it dropped so the client resyncs, instead of silently
// losing e.g. a table row and every future op that targets its id.
const HAS_TAG = /<[a-z][a-z0-9-]*[\s/>]/i;
```

Replace the `replaceHTML` and `insertHTML` cases (baseline lines 46-47):

```ts
        case "replaceHTML": el.innerHTML = sanitizeHtml(op.value ?? ""); break;
        case "insertHTML": insertHtml(el, op); break;
```

with:

```ts
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
```

Then, below `applyOps`, add `fragmentLost` next to `parseFragment` and make `insertHtml`
return a boolean:

```ts
function fragmentLost(html: string, frag: DocumentFragment): boolean {
  return HAS_TAG.test(html) && frag.children.length === 0;
}
```

```ts
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
```

`continue` inside the `switch` continues the enclosing `for (const op of ops)` loop — the
same pattern the `setAttr` and `default` arms already use at baseline lines 41 and 49, so
a dropped op correctly skips the `applied.push(op)` at the bottom of the loop body.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: PASS — 22 tests.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/apply-ops.test.ts lib/sanitize.test.ts
npx tsc --noEmit
```

Expected: 22 + 6 tests pass; `tsc` prints nothing.

Again, `tsc` cannot catch a dangling import here (no `noUnusedLocals`, no eslint). Check by
hand instead: `parseFragment` is now the module's **only** `sanitizeHtml` caller, so
`grep -c "sanitizeHtml(" lib/apply-ops.ts` must print `1`. If it prints `0`, `parseFragment`
lost its sanitize call and every op payload is now inserted unscrubbed — the
`strips event-handler attributes` and `drops setAttr with a javascript: URL value` tests
would not catch that, because they exercise `setAttr`, not the HTML path.

---

## Task 5: `SAFE_URL` allows only relative and `#` URLs (spec F1, apply-ops half)

`lib/apply-ops.ts:8` is:

```ts
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;
```

No CSP directive governs a frame navigating *itself*, and the iframe's sandbox flag set
(`allow-same-origin` only, `components/WindowFrame.tsx:157`) permits it. So a model-authored
`<a href="http://attacker/?d=…">Continue</a>` issues a real outbound request carrying
whatever the user typed — the values are already harvested into `inputs` at
`WindowFrame.tsx:50` and sit in the model's context. `https?:`, `mailto:` and `tel:` exist
in this regex only to let generated HTML point off-origin, which is never wanted: the host
turns every click into a patch anyway.

**Scope this precisely — do not overclaim.** `SAFE_URL` is reached only from
`isUnsafeAttrValue` (`lib/apply-ops.ts:18-22`), which is called only from the `setAttr` case
(`lib/apply-ops.ts:41`). It does **not** filter URLs inside `replaceHTML`/`insertHTML`
payloads or inside the initial window HTML: `sanitizeHtml` strips only `<script>`, `on*` and
`javascript:` values, so `insertHTML '<a href="http://attacker/">x</a>'` still lands an
absolute href in the document after this task. That channel is closed by **Plan 3's
`e.preventDefault()`** in the capture-phase click listener plus Task 6's CSP. This task
closes the `setAttr` channel — the one this file owns — and removes the schemes that only
ever existed to permit off-origin targets. Both halves are required; neither is sufficient
alone.

The current pattern also lets `//attacker.com/x` through — it matches the bare `\/`
alternative, and a protocol-relative URL is fully off-origin. The replacement rejects it.

Verified allow/deny for the new pattern in jsdom:

| value | old | new |
| --- | --- | --- |
| `https://example.com/`, `http://e.com`, `mailto:a@b.c`, `tel:+1` | allowed | **dropped** |
| `//evil.com/x` | allowed | **dropped** |
| `javascript:alert(1)`, `data:text/html,x` | dropped | dropped |
| `/inbox`, `#tab2`, `./page.html`, `../up.html` | allowed | allowed |

**Files:**
- Modify: `lib/apply-ops.ts:6-8` (the comment and the `SAFE_URL` constant)
- Test: `lib/apply-ops.test.ts:67-71` (replace one test with six)

**Interfaces:**
- Consumes: nothing new.
- Produces: `applyOps(doc: Document, ops: RawOp[]): { applied: RawOp[]; dropped: RawOp[] }`
  — signature unchanged; `setAttr` on a URL-valued attribute now drops absolute and
  protocol-relative values.

- [ ] **Step 1: Delete the test that asserts the old policy**

In `lib/apply-ops.test.ts`, delete this test **in full** (baseline lines 67-71):

```ts
  it("allows setAttr with a safe https URL", () => {
    const d = docWith('<a id="l">x</a>');
    applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "https://example.com/" }]);
    expect(d.getElementById("l")!.getAttribute("href")).toBe("https://example.com/");
  });
```

- [ ] **Step 2: Write the six replacement tests**

Insert these at exactly the position the deleted test occupied — after `drops setAttr with
a data: URL on src`, before `allows setAttr on a non-URL presentational attribute (style)`:

```ts
  it("drops setAttr with an off-origin https URL", () => {
    const d = docWith('<a id="l">x</a>');
    const r = applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "https://example.com/" }]);
    expect(d.getElementById("l")!.hasAttribute("href")).toBe(false);
    expect(r.dropped).toHaveLength(1);
  });

  it("drops setAttr with a mailto: URL", () => {
    const d = docWith('<a id="l">x</a>');
    const r = applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "mailto:a@b.c" }]);
    expect(d.getElementById("l")!.hasAttribute("href")).toBe(false);
    expect(r.dropped).toHaveLength(1);
  });

  it("drops setAttr with a protocol-relative //host URL", () => {
    const d = docWith('<a id="l">x</a>');
    const r = applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "//evil.example/x" }]);
    expect(d.getElementById("l")!.hasAttribute("href")).toBe(false);
    expect(r.dropped).toHaveLength(1);
  });

  it("allows a root-relative href", () => {
    const d = docWith('<a id="l">x</a>');
    applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "/inbox" }]);
    expect(d.getElementById("l")!.getAttribute("href")).toBe("/inbox");
  });

  it("allows a same-document #anchor href", () => {
    const d = docWith('<a id="l">x</a>');
    applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "#tab2" }]);
    expect(d.getElementById("l")!.getAttribute("href")).toBe("#tab2");
  });

  it("allows a ./ relative href", () => {
    const d = docWith('<a id="l">x</a>');
    applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "./page.html" }]);
    expect(d.getElementById("l")!.getAttribute("href")).toBe("./page.html");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: 3 failed / 24 passed. `drops setAttr with an off-origin https URL`,
`drops setAttr with a mailto: URL` and `drops setAttr with a protocol-relative //host URL`
each fail with `expected true to be false // Object.is equality` (the attribute was set).
The three "allows" tests pass already — they pin behavior the change must preserve.

- [ ] **Step 4: Tighten `SAFE_URL`**

In `lib/apply-ops.ts`, replace these three lines (baseline lines 6-8):

```ts
// Allowed URL schemes (plus relative / anchor paths). Everything else
// (javascript:, data:, vbscript:, ...) is rejected.
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;
```

with:

```ts
// Model-authored URLs may only be same-document (#…) or relative. No CSP directive
// governs a frame navigating itself and the sandbox permits it, so one click on an
// absolute href would carry whatever the user typed off-origin. Protocol-relative
// "//host" is off-origin too, hence the (?!\/).
const SAFE_URL = /^(#|\/(?!\/)|\.{1,2}\/)/;
```

Leave `URL_ATTRS` (baseline line 5), `isUnsafeAttr` and `isUnsafeAttrValue` exactly as they
are — `isUnsafeAttrValue` already strips whitespace before testing and already treats an
empty value as safe.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/apply-ops.test.ts`

Expected: PASS — 27 tests.

- [ ] **Step 6: Verify**

```bash
npx vitest run lib/apply-ops.test.ts
npx tsc --noEmit
```

Expected: 27 tests pass; `tsc` prints nothing.

---

## Task 6: CSP gains `form-action 'none'` and `base-uri 'none'` (spec F1, sandbox-doc half)

`lib/sandbox-doc.ts:4` emits:

```
default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:
```

`form-action` is moot today only because the sandbox omits `allow-forms` — that is a
property of one attribute in `components/WindowFrame.tsx:157`, not of this document, and
should not be the only thing standing between a model-authored `<form action="http://…">`
and an outbound POST. `base-uri 'none'` is the matching defense for `SAFE_URL`: without it
a single `<base href="http://attacker/">` would re-point every relative URL Task 5 just
finished allowing.

**Files:**
- Modify: `lib/sandbox-doc.ts:1-7` (the whole file)
- Test: `lib/sandbox-doc.test.ts:1-10` (append 2 tests)

**Interfaces:**
- Consumes: nothing (leaf module — pure string building).
- Produces: `export function wrapSandboxed(bodyHtml: string): string` — signature
  unchanged. Consumed by `components/WindowFrame.tsx:157` as the iframe's `srcDoc`
  (owned by another plan; do not edit it).

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the existing `describe("wrapSandboxed", …)` block in
`lib/sandbox-doc.test.ts`, immediately before its closing `});`:

```ts
  it("forbids form submission and <base> rewriting", () => {
    const result = wrapSandboxed("<p>hello</p>");
    expect(result).toContain("form-action 'none'");
    expect(result).toContain("base-uri 'none'");
  });

  it("keeps the whole policy on a single CSP meta tag", () => {
    const result = wrapSandboxed("");
    expect(result.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/sandbox-doc.test.ts`

Expected: 1 failed / 2 passed. `forbids form submission and <base> rewriting` fails with
`expected '<!doctype html><html><head><meta http-…' to contain "form-action 'none'"`.
(`keeps the whole policy on a single CSP meta tag` passes already and must keep passing —
it guards against bolting on a second `<meta>` instead of extending the first.)

- [ ] **Step 3: Extend the CSP**

Replace the entire contents of `lib/sandbox-doc.ts` with:

```ts
export function wrapSandboxed(bodyHtml: string): string {
  return (
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" ' +
    "content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
    "form-action 'none'; base-uri 'none'\">" +
    "</head><body>" + bodyHtml + "</body></html>"
  );
}
```

Note the trailing space after `font-src data:;` in the first content chunk — the two string
literals concatenate into one directive list, and without it the policy would read
`font-src data:;form-action` (still valid, but keep the spacing readable and the assertions
exact).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/sandbox-doc.test.ts`

Expected: PASS — 3 tests. The pre-existing `contains the strict CSP meta and the body html`
test must still pass unchanged.

- [ ] **Step 5: Verify**

```bash
npx vitest run lib/sandbox-doc.test.ts lib/apply-ops.test.ts lib/sanitize.test.ts
npx tsc --noEmit
npm test
```

Expected: the three owned files pass with **36 tests total** (27 apply-ops + 6 sanitize +
3 sandbox-doc, up from 10 + 2 + 1 = 13 at baseline); `tsc` prints nothing; `npm test` is
fully green. Against baseline `7a48390` with only this plan applied the whole suite reads
**17 test files / 79 tests passing** — that is `56 − 13 + 36`, and no test file is created or
deleted, so the file count is unchanged. If other plans have already landed, the total will
be higher; what must hold is 36 owned tests, zero failures, 17+ files.

If `npm test` shows failures in `components/WindowFrame.test.tsx` or
`app/api/routes.test.ts`, do **not** edit those files — they belong to other plans. Report
the failure to the orchestrator with the exact assertion text. (At baseline neither file
asserts anything about sanitizer output, CSP directives, `setText` markup handling or URL
schemes, so no collision is expected.)

---

## Notes for the orchestrator

- **Not done here, by design:** the `e.preventDefault()` half of F1 lives in
  `components/WindowFrame.tsx` (Plan 3), as does running the *initial* window HTML through
  `sanitizeHtml` before it reaches `srcDoc`. This plan makes both safe to add but does not
  add them.
- **Residual, and it must not be silently dropped:** after Task 5, absolute URLs are still
  reachable through the **HTML payload** path — `sanitizeHtml` scrubs `<script>`, `on*` and
  `javascript:` but performs no `URL_ATTRS`/`SAFE_URL` check, so
  `insertHTML '<a href="http://attacker/">x</a>'` and the initial `openWindow` HTML both keep
  the absolute href. Task 5 only tightens the `setAttr` op channel. The off-origin
  *navigation* is prevented by Plan 3's capture-phase `e.preventDefault()`; **if Plan 3 drops
  that step, F1 is not fixed regardless of this plan.** Extending `sanitizeHtml` itself to
  enforce the allowlist would mean relocating `URL_ATTRS`/`SAFE_URL` into `lib/sanitize.ts`
  (importing them the other way round creates a cycle — `apply-ops` already imports
  `sanitize`); that is deliberately **out of scope here** because the work-item split assigns
  the payload path to Plan 3. Orchestrator: verify Plan 3 lands `preventDefault()`.
- **Behavior other plans may notice:** `dropped` now carries HTML ops whose payload
  sanitized to nothing. `components/WindowFrame.tsx:66` already turns any non-empty
  `dropped` into `needsResync = true`, which is exactly the intended effect — no client
  change is required for it to work.
- **One cosmetic consequence of the `<template>` switch:** head-only elements such as
  `<title>` now survive in a sanitized fragment instead of being routed to a discarded
  `<head>`. They render nothing inside a body and the tool description already forbids
  them, so no test pins this either way.
