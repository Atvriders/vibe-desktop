import { describe, it, expect } from "vitest";
import { newSession, getSession, deleteSession } from "./sessions";

describe("session store", () => {
  it("creates, retrieves, and deletes a session", () => {
    const s = newSession("Calculator");
    expect(s.id).toBeTruthy();
    expect(s.appName).toBe("Calculator");
    expect(s.messages).toEqual([]);
    expect(getSession(s.id)).toBe(s);
    deleteSession(s.id);
    expect(getSession(s.id)).toBeUndefined();
  });
});
