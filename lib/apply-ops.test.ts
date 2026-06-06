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

  it("allows setAttr with a safe https URL", () => {
    const d = docWith('<a id="l">x</a>');
    applyOps(d, [{ op: "setAttr", id: "l", attr: "href", value: "https://example.com/" }]);
    expect(d.getElementById("l")!.getAttribute("href")).toBe("https://example.com/");
  });

  it("allows setAttr on a non-URL presentational attribute (style)", () => {
    const d = docWith('<div id="dv"></div>');
    applyOps(d, [{ op: "setAttr", id: "dv", attr: "style", value: "color:red" }]);
    expect(d.getElementById("dv")!.getAttribute("style")).toBe("color:red");
  });
});
