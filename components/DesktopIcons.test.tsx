import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DesktopIcons } from "./DesktopIcons";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("DesktopIcons", () => {
  it("renders Files label", () => {
    render(<DesktopIcons onOpen={vi.fn()} />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("opens on a single click, so Enter/Space and touch work too", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Files"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "files" }));
  });

  it("opens once for a double-click, which a browser delivers as two clicks", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    // NOT fireEvent.doubleClick: that dispatches a single `dblclick` and nothing
    // else, so with no onDoubleClick handler it asserts nothing. A real
    // double-click on a <button> fires `click` twice before `dblclick`.
    const el = screen.getByText("Files");
    fireEvent.click(el);
    fireEvent.click(el);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens again once the repeat window has passed", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    const el = screen.getByText("Files");
    fireEvent.click(el);
    vi.advanceTimersByTime(600);
    fireEvent.click(el);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("guards each icon separately, so two different apps still open together", () => {
    const onOpen = vi.fn();
    render(<DesktopIcons onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Files"));
    fireEvent.click(screen.getByText("Notepad"));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen.mock.calls.map((c) => c[0].id)).toEqual(["files", "notepad"]);
  });
});
