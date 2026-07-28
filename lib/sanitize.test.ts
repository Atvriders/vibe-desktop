import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("removes <script> tags but keeps surrounding markup", () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("strips on* event handlers and javascript: urls", () => {
    const out = sanitizeHtml('<a id="x" href="javascript:alert(1)" onclick="x()">go</a>');
    expect(out).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("go");
  });

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

  it("enforces the same URL allowlist as setAttr, so an absolute href cannot ride in on a payload", () => {
    const out = sanitizeHtml('<a id="x" href="https://attacker.example/?d=secret">go</a>');
    expect(out).not.toContain("attacker.example");
    expect(out).not.toContain("href");
    expect(out).toContain("go");
  });

  it("strips protocol-relative, mailto: and data: URL values too", () => {
    expect(sanitizeHtml('<a id="a" href="//evil.example/x">x</a>')).not.toContain("evil.example");
    expect(sanitizeHtml('<a id="a" href="mailto:a@b.c">x</a>')).not.toContain("mailto:");
    expect(sanitizeHtml('<img id="i" src="data:text/html,<x>">')).not.toContain("data:");
  });

  /** The attribute allowlist only governs URL-valued ATTRIBUTES, so a `data:` URL
   *  written in CSS goes straight through it — which is what keeps the CSP's
   *  `img-src data:` and `font-src data:` load-bearing rather than dead. Pinned
   *  because the README describes exactly this split. */
  it("leaves data: URLs inside CSS alone — the CSP, not the allowlist, is what governs those", () => {
    const styled = sanitizeHtml('<div id="d" style="background-image:url(data:image/png;base64,AAAA)">x</div>');
    expect(styled).toContain("data:image/png");
    const sheet = sanitizeHtml('<style>@font-face{font-family:f;src:url(data:font/woff2;base64,AAAA)}</style>');
    expect(sheet).toContain("<style>");
    expect(sheet).toContain("data:font/woff2");
  });

  it("keeps the relative URLs the allowlist permits", () => {
    expect(sanitizeHtml('<a id="a" href="#tab2">x</a>')).toContain('href="#tab2"');
    expect(sanitizeHtml('<a id="a" href="/inbox">x</a>')).toContain('href="/inbox"');
    expect(sanitizeHtml('<a id="a" href="./page.html">x</a>')).toContain('href="./page.html"');
    expect(sanitizeHtml('<div id="d" style="color:red"></div>')).toContain('style="color:red"');
  });

  it("strips srcdoc, which would smuggle a whole second document past the wrapper", () => {
    expect(sanitizeHtml('<iframe id="f" srcdoc="<img onerror=x>"></iframe>')).not.toContain("srcdoc");
  });

  it("does not let a nested <template> hide markup from the scrub", () => {
    // querySelectorAll("*") does not descend into template.content, but
    // innerHTML serializes it — so this used to come back out intact.
    const out = sanitizeHtml('<div id="d"><template><img id="i" onerror="steal()"></template></div>');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("steal()");
    expect(out).not.toContain("<template");
  });

  it("strips a script hidden inside a nested <template>", () => {
    const out = sanitizeHtml('<template><script>alert(1)</script></template><p id="p">hi</p>');
    expect(out).not.toContain("alert(1)");
    expect(out).toContain('<p id="p">hi</p>');
  });
});
