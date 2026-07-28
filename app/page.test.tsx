import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import Desktop from "./page";

let fetchMock: ReturnType<typeof vi.fn>;
let opened = 0;

beforeEach(() => {
  opened = 0;
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/search") {
      return { ok: true, status: 200, json: async () => ({ cards: [{ id: "s1", name: "Lumefold", icon: "🎛️", blurb: "folds waveforms into light" }] }) };
    }
    if (url === "/api/window/open") {
      opened += 1;
      const n = opened;
      return { ok: true, status: 200, json: async () => ({ windowId: `w-${n}`, html: `<div id="a">A${n}</div>`, usage: { ms: 1700, inputTokens: 10, outputTokens: 20, cacheReadTokens: 4100 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Open a Start-menu builtin and wait for its window to finish loading.
 *  Use names that are NOT on the desktop (Calculator, Terminal, Paint, Mail) —
 *  DesktopIcons renders Settings/Files/Web Browser/Notepad/Music too. */
async function openFromStart(name: string) {
  fireEvent.click(screen.getByLabelText("Start"));
  fireEvent.click(await screen.findByText(name));
  await screen.findByTitle(name);
}

const winRoot = (id: string) => document.querySelector(`[data-window-id="${id}"]`) as HTMLElement;
const taskbar = () => screen.getByTestId("taskbar");
const openBodies = () =>
  fetchMock.mock.calls.filter((c) => c[0] === "/api/window/open").map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe("Desktop", () => {
  it("minimizes a window without unmounting it, and restores it", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    expect(winRoot("w-1").style.display).toBe("");

    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(winRoot("w-1")).not.toBeNull();
    expect(winRoot("w-1").style.display).toBe("none");

    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(winRoot("w-1").style.display).toBe("");
  });

  it("minimizes the top window from the taskbar and restores it", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    const button = within(taskbar()).getByRole("button", { name: /Calculator/ });

    fireEvent.click(button);
    expect(winRoot("w-1").style.display).toBe("none");

    fireEvent.click(within(taskbar()).getByRole("button", { name: /Calculator/ }));
    expect(winRoot("w-1").style.display).toBe("");
  });

  it("raises a buried window from the taskbar instead of minimizing it", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));

    fireEvent.click(within(taskbar()).getByRole("button", { name: /Calculator/ }));
    expect(winRoot("w-1").style.display).toBe("");
    expect(Number(winRoot("w-1").style.zIndex)).toBeGreaterThan(Number(winRoot("w-2").style.zIndex));
  });

  it("gives each window a distinct z when two are raised in the same batch", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");

    // fireEvent wraps each dispatch in its own act(); nesting them inside one
    // outer act() queues both updates and flushes them together, which is what
    // happens in the app when two focus() calls share a batch. A non-functional
    // `const z = seq + 1` reads the same stale `seq` twice and hands out one z
    // to both windows.
    await act(async () => {
      fireEvent.pointerDown(winRoot("w-1"));
      fireEvent.pointerDown(winRoot("w-2"));
    });
    expect(winRoot("w-1").style.zIndex).not.toBe(winRoot("w-2").style.zIndex);
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));
  });

  it("raises whichever window was focused last, repeatedly", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");

    fireEvent.pointerDown(winRoot("w-1"));
    expect(Number(winRoot("w-1").style.zIndex)).toBeGreaterThan(Number(winRoot("w-2").style.zIndex));

    fireEvent.pointerDown(winRoot("w-2"));
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));

    fireEvent.pointerDown(winRoot("w-1"));
    expect(Number(winRoot("w-1").style.zIndex)).toBeGreaterThan(Number(winRoot("w-2").style.zIndex));
  });

  it("never lets a raised window reach the shell's layer", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    for (let i = 0; i < 30; i++) fireEvent.pointerDown(winRoot("w-1"));
    expect(Number(winRoot("w-1").style.zIndex)).toBeLessThanOrEqual(900);
  });

  it("ranks z by window count, so repeated raises can never saturate the ceiling", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");

    for (let i = 0; i < 40; i++) {
      fireEvent.pointerDown(winRoot("w-1"));
      fireEvent.pointerDown(winRoot("w-2"));
    }
    // Two windows can only ever occupy the two lowest slots of the band. A
    // monotonic counter climbs instead, and once it passes MAX_WINDOW_Z every
    // window clamps to the same value and raise-on-click stops working.
    expect(Number(winRoot("w-1").style.zIndex)).toBe(11);
    expect(Number(winRoot("w-2").style.zIndex)).toBe(12);
  });

  it("re-ranks on open too, so open/close churn cannot climb the band", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    await openFromStart("Terminal");
    fireEvent.click(within(winRoot("w-1")).getByLabelText("Close"));
    await openFromStart("Paint");

    // Opening does not focus anything, so without re-ranking here the closed
    // window's slot is never reclaimed and z creeps up one per open forever.
    expect(Number(winRoot("w-2").style.zIndex)).toBe(11);
    expect(Number(winRoot("w-3").style.zIndex)).toBe(12);
  });

  it("keeps two windows opened in the same React batch distinct", async () => {
    render(<Desktop />);
    // Both clicks land in one batch, so both openApp calls run against the same
    // render's state: a `const z = seq + 1` read hands both windows the same
    // temporary id, and the first response then renames both of them.
    await act(async () => {
      fireEvent.click(screen.getByText("Files"));
      fireEvent.click(screen.getByText("Notepad"));
    });
    await screen.findByTitle("Files");
    await screen.findByTitle("Notepad");

    expect(winRoot("w-1")).not.toBeNull();
    expect(winRoot("w-2")).not.toBeNull();
    expect(Number(winRoot("w-2").style.zIndex)).toBeGreaterThan(Number(winRoot("w-1").style.zIndex));
  });

  it("toggles Spotlight with Ctrl+K and Cmd+K", () => {
    render(<Desktop />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByPlaceholderText(/type any app/i)).toBeNull();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();
  });

  it("closes Spotlight, the Start menu and the context menu with Escape", () => {
    render(<Desktop />);

    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/type any app/i)).toBeNull();

    fireEvent.click(screen.getByLabelText("Start"));
    expect(screen.getByText("Paint")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Paint")).toBeNull();

    fireEvent.contextMenu(document.querySelector("main") as HTMLElement);
    expect(screen.getByText("New app…")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("New app…")).toBeNull();
  });

  it("toggles Spotlight from a Ctrl+K pressed INSIDE an open app's iframe", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    const frame = screen.getByTitle("Calculator") as HTMLIFrameElement;
    // Wait for jsdom's iframe load so WindowFrame's in-frame listeners are attached.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const doc = frame.contentDocument as Document;
    doc.body.innerHTML = '<input id="q" />';
    const view = doc.defaultView as Window & typeof globalThis;

    // The host binds keydown on the host document; an in-frame keydown does not
    // propagate there, so this only works because WindowFrame forwards it.
    act(() => {
      doc.getElementById("q")!.dispatchEvent(new view.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(screen.getByPlaceholderText(/type any app/i)).toBeInTheDocument();

    act(() => {
      doc.getElementById("q")!.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(screen.queryByPlaceholderText(/type any app/i)).toBeNull();
  });

  it("sends a builtin's blurb and no query", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    expect(openBodies()[0]).toEqual({ appName: "Calculator", blurb: "Crunch numbers" });
  });

  it("sends the searched card's blurb and the raw typed query", async () => {
    render(<Desktop />);
    fireEvent.click(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByPlaceholderText(/type any app/i), { target: { value: "a synth with 3 oscillators" } });
    fireEvent.submit(screen.getByPlaceholderText(/type any app/i));
    fireEvent.click(await screen.findByText("Lumefold"));
    await screen.findByTitle("Lumefold");
    expect(openBodies()[0]).toEqual({
      appName: "Lumefold",
      blurb: "folds waveforms into light",
      query: "a synth with 3 oscillators",
    });
  });

  it("maximizes to exactly the viewport minus the taskbar", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    fireEvent.click(screen.getByLabelText("Maximize"));
    // 64 is TASKBAR_H; a hardcoded copy three lines from the constant is how the
    // two drift apart.
    expect(winRoot("w-1").style.height).toBe(`${window.innerHeight - 64}px`);
    expect(winRoot("w-1").style.width).toBe(`${window.innerWidth}px`);
  });

  it("closes the server session when a window is closed while its open is still in flight", async () => {
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/window/open") {
        await new Promise<void>((r) => { release = r; });
        return { ok: true, status: 200, json: async () => ({ windowId: "w-late", html: "<div id=\"a\">A</div>", usage: undefined }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    render(<Desktop />);
    fireEvent.click(screen.getByLabelText("Start"));
    fireEvent.click(await screen.findByText("Calculator"));
    // Still loading: the window carries a tmp- id and the real windowId does not
    // exist client-side yet.
    expect(screen.getByText(/Hallucinating Calculator/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText(/Hallucinating Calculator/)).toBeNull();

    await act(async () => { release!(); await new Promise((r) => setTimeout(r, 0)); });

    const closes = fetchMock.mock.calls.filter((c) => c[0] === "/api/window/close");
    expect(closes).toHaveLength(1);
    expect(JSON.parse((closes[0][1] as RequestInit).body as string)).toEqual({ windowId: "w-late" });
    // …and the late response must not resurrect the window.
    expect(winRoot("w-late")).toBeNull();
  });

  it("names the actual failure instead of blaming the API key for every status", async () => {
    const cases: Array<[number, RegExp]> = [
      [429, /Too many requests/],
      [503, /overloaded/],
      [504, /took too long/],
      [502, /check your API key/],
    ];
    for (const [status, expected] of cases) {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === "/api/window/open") return { ok: false, status, json: async () => ({ error: "nope" }) };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      });
      render(<Desktop />);
      fireEvent.click(screen.getByLabelText("Start"));
      fireEvent.click(await screen.findByText("Calculator"));
      const frame = (await screen.findByTitle("Calculator")) as HTMLIFrameElement;
      expect(frame.getAttribute("srcdoc"), `status ${status}`).toMatch(expected);
      cleanup();
    }
  });

  it("shows the open call's latency in the window chrome", async () => {
    render(<Desktop />);
    await openFromStart("Calculator");
    expect(screen.getByTestId("usage-chip")).toHaveTextContent("1.7s · 4.1k cached");
  });
});
