import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopContextMenu } from "./DesktopContextMenu";

describe("DesktopContextMenu", () => {
  it("fires New app and Settings actions", () => {
    const onNewApp = vi.fn(), onSettings = vi.fn();
    render(<DesktopContextMenu x={5} y={5} onNewApp={onNewApp} onSettings={onSettings} />);
    fireEvent.click(screen.getByText("New app…"));
    fireEvent.click(screen.getByText("Settings"));
    expect(onNewApp).toHaveBeenCalled();
    expect(onSettings).toHaveBeenCalled();
  });

  it("sits above every window", () => {
    const { container } = render(<DesktopContextMenu x={5} y={5} onNewApp={vi.fn()} onSettings={vi.fn()} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("z-[1100]");
  });
});
