import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Clock } from "./Clock";

describe("Clock", () => {
  it("renders without throwing and contains a digit", () => {
    const { container } = render(<Clock />);
    expect(container.textContent).toMatch(/\d/);
  });
});
