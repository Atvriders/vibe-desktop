import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopIcons } from "./DesktopIcons";

describe("DesktopIcons", () => {
  it("renders Files label", () => {
    render(<DesktopIcons onOpen={vi.fn()} />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("clicking Files calls onOpen with the files card", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Files"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "files" }));
  });
});
