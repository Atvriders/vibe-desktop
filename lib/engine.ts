import { anthropic, MODEL } from "./claude";
import { frozenSystem, cacheLastTurn } from "./cache";
import { WINDOW_SYSTEM, SEARCH_SYSTEM, APPLY_DOM_PATCH_TOOL, APP_CARDS_TOOL } from "./tool-schema";
import { newSession, getSession } from "./sessions";
import type { AppCard, RawOp } from "./types";

export class UnknownWindowError extends Error {}

const NO_THINK = { type: "disabled" } as const;

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

export async function openWindow(appName: string): Promise<{ windowId: string; html: string }> {
  const session = newSession(appName);
  session.messages.push({ role: "user", content: "Render the initial screen of the app." });
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: NO_THINK,
    system: frozenSystem(WINDOW_SYSTEM(appName)),
    messages: cacheLastTurn(session.messages),
  });
  const html = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  session.messages.push({ role: "assistant", content: res.content });
  return { windowId: session.id, html };
}

export interface PatchInput {
  elementId?: string | null;
  x: number;
  y: number;
  action?: "click" | "contextmenu";
  inputs?: Record<string, string>;
  domSnapshot?: string;
}

export async function patchWindow(
  windowId: string,
  input: PatchInput,
): Promise<{ ops: RawOp[]; cacheReadTokens: number }> {
  const session = getSession(windowId);
  if (!session) throw new UnknownWindowError(`unknown window: ${windowId}`);

  if (input.domSnapshot) {
    session.messages.push({
      role: "user",
      content: `The current DOM is:\n${input.domSnapshot}\nContinue from this exact state.`,
    });
  }
  const verb = input.action === "contextmenu" ? "right-clicked" : "clicked";
  const on = input.elementId ? `, on or near the element with id "${input.elementId}"` : "";
  const menu = input.action === "contextmenu" ? " If a context menu is appropriate, render it." : "";
  let userContent =
    `The user ${verb} at x=${input.x}, y=${input.y} (percent of the window, top-left origin)${on}. ` +
    `Using the HTML you generated, determine what was clicked and return the DOM patch for the resulting screen.${menu}`;
  if (input.inputs && Object.keys(input.inputs).length > 0) {
    userContent += " Current field values: " + Object.entries(input.inputs).map(([k, v]) => k + "=\"" + v + "\"").join(", ") + ".";
  }
  session.messages.push({
    role: "user",
    content: userContent,
  });

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: NO_THINK,
    system: frozenSystem(WINDOW_SYSTEM(session.appName)),
    tools: [APPLY_DOM_PATCH_TOOL],
    tool_choice: { type: "tool", name: "apply_dom_patch" },
    messages: cacheLastTurn(session.messages),
  });

  const block = res.content.find((b) => b.type === "tool_use");
  const ops = (block && block.type === "tool_use" ? (block.input as { ops?: RawOp[] }).ops ?? [] : []);
  session.messages.push({ role: "assistant", content: res.content });
  if (block && block.type === "tool_use") {
    session.messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content: "applied" }] });
  }
  return { ops, cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0 };
}
