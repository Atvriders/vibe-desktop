import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowFrame, type WinState } from "./WindowFrame";

const base: WinState = { id: "w1", title: "Calculator", icon: "🧮", html: "<div id=\"d\">0</div>", w: 520, h: 380, loading: false, x: 10, y: 10, z: 1, minimized: false, maximized: false };

describe("WindowFrame", () => {
  it("shows the title and closes on the close button", () => {
    const onClose = vi.fn();
    render(<WindowFrame win={base} onClose={onClose} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} />);
    expect(screen.getByText(/Calculator/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledWith("w1");
  });

  it("shows a boot screen while loading", () => {
    render(<WindowFrame win={{ ...base, loading: true, html: "" }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} />);
    expect(screen.getByText(/Hallucinating Calculator/)).toBeInTheDocument();
  });

  it("renders nothing when minimized", () => {
    const { container } = render(<WindowFrame win={{ ...base, minimized: true }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a Maximize button and calls onToggleMax when clicked", () => {
    const onToggleMax = vi.fn();
    render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={onToggleMax} />);
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Maximize"));
    expect(onToggleMax).toHaveBeenCalledWith("w1");
  });
});
