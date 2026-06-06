import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowFrame, type WinState } from "./WindowFrame";

const win: WinState = { id: "w1", title: "Calculator", html: "<div id=\"d\">0</div>", x: 10, y: 10, z: 1, minimized: false };

describe("WindowFrame", () => {
  it("shows the title and closes on the close button", () => {
    const onClose = vi.fn();
    render(<WindowFrame win={win} onClose={onClose} onFocus={() => {}} onMove={() => {}} />);
    expect(screen.getByText("Calculator")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledWith("w1");
  });

  it("renders nothing when minimized", () => {
    const { container } = render(<WindowFrame win={{ ...win, minimized: true }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
