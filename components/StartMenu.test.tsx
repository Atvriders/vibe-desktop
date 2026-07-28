import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StartMenu } from "./StartMenu";

describe("StartMenu", () => {
  it("lists built-in apps and opens one", () => {
    const onOpen = vi.fn();
    render(<StartMenu onOpen={onOpen} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Settings"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "settings", name: "Settings" }));
  });

  it("sits above every window", () => {
    const { container } = render(<StartMenu onOpen={vi.fn()} onClose={() => {}} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("z-[1000]");
  });
});
