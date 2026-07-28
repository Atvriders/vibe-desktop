import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { WindowFrame, formatUsage, type WinState } from "./WindowFrame";
import { byteLength } from "@/lib/byte-cap";
import { MAX_BODY_BYTES } from "@/lib/http-guard";
import { MAX_INPUTS_LEN, MAX_SNAPSHOT_LEN } from "@/lib/types";

const base: WinState = { id: "w1", title: "Calculator", icon: "🧮", html: "<div id=\"d\">0</div>", w: 520, h: 380, loading: false, x: 10, y: 10, z: 1, minimized: false, maximized: false };

describe("WindowFrame", () => {
  it("shows the title and closes on the close button", () => {
    const onClose = vi.fn();
    render(<WindowFrame win={base} onClose={onClose} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
    expect(screen.getByText(/Calculator/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledWith("w1");
  });

  it("shows a boot screen while loading", () => {
    render(<WindowFrame win={{ ...base, loading: true, html: "" }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
    expect(screen.getByText(/Hallucinating Calculator/)).toBeInTheDocument();
  });

  it("keeps a minimized window mounted but hidden (its DOM is the only copy of applied ops)", () => {
    render(<WindowFrame win={{ ...base, minimized: true }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
    const root = document.querySelector('[data-window-id="w1"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.display).toBe("none");
    expect(screen.getByTitle("Calculator")).toBeInTheDocument();
  });

  it("has a Minimize button wired to onToggleMinimize", () => {
    const onToggleMinimize = vi.fn();
    render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={onToggleMinimize} />);
    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(onToggleMinimize).toHaveBeenCalledWith("w1");
  });

  it("shows a Maximize button and calls onToggleMax when clicked", () => {
    const onToggleMax = vi.fn();
    render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={onToggleMax} onToggleMinimize={() => {}} />);
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Maximize"));
    expect(onToggleMax).toHaveBeenCalledWith("w1");
  });

  it("offsets and clamps the window z-index so it can never cover the shell", () => {
    const { rerender } = render(<WindowFrame win={{ ...base, z: 1 }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
    const root = document.querySelector('[data-window-id="w1"]') as HTMLElement;
    expect(root.style.zIndex).toBe("11");
    rerender(<WindowFrame win={{ ...base, z: 5000 }} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
    expect(root.style.zIndex).toBe("900");
  });

  describe("drag and resize", () => {
    const original = Element.prototype.setPointerCapture;
    let capture: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      capture = vi.fn();
      // jsdom implements neither pointer-capture method; install a spy so the
      // production feature-detect finds one and we can assert on it.
      Element.prototype.setPointerCapture = capture as unknown as Element["setPointerCapture"];
    });
    afterEach(() => { Element.prototype.setPointerCapture = original; });

    it("captures the pointer and drags from the title bar", () => {
      const onMove = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const bar = screen.getByTestId("titlebar");

      fireEvent.pointerDown(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      expect(capture).toHaveBeenCalledWith(7);

      fireEvent.pointerMove(bar, { pointerId: 7, clientX: 140, clientY: 130 });
      expect(onMove).toHaveBeenCalledWith("w1", 50, 40);
    });

    it("does not listen on window, and stops on pointerup", () => {
      const onMove = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const bar = screen.getByTestId("titlebar");

      fireEvent.pointerDown(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();

      fireEvent.pointerUp(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(bar, { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("ends the drag on pointercancel", () => {
      const onMove = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const bar = screen.getByTestId("titlebar");

      fireEvent.pointerDown(bar, { pointerId: 7, clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(bar, { pointerId: 7 });
      fireEvent.pointerMove(bar, { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("does not start a drag from a title-bar button", () => {
      const onMove = vi.fn();
      const onClose = vi.fn();
      render(<WindowFrame win={base} onClose={onClose} onFocus={() => {}} onMove={onMove} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);

      fireEvent.pointerDown(screen.getByLabelText("Close"), { pointerId: 7, clientX: 100, clientY: 100 });
      expect(capture).not.toHaveBeenCalled();
      fireEvent.pointerMove(screen.getByLabelText("Close"), { pointerId: 7, clientX: 400, clientY: 400 });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("captures the pointer and resizes from the south-east handle", () => {
      const onResize = vi.fn();
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={onResize} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const handle = screen.getByTestId("resize-se");

      fireEvent.pointerDown(handle, { pointerId: 3, clientX: 200, clientY: 200 });
      expect(capture).toHaveBeenCalledWith(3);

      fireEvent.pointerMove(handle, { pointerId: 3, clientX: 260, clientY: 240 });
      expect(onResize).toHaveBeenCalledWith("w1", 10, 10, 580, 420);

      fireEvent.pointerUp(handle, { pointerId: 3 });
      onResize.mockClear();
      fireEvent.pointerMove(handle, { pointerId: 3, clientX: 400, clientY: 400 });
      expect(onResize).not.toHaveBeenCalled();
    });
  });

  describe("the patch loop", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ops: [], stopReason: "tool_use" }) }));
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    /** Render a window and wait for jsdom's iframe load (a macrotask) so the
     *  component's listeners are attached. Never fireEvent.load — the natural
     *  load also fires and you would get two listeners. jsdom does not parse
     *  srcDoc, so the frame body is written here. */
    async function mountLoaded(over: Partial<WinState> = {}) {
      const win = { ...base, ...over };
      const utils = render(<WindowFrame win={win} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const iframe = screen.getByTitle(win.title) as HTMLIFrameElement;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const doc = iframe.contentDocument as Document;
      doc.body.innerHTML = '<button id="go">Go</button><input id="q" value="hello" />';
      return { ...utils, iframe, doc };
    }

    function stubRect(doc: Document, width: number, height: number) {
      doc.documentElement.getBoundingClientRect = () =>
        ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;
    }

    function clickIn(doc: Document, id: string, clientX = 0, clientY = 0) {
      const view = doc.defaultView as Window & typeof globalThis;
      const evt = new view.MouseEvent("click", { bubbles: true, cancelable: true, clientX, clientY });
      act(() => { doc.getElementById(id)!.dispatchEvent(evt); });
      return evt;
    }

    const rawBody = () => (fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string;
    const lastBody = () => JSON.parse(rawBody());
    const settle = () => act(async () => { await Promise.resolve(); });

    it("posts clamped percent coordinates and the harvested field values", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      clickIn(doc, "go", 300, 25);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(fetchMock.mock.calls[0][0]).toBe("/api/window/patch");
      expect(lastBody()).toMatchObject({ windowId: "w1", elementId: "go", x: 100, y: 25, action: "click" });
      expect(lastBody().inputs).toEqual({ q: "hello" });
      expect(lastBody().domSnapshot).toBeUndefined();
      await settle();
    });

    it("never posts NaN when the frame has no layout", async () => {
      const { doc } = await mountLoaded();
      clickIn(doc, "go", 50, 50);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(lastBody()).toMatchObject({ x: 100, y: 100 });
      await settle();
    });

    it("sends a full DOM snapshot on every tenth click", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      for (let i = 1; i <= 10; i++) {
        clickIn(doc, "go", 10, 10);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i));
        await settle();
        if (i < 10) expect(lastBody().domSnapshot, `click ${i}`).toBeUndefined();
        else expect(lastBody().domSnapshot, "click 10").toContain('id="go"');
      }
    });

    it("self-heals: a dropped op makes the next click carry a snapshot", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "does-not-exist", value: "x" }], stopReason: "tool_use" }),
      }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();
      expect(lastBody().domSnapshot).toBeUndefined();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();
      expect(lastBody().domSnapshot).toContain('id="go"');
    });

    it("truncates an oversize DOM snapshot before the POST, so the body guard cannot 413 it", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      // An uncapped snapshot is JSON-escaped into the body, which roughly doubles
      // an HTML document — a ~130KB DOM used to blow http-guard's 256KB ceiling.
      // The 413 sets needsResync, which re-sends the SAME oversize snapshot on
      // every later click: the window never recovers.
      doc.body.innerHTML = `<button id="go">Go</button><div id="pad">${"x".repeat(150_000)}</div>`;
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "does-not-exist", value: "x" }], stopReason: "tool_use" }),
      }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();
      const snapshot = lastBody().domSnapshot as string;
      expect(doc.body.innerHTML.length).toBeGreaterThan(MAX_SNAPSHOT_LEN);
      expect(snapshot).toHaveLength(MAX_SNAPSHOT_LEN);
      // …and comfortably under half the 256KB body cap, even after escaping.
      expect(JSON.stringify((fetchMock.mock.calls.at(-1)![1] as RequestInit).body).length).toBeLessThan(256 * 1024);
    });

    /** The cap has to be measured in the unit the guard rejects on. http-guard reads
     *  `content-length`, which counts BYTES; `String.slice` counts UTF-16 code units.
     *  A DOM of CJK or emoji is 3–4 bytes per unit, so a snapshot comfortably inside
     *  the character cap was ~300KB on the wire — a 413, which sets needsResync,
     *  which forces the SAME oversize body onto every later click. Permanent wedge. */
    it("caps the snapshot in BYTES, so a multi-byte DOM cannot 413 the body guard", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      doc.body.innerHTML = `<button id="go">Go</button><div id="pad">${"漢".repeat(90_000)}</div>`;
      // The exact shape of the bug: under the character cap, over the byte cap.
      expect(doc.body.innerHTML.length).toBeLessThan(MAX_SNAPSHOT_LEN);
      expect(byteLength(doc.body.innerHTML)).toBeGreaterThan(MAX_BODY_BYTES);
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "does-not-exist", value: "x" }], stopReason: "tool_use" }),
      }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();

      const snapshot = lastBody().domSnapshot as string;
      expect(snapshot).toContain('id="go"');
      expect(byteLength(snapshot)).toBeLessThanOrEqual(MAX_SNAPSHOT_LEN);
      // The whole request, in the unit content-length reports it in.
      expect(byteLength(rawBody())).toBeLessThan(MAX_BODY_BYTES);
    });

    /** Same wedge, different field: `inputs` is harvested from every id'd control on
     *  every click. lib/engine.ts caps the joined clause at MAX_FIELDS_LEN, but that
     *  runs long after the guard has already 413'd the request. */
    it("caps harvested field values, so a large textarea cannot 413 the body guard", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      // A full-size snapshot rides along on the same click, so this pins that the two
      // budgets compose rather than each being fine on its own. Setting .value (not
      // the child text) keeps the textarea's bulk out of innerHTML, so the snapshot
      // and the field are independently oversize.
      doc.body.innerHTML =
        `<button id="go">Go</button><textarea id="notes"></textarea><div id="pad">${"x".repeat(150_000)}</div>`;
      (doc.getElementById("notes") as HTMLTextAreaElement).value = "z".repeat(400_000);
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "does-not-exist", value: "x" }], stopReason: "tool_use" }),
      }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();

      const inputs = lastBody().inputs as Record<string, string>;
      expect(inputs.notes.length).toBeLessThan(400_000);
      expect(byteLength(JSON.stringify(inputs))).toBeLessThanOrEqual(MAX_INPUTS_LEN + 64);
      expect(lastBody().domSnapshot).toContain('id="go"');
      expect(byteLength(rawBody())).toBeLessThan(MAX_BODY_BYTES);
    });

    it("applies returned ops to the live frame document", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [{ op: "setText", id: "go", value: "Done" }], stopReason: "tool_use" }),
      }));
      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(doc.getElementById("go")!.textContent).toBe("Done"));
      await settle();
    });

    it("uses the CURRENT props from the once-attached listener", async () => {
      const onFocusFirst = vi.fn();
      const onFocusLater = vi.fn();
      const { rerender } = render(<WindowFrame win={base} onClose={() => {}} onFocus={onFocusFirst} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      const iframe = screen.getByTitle("Calculator") as HTMLIFrameElement;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const doc = iframe.contentDocument as Document;
      doc.body.innerHTML = '<button id="go">Go</button>';

      // The desktop swaps the temporary id for the real windowId and re-renders.
      rerender(<WindowFrame win={{ ...base, id: "w2" }} onClose={() => {}} onFocus={onFocusLater} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(lastBody().windowId).toBe("w2");
      expect(onFocusLater).toHaveBeenCalledWith("w2");
      expect(onFocusFirst).not.toHaveBeenCalled();
      await settle();
    });

    it("shows a lost-session banner on 404 and keeps the resync queued", async () => {
      const { doc } = await mountLoaded();
      stubRect(doc, 200, 100);
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404, json: async () => ({ error: "unknown window" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Lost the thread — reopen this window"));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await settle();
      expect(lastBody().domSnapshot).toContain('id="go"');
    });

    it("keeps the lost-session banner up while the retry is still in flight", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404, json: async () => ({ error: "unknown window" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Lost the thread — reopen this window"));
      await settle();

      // Blanking the banner at the top of every send made it flicker off for a
      // whole round trip on a session the server has already declared unknown.
      fetchMock.mockImplementationOnce(() => new Promise(() => {}));
      clickIn(doc, "go", 10, 10);
      expect(screen.getByTestId("patch-banner")).toHaveTextContent("Lost the thread — reopen this window");
    });

    // patchWindow's reseed path (lib/engine.ts) leaves session.messages ending in an
    // unanswered user turn when the model call throws, and its comment says "the next
    // snapshot replaces the array anyway". That is only true because of THIS contract:
    // every failed patch, of any kind, queues a snapshot for the next click. Pinned
    // here so the invariant cannot be broken from the client side unnoticed.
    it("queues a resync after EVERY kind of patch failure — the server's reseed relies on it", async () => {
      for (const fail of [
        async () => ({ ok: false, status: 502, json: async () => ({ error: "patch failed" }) }),
        async () => ({ ok: false, status: 503, json: async () => ({ error: "overloaded" }) }),
        async () => ({ ok: false, status: 504, json: async () => ({ error: "timeout" }) }),
        async () => { throw new Error("offline"); },
      ] as Array<() => Promise<unknown>>) {
        fetchMock.mockClear();
        const { doc, unmount } = await mountLoaded();
        stubRect(doc, 200, 100);
        fetchMock.mockImplementationOnce(fail);

        clickIn(doc, "go", 10, 10);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await settle();
        expect(lastBody().domSnapshot).toBeUndefined();

        clickIn(doc, "go", 10, 10);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await settle();
        expect(lastBody().domSnapshot).toContain('id="go"');
        unmount();
      }
    });

    it("shows an unavailable banner on 502 and clears it on the next success", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 502, json: async () => ({ error: "patch failed" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Model unavailable — click to retry"));
      await settle();

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.queryByTestId("patch-banner")).toBeNull());
      await settle();
    });

    it("shows the unavailable banner when the request itself throws", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => { throw new Error("offline"); });

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toHaveTextContent("Model unavailable — click to retry"));
      await settle();
    });

    it("dismisses the banner", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({ error: "overloaded" }) }));

      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("patch-banner")).toBeInTheDocument());
      await settle();

      fireEvent.click(screen.getByLabelText("Dismiss"));
      expect(screen.queryByTestId("patch-banner")).toBeNull();
    });

    function keyIn(doc: Document, id: string, init: KeyboardEventInit) {
      const view = doc.defaultView as Window & typeof globalThis;
      const evt = new view.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      act(() => { doc.getElementById(id)!.dispatchEvent(evt); });
      return evt;
    }

    it("submits on Enter with the focused field's id and its value", async () => {
      const { doc } = await mountLoaded();
      const evt = keyIn(doc, "q", { key: "Enter" });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      expect(lastBody()).toMatchObject({ windowId: "w1", elementId: "q", action: "submit", x: 0, y: 0 });
      expect(lastBody().inputs).toEqual({ q: "hello" });
      expect(evt.defaultPrevented).toBe(true);
      await settle();
    });

    it("ignores Shift+Enter and every other key, but not a plain Enter", async () => {
      const { doc } = await mountLoaded();
      keyIn(doc, "q", { key: "Enter", shiftKey: true });
      keyIn(doc, "q", { key: "a" });
      keyIn(doc, "q", { key: "Escape" });
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();

      // Without this the test would also pass with no keydown listener at all.
      keyIn(doc, "q", { key: "Enter" });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();
    });

    it("forwards Escape and Ctrl/Cmd+K out of the iframe onto the host document", async () => {
      const { doc } = await mountLoaded();
      // A keydown raised inside a same-origin iframe never reaches the parent
      // document, so without forwarding the desktop's shortcuts are dead as soon
      // as the user clicks into any app. jsdom models that separation, so every
      // host keydown seen here came from the component re-dispatching it.
      const seen: string[] = [];
      const onHostKey = (e: Event) => {
        const k = e as KeyboardEvent;
        seen.push(`${k.ctrlKey ? "ctrl+" : ""}${k.metaKey ? "meta+" : ""}${k.key}`);
      };
      document.addEventListener("keydown", onHostKey);
      try {
        const esc = keyIn(doc, "q", { key: "Escape" });
        const ctrlK = keyIn(doc, "q", { key: "k", ctrlKey: true });
        keyIn(doc, "q", { key: "K", metaKey: true });
        expect(seen).toEqual(["Escape", "ctrl+k", "meta+K"]);
        // Ctrl+K has a browser default worth killing; Escape has none.
        expect(ctrlK.defaultPrevented).toBe(true);
        expect(esc.defaultPrevented).toBe(false);
        // And none of the three costs a model round trip.
        expect(fetchMock).not.toHaveBeenCalled();

        // Enter still goes to the patch pipeline and is NOT forwarded.
        keyIn(doc, "q", { key: "Enter" });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(seen).toHaveLength(3);
      } finally {
        document.removeEventListener("keydown", onHostKey);
      }
      await settle();
    });

    it("sends one patch at a time, so a held Enter or the ✨ bar cannot overlap requests", async () => {
      const { doc } = await mountLoaded();
      // The busy overlay only swallows clicks inside the frame; the in-frame
      // keydown path and the title-bar instruction bar both route around it.
      fetchMock.mockImplementation(() => new Promise(() => {}));

      // Typed before anything is in flight: the guard must drop the send
      // without destroying what the user wrote.
      fireEvent.click(screen.getByLabelText("Ask this app"));
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "make it blue" } });

      keyIn(doc, "q", { key: "Enter" });
      keyIn(doc, "q", { key: "Enter" });
      keyIn(doc, "q", { key: "Enter" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.submit(screen.getByLabelText("Instruction"));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Dropped, not eaten — the bar is still open and still holds the text.
      expect(screen.getByLabelText("Instruction")).toHaveValue("make it blue");
    });

    it("disables the ✨ button and the instruction field while a patch is in flight", async () => {
      const { doc } = await mountLoaded();
      fetchMock.mockImplementation(() => new Promise(() => {}));

      fireEvent.click(screen.getByLabelText("Ask this app"));
      expect(screen.getByLabelText("Instruction")).not.toBeDisabled();

      keyIn(doc, "q", { key: "Enter" });
      expect(screen.getByTestId("busy-pill")).toBeInTheDocument();
      // Silent unavailability is what let the typed text vanish; make it visible.
      expect(screen.getByLabelText("Ask this app")).toBeDisabled();
      expect(screen.getByLabelText("Instruction")).toBeDisabled();
    });

    it("posts a free-text instruction from the title bar", async () => {
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);
      expect(screen.queryByLabelText("Instruction")).toBeNull();

      fireEvent.click(screen.getByLabelText("Ask this app"));
      const input = screen.getByLabelText("Instruction");
      fireEvent.change(input, { target: { value: "make the buttons bigger" } });
      fireEvent.submit(input);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0][0]).toBe("/api/window/patch");
      expect(lastBody()).toMatchObject({ windowId: "w1", elementId: null, x: 0, y: 0, instruction: "make the buttons bigger" });
      expect(lastBody().action).toBeUndefined();
      await settle();
    });

    it("closes the instruction bar after sending and ignores an empty one", async () => {
      render(<WindowFrame win={base} onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}} />);

      fireEvent.click(screen.getByLabelText("Ask this app"));
      fireEvent.submit(screen.getByLabelText("Instruction"));
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "undo that" } });
      fireEvent.submit(screen.getByLabelText("Instruction"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByLabelText("Instruction")).toBeNull();
      await settle();
    });

    it("cancels the in-frame default so a model-authored link cannot navigate", async () => {
      const { doc } = await mountLoaded();
      doc.body.innerHTML = '<a id="out" href="http://attacker.example/?d=x">Continue</a>';
      const evt = clickIn(doc, "out", 10, 10);
      expect(evt.defaultPrevented).toBe(true);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await settle();
    });

    it("sanitizes the initial HTML before it reaches srcDoc", () => {
      render(
        <WindowFrame
          win={{ ...base, html: '<div id="d" onclick="steal()">hi</div><script>alert(1)</script>' }}
          onClose={() => {}} onFocus={() => {}} onMove={() => {}} onResize={() => {}} onToggleMax={() => {}} onToggleMinimize={() => {}}
        />,
      );
      const srcdoc = (screen.getByTitle("Calculator") as HTMLIFrameElement).getAttribute("srcdoc") as string;
      expect(srcdoc).toContain('<div id="d">hi</div>');
      expect(srcdoc).not.toContain("alert(1)");
      expect(srcdoc).not.toContain("onclick");
    });

    it("formats a usage chip from seconds and cache reads", () => {
      expect(formatUsage({ ms: 1700, inputTokens: 900, outputTokens: 300, cacheReadTokens: 4100 })).toBe("1.7s · 4.1k cached");
      expect(formatUsage({ ms: 940, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 })).toBe("0.9s");
      expect(formatUsage({ ms: 2000, inputTokens: 10, outputTokens: 5, cacheReadTokens: 512 })).toBe("2.0s · 512 cached");
    });

    it("shows the open call's usage, then replaces it with each patch's usage", async () => {
      const { doc } = await mountLoaded({ usage: { ms: 1700, inputTokens: 900, outputTokens: 300, cacheReadTokens: 4100 } });
      expect(screen.getByTestId("usage-chip")).toHaveTextContent("1.7s · 4.1k cached");

      fetchMock.mockImplementationOnce(async () => ({
        ok: true, status: 200,
        json: async () => ({ ops: [], stopReason: "tool_use", usage: { ms: 900, inputTokens: 20, outputTokens: 40, cacheReadTokens: 0 } }),
      }));
      clickIn(doc, "go", 10, 10);
      await waitFor(() => expect(screen.getByTestId("usage-chip")).toHaveTextContent("0.9s"));
      await settle();
    });

    it("ticks the elapsed seconds inside the busy pill", async () => {
      const { doc } = await mountLoaded();
      vi.useFakeTimers();
      try {
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        clickIn(doc, "go", 10, 10);
        expect(screen.getByTestId("busy-pill")).toHaveTextContent("0s");
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(screen.getByTestId("busy-pill")).toHaveTextContent("1s");
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(screen.getByTestId("busy-pill")).toHaveTextContent("3s");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
