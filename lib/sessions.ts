import type { AppDetail, WindowSession } from "./types";

// Survive Next.js dev HMR by hanging the map off globalThis.
const g = globalThis as unknown as { __vibeSessions?: Map<string, WindowSession> };
const store: Map<string, WindowSession> = g.__vibeSessions ?? new Map();
g.__vibeSessions = store;

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_MAX = 200;

export function newSession(appName: string, detail?: AppDetail): WindowSession {
  sweepSessions(Date.now());
  const session: WindowSession = { id: crypto.randomUUID(), appName, detail, messages: [], lastUsed: Date.now() };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): WindowSession | undefined {
  const session = store.get(id);
  if (session) session.lastUsed = Date.now();
  return session;
}

export function deleteSession(id: string): void {
  store.delete(id);
}

/** Evict expired entries, then the least-recently-used until the store fits SESSION_MAX.
 *  `now` is a parameter so tests need no fake timers. Returns how many were evicted. */
export function sweepSessions(now: number): number {
  let evicted = 0;
  for (const [id, session] of store) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      store.delete(id);
      evicted += 1;
    }
  }
  if (store.size > SESSION_MAX) {
    const oldestFirst = [...store.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const session of oldestFirst.slice(0, store.size - SESSION_MAX)) {
      store.delete(session.id);
      evicted += 1;
    }
  }
  return evicted;
}
