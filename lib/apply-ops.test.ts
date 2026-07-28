import { describe, it, expect, beforeEach } from "vitest";
import { applyOps } from "./apply-ops";
import type { RawOp } from "./types";

function docWith(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("applyOps", () => {
  it("applies setText to an element by id", () => {
    const d = docWith('<div id="a">old</div>');
    const r = applyOps(d, [{ op: "setText", id: "a", value: "new" }]);
    expect(d.getElementById("a")!.textContent).toBe("new");
    expect(r.applied).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

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

  it("reports a setText that carried markup as dropped, without changing what it wrote", () => {
    // The model asked for a <button> and got its characters. Nothing is guessed
    // and nothing is re-rendered — but the op is reported dropped so the client
    // queues a snapshot, instead of the model's context silently believing for
    // up to nine more clicks that it rendered a button.
    const d = docWith('<div id="a"></div>');
    const r = applyOps(d, [{ op: "setText", id: "a", value: '<button id="t1">Tab 1</button>' }]);
    expect(d.getElementById("a")!.textContent).toBe('<button id="t1">Tab 1</button>');
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(0);
  });

  it("does not report an ordinary prose setText as dropped", () => {
    const d = docWith('<div id="a"></div>');
    const r = applyOps(d, [
      { op: "setText", id: "a", value: "if x<y then print" },
      { op: "setText", id: "a", value: "5 < 3 = false" },
      { op: "setText", id: "a", value: "plain" },
    ]);
    expect(r.applied).toHaveLength(3);
    expect(r.dropped).toHaveLength(0);
  });

  it("drops ops that target a nonexistent id", () => {
    const d = docWith('<div id="a"></div>');
    const r = applyOps(d, [{ op: "setText", id: "ghost", value: "x" } as RawOp]);
    expect(r.dropped).toHaveLength(1);
    expect(r.applied).toHaveLength(0);
  });

  it("strips event-handler attributes on setAttr", () => {
    const d = docWith('<button id="b">x</button>');
    applyOps(d, [{ op: "setAttr", id: "b", attr: "onclick", value: "evil()" }]);
    expect(d.getElementById("b")!.hasAttribute("onclick")).toBe(false);
  });

  it("removes an element", () => {
    const d = docWith('<div id="a"></div><div id="b"></div>');
    applyOps(d, [{ op: "remove", id: "a" }]);
    expect(d.getElementById("a")).toBeNull();
    expect(d.getElementById("b")).not.toBeNull();
  });

  it("drops setAttr with a javascript: URL value", () => {
    const d = docWith('<a id="l">x</a>');
    const r = applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "javascript:alert(1)" }]);
    expect(d.getElementById("l")!.hasAttribute("href")).toBe(false);
    expect(r.dropped).toHaveLength(1);
  });

  it("drops setAttr with a data: URL on src", () => {
    const d = docWith('<img id="im">');
    const r = applyOps(d, [{ op: "setAttr", id: "im", attr: "src", value: "data:text/html,<x>" }]);
    expect(d.getElementById("im")!.hasAttribute("src")).toBe(false);
    expect(r.dropped).toHaveLength(1);
  });

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

  it("allows setAttr on a non-URL presentational attribute (style)", () => {
    const d = docWith('<div id="dv"></div>');
    applyOps(d, [{ op: "setAttr", id: "dv", attr: "style", value: "color:red" }]);
    expect(d.getElementById("dv")!.getAttribute("style")).toBe("color:red");
  });

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

  it("strips an absolute href inside a replaceHTML payload, exactly as setAttr would", () => {
    // The two paths used to run different policies, and this — the hotter one —
    // was the weaker copy: the link setAttr refuses landed in the document.
    const d = docWith('<div id="host"></div>');
    const r = applyOps(d, [{ op: "replaceHTML", id: "host", value: '<a id="out" href="https://attacker.example/?d=secret">Continue</a>' }]);
    expect(r.applied).toHaveLength(1);
    expect(d.getElementById("out")!.hasAttribute("href")).toBe(false);
    expect(d.getElementById("host")!.innerHTML).not.toContain("attacker.example");
  });

  it("strips an absolute href inside an insertHTML payload too", () => {
    const d = docWith('<div id="host"></div>');
    applyOps(d, [{ op: "insertHTML", id: "host", value: '<a id="out" href="//evil.example/x">x</a>' }]);
    expect(d.getElementById("out")!.hasAttribute("href")).toBe(false);
  });

  it("keeps an allowlisted relative href inside a replaceHTML payload", () => {
    const d = docWith('<div id="host"></div>');
    applyOps(d, [{ op: "replaceHTML", id: "host", value: '<a id="ok" href="#tab2">x</a>' }]);
    expect(d.getElementById("ok")!.getAttribute("href")).toBe("#tab2");
  });

  it("strips srcdoc inside an HTML payload", () => {
    const d = docWith('<div id="host"></div>');
    applyOps(d, [{ op: "replaceHTML", id: "host", value: '<iframe id="f" srcdoc="<b>x</b>"></iframe>' }]);
    expect(d.getElementById("f")!.hasAttribute("srcdoc")).toBe(false);
  });

  it("does not drop a tag-free text payload", () => {
    const d = docWith('<div id="host"></div>');
    const r = applyOps(d, [{ op: "insertHTML", id: "host", value: "just text" }]);
    expect(r.applied).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
    expect(d.getElementById("host")!.textContent).toBe("just text");
  });
});
