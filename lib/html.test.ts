import { describe, it, expect } from "vitest";
import { stripFences } from "./html";

describe("stripFences", () => {
  it("removes a ```html code fence", () => {
    expect(stripFences('```html\n<div id="d">x</div>\n```')).toBe('<div id="d">x</div>');
  });
  it("removes a bare ``` fence", () => {
    expect(stripFences("```\n<p>hi</p>\n```")).toBe("<p>hi</p>");
  });
  it("leaves unfenced html unchanged", () => {
    expect(stripFences("<div>x</div>")).toBe("<div>x</div>");
  });
  it("trims surrounding whitespace", () => {
    expect(stripFences("  <span>y</span>  ")).toBe("<span>y</span>");
  });
});
