import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Spotlight } from "./Spotlight";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ cards: [{ id: "1", name: "Synthy", icon: "🎹", blurb: "make noise" }] }),
  })));
});

describe("Spotlight", () => {
  it("searches and opens a result card", async () => {
    const onOpen = vi.fn();
    render(<Spotlight onOpen={onOpen} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/type any app/i), { target: { value: "a synth" } });
    fireEvent.submit(screen.getByPlaceholderText(/type any app/i));
    const card = await screen.findByText("Synthy");
    fireEvent.click(card);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "Synthy" })));
  });
});
