import { describe, it, expect } from "vitest";
import { newSession, getSession, deleteSession, sweepSessions, SESSION_TTL_MS, SESSION_MAX } from "./sessions";

describe("session store", () => {
  it("creates, retrieves, and deletes a session", () => {
    const s = newSession("Calculator");
    expect(s.id).toBeTruthy();
    expect(s.appName).toBe("Calculator");
    expect(s.messages).toEqual([]);
    expect(s.lastUsed).toBeGreaterThan(0);
    expect(getSession(s.id)).toBe(s);
    deleteSession(s.id);
    expect(getSession(s.id)).toBeUndefined();
  });

  it("round-trips detail", () => {
    const s = newSession("Lumefold", { blurb: "folds waveforms", query: "a synth" });
    expect(getSession(s.id)!.detail).toEqual({ blurb: "folds waveforms", query: "a synth" });
    deleteSession(s.id);
  });

  it("getSession refreshes lastUsed", () => {
    const s = newSession("Calculator");
    s.lastUsed = 0;
    expect(getSession(s.id)!.lastUsed).toBeGreaterThan(0);
    deleteSession(s.id);
  });

  it("sweepSessions evicts entries older than SESSION_TTL_MS and returns the count", () => {
    const stale = newSession("Old");
    const fresh = newSession("New");
    const now = Date.now();
    stale.lastUsed = now - SESSION_TTL_MS - 1;
    expect(sweepSessions(now)).toBe(1);
    expect(getSession(stale.id)).toBeUndefined();
    expect(getSession(fresh.id)).toBeDefined();
    deleteSession(fresh.id);
  });

  it("sweepSessions enforces SESSION_MAX, evicting least-recently-used first", () => {
    const base = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < SESSION_MAX + 3; i++) {
      const s = newSession(`App${i}`);
      s.lastUsed = base + i; // deterministic LRU order
      ids.push(s.id);
    }
    sweepSessions(base + SESSION_MAX + 3);
    expect(getSession(ids[0])).toBeUndefined();
    expect(getSession(ids[1])).toBeUndefined();
    expect(getSession(ids[2])).toBeUndefined();
    expect(getSession(ids[ids.length - 1])).toBeDefined();
    for (const id of ids) deleteSession(id);
  });

  it("newSession sweeps expired entries before inserting", () => {
    const stale = newSession("Old");
    stale.lastUsed = Date.now() - SESSION_TTL_MS - 1;
    const fresh = newSession("New");
    expect(getSession(stale.id)).toBeUndefined();
    expect(getSession(fresh.id)).toBeDefined();
    deleteSession(fresh.id);
  });
});
