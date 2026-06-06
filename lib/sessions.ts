import type { WindowSession } from "./types";

// Survive Next.js dev HMR by hanging the map off globalThis.
const g = globalThis as unknown as { __vibeSessions?: Map<string, WindowSession> };
const store: Map<string, WindowSession> = g.__vibeSessions ?? new Map();
g.__vibeSessions = store;

export function newSession(appName: string): WindowSession {
  const session: WindowSession = { id: crypto.randomUUID(), appName, messages: [], clickCount: 0 };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): WindowSession | undefined {
  return store.get(id);
}

export function deleteSession(id: string): void {
  store.delete(id);
}
