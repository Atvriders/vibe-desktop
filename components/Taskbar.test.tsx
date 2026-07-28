import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Taskbar } from "./Taskbar";
import type { WinState } from "./WindowFrame";

const win = (over: Partial<WinState> = {}): WinState => ({
  id: "w1", title: "Calculator", icon: "🧮", html: "", w: 520, h: 380,
  loading: false, x: 0, y: 0, z: 1, minimized: false, maximized: false, ...over,
});

describe("Taskbar", () => {
  it("sits above every window", () => {
    render(<Taskbar windows={[]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={vi.fn()} />);
    expect(screen.getByTestId("taskbar").className).toContain("z-[1000]");
  });

  it("marks a visible window pressed and a minimized window not pressed", () => {
    const { rerender } = render(<Taskbar windows={[win()]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Calculator/ })).toHaveAttribute("aria-pressed", "true");
    rerender(<Taskbar windows={[win({ minimized: true })]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Calculator/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onActivate with the window id", () => {
    const onActivate = vi.fn();
    render(<Taskbar windows={[win()]} onStart={vi.fn()} onSearch={vi.fn()} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button", { name: /Calculator/ }));
    expect(onActivate).toHaveBeenCalledWith("w1");
  });
});
