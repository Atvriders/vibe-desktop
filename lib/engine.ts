import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL, OPEN_MAX_TOKENS, OPEN_RETRY_MAX_TOKENS } from "./claude";
import { frozenSystem, cacheLastTurn } from "./cache";
import { WINDOW_SYSTEM, SEARCH_SYSTEM, APPLY_DOM_PATCH_TOOL, APP_CARDS_TOOL } from "./tool-schema";
import { newSession, getSession, deleteSession } from "./sessions";
import { stripFences } from "./html";
import type { AppCard, AppDetail, CallUsage, RawOp, WindowSession } from "./types";
import { MAX_FIELDS_LEN, MAX_QUERY_LEN, MAX_SNAPSHOT_LEN, promptLine } from "./types";

export { MAX_QUERY_LEN, MAX_BLURB_LEN, MAX_SNAPSHOT_LEN, MAX_FIELDS_LEN } from "./types";

export class UnknownWindowError extends Error {}
export class TruncatedResponseError extends Error {}

const NO_THINK = { type: "disabled" } as const;

const INITIAL_USER = "Render the initial screen of the app.";

// The client-wide 30s ceiling is right for a normal turn but far too short for a
// 16k-token re-render, so the one retry gets its own per-request budget.
const RETRY_TIMEOUT_MS = 120_000;

type RawUsage =
  | { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null }
  | null
  | undefined;

function toUsage(usage: RawUsage, ms: number): CallUsage {
  return {
    ms,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

function sumUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    ms: a.ms + b.ms,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

async function renderScreen(
  session: WindowSession,
  system: Anthropic.TextBlockParam[],
  maxTokens: number,
  timeoutMs?: number,
): Promise<{ html: string; usage: CallUsage; truncated: boolean }> {
  const t0 = Date.now();
  const res = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: maxTokens,
      thinking: NO_THINK,
      system,
      messages: cacheLastTurn(session.messages),
    },
    timeoutMs ? { timeout: timeoutMs } : undefined,
  );
  const usage = toUsage(res.usage, Date.now() - t0);
  const html = stripFences(res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""));
  return { html, usage, truncated: res.stop_reason === "max_tokens" || html.length === 0 };
}

export async function searchApps(query: string): Promise<AppCard[]> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: NO_THINK,
    system: SEARCH_SYSTEM,
    tools: [APP_CARDS_TOOL],
    tool_choice: { type: "tool", name: "app_results" },
    messages: [{ role: "user", content: query }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  return ((block.input as { cards?: AppCard[] }).cards ?? []);
}

export async function openWindow(
  appName: string,
  detail?: AppDetail,
): Promise<{ windowId: string; html: string; usage: CallUsage }> {
  const session = newSession(appName, detail);
  try {
    session.messages.push({ role: "user", content: INITIAL_USER });
    const system = frozenSystem(WINDOW_SYSTEM(appName, detail));

    const first = await renderScreen(session, system, OPEN_MAX_TOKENS);
    if (!first.truncated) {
      // store the cleaned HTML (not the raw fenced text) so the model's own context stays clean
      session.messages.push({ role: "assistant", content: first.html });
      return { windowId: session.id, html: first.html, usage: first.usage };
    }

    // A half-written screen would be the model's only source of truth for this
    // window's whole life, so the truncated turn is never pushed — retry once.
    const retry = await renderScreen(session, system, OPEN_RETRY_MAX_TOKENS, RETRY_TIMEOUT_MS);
    const usage = sumUsage(first.usage, retry.usage);
    if (retry.truncated) throw new TruncatedResponseError(`initial render truncated for "${appName}"`);
    session.messages.push({ role: "assistant", content: retry.html });
    return { windowId: session.id, html: retry.html, usage };
  } catch (err) {
    // The caller never learns this windowId, so a surviving entry is unreachable
    // garbage that would hold a slot against SESSION_MAX for the whole TTL and
    // could push the LRU sweep into evicting genuinely open windows.
    deleteSession(session.id);
    throw err;
  }
}

export interface PatchInput {
  elementId?: string | null;
  x: number;
  y: number;
  action?: "click" | "contextmenu" | "submit";
  inputs?: Record<string, string>;
  domSnapshot?: string;
  instruction?: string;
}

/** Backslash-escape a field value so it cannot break out of its k="v" pair.
 *  Backslashes go first, or escaping the quote would be undone by the reader. */
function escapeQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function describeInput(input: PatchInput): string {
  const instruction = promptLine(input.instruction, MAX_QUERY_LEN);
  let content: string;
  if (instruction) {
    content = `The user typed an instruction into the app's command bar: ${instruction}`;
  } else if (input.action === "submit" && input.elementId) {
    content =
      `The user pressed Enter in the field with id "${input.elementId}". ` +
      `Using the HTML you generated, determine what that submits and return the DOM patch for the resulting screen.`;
  } else {
    const verb = input.action === "contextmenu" ? "right-clicked" : "clicked";
    const on = input.elementId ? `, on or near the element with id "${input.elementId}"` : "";
    const menu = input.action === "contextmenu" ? " If a context menu is appropriate, render it." : "";
    content =
      `The user ${verb} at x=${input.x}, y=${input.y} (percent of the window, top-left origin)${on}. ` +
      `Using the HTML you generated, determine what was clicked and return the DOM patch for the resulting screen.${menu}`;
  }
  if (input.inputs && Object.keys(input.inputs).length > 0) {
    // Ids are collapsed (a key holding a newline could fake prompt structure) but the
    // values are the user's own typed text — a textarea keeps its line breaks. Quotes
    // in a value are escaped so a typed " cannot close the k="v" pair and make one
    // field read as several. The whole clause has its own small budget: this rides on
    // EVERY click, so the snapshot-sized cap it used to borrow was orders of magnitude
    // too generous.
    const fields = Object.entries(input.inputs)
      .map(([k, v]) => promptLine(k, MAX_FIELDS_LEN) + "=\"" + escapeQuotes(v) + "\"")
      .join(", ")
      .slice(0, MAX_FIELDS_LEN);
    content += " Current field values: " + fields + ".";
  }
  return content;
}

export async function patchWindow(
  windowId: string,
  input: PatchInput,
): Promise<{ ops: RawOp[]; usage: CallUsage; stopReason: string | null }> {
  const session = getSession(windowId);
  if (!session) throw new UnknownWindowError(`unknown window: ${windowId}`);

  const userContent = describeInput(input);
  // An unanswered user turn would be merged with the next one by the API, so the model
  // would see — and could legitimately act on — a click that was never applied. The
  // reseed path needs no rollback: the next snapshot replaces the whole array anyway.
  // That holds ONLY because the client queues a resync after every failed patch — an
  // invariant spanning two files, pinned by "queues a resync after EVERY kind of patch
  // failure" in components/WindowFrame.test.tsx. Do not weaken one without the other.
  const appended = !input.domSnapshot;
  if (input.domSnapshot) {
    // A snapshot IS the complete current state, so reseed rather than append: this
    // bounds the transcript and drops superseded replaceHTML payloads. The leading
    // user turn is required — the API rejects a transcript that starts with assistant.
    session.messages = [
      { role: "user", content: INITIAL_USER },
      { role: "assistant", content: input.domSnapshot.slice(0, MAX_SNAPSHOT_LEN) },
      { role: "user", content: userContent },
    ];
  } else {
    session.messages.push({ role: "user", content: userContent });
  }

  const t0 = Date.now();
  const res = await anthropic.messages
    .create({
      model: MODEL,
      max_tokens: 4096, // room for full-screen replaceHTML navigation patches (1024 truncated them)
      thinking: NO_THINK,
      system: frozenSystem(WINDOW_SYSTEM(session.appName, session.detail)),
      tools: [APPLY_DOM_PATCH_TOOL],
      tool_choice: { type: "tool", name: "apply_dom_patch" },
      messages: cacheLastTurn(session.messages),
    })
    .catch((err: unknown) => {
      if (appended) session.messages.pop();
      throw err;
    });
  const usage = toUsage(res.usage, Date.now() - t0);
  const stopReason = res.stop_reason ?? null;

  if (stopReason === "max_tokens" || res.content.length === 0) {
    // A committed tool_result for ops that were never applied poisons the transcript, so
    // neither the assistant turn nor the result is pushed — and an empty assistant turn
    // is rejected outright by the API, which would 400 every later patch on this window.
    if (appended) session.messages.pop();
    throw new TruncatedResponseError(`patch truncated for "${session.appName}"`);
  }

  const block = res.content.find((b) => b.type === "tool_use");
  const ops = (block && block.type === "tool_use" ? (block.input as { ops?: RawOp[] }).ops ?? [] : []);
  console.log(`[patch ${session.appName}] ops=${ops.length} stop=${stopReason} cacheRead=${usage.cacheReadTokens} ms=${usage.ms}`);
  session.messages.push({ role: "assistant", content: res.content });
  if (block && block.type === "tool_use") {
    session.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content: "applied" }] });
  }
  return { ops, usage, stopReason };
}
