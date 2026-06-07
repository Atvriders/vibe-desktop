import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopIcons } from "./DesktopIcons";

describe("DesktopIcons", () => {
  it("renders Files label", () => {
    render(<DesktopIcons onOpen={vi.fn()} />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("opens on double-click, not single click", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Files"));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByText("Files"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "files" }));
  });
});
