import type Anthropic from "@anthropic-ai/sdk";

/** System prompt as a cached (frozen) prefix block. */
export function frozenSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** Return a copy of `messages` with a cache breakpoint on the last content
 *  block of the last message (the rolling multi-turn pattern). The growing
 *  prefix before it is matched as a cheap cache read on the next request. */
export function cacheLastTurn(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const copy = messages.map((m) => ({ ...m }));
  const last = copy[copy.length - 1];
  const content =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content } as Anthropic.TextBlockParam]
      : last.content.map((b) => ({ ...b }));
  const tail = content[content.length - 1] as { cache_control?: unknown };
  tail.cache_control = { type: "ephemeral" };
  last.content = content as Anthropic.MessageParam["content"];
  return copy;
}
