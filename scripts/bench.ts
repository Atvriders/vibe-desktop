/**
 * Model benchmark for VibeDesktop's actual workload.
 *
 * This is NOT a generic LLM benchmark. It replays the exact two calls this app
 * makes — one window open, then a run of clicks — using the same system prompt,
 * the same forced `apply_dom_patch` tool, and the same cache breakpoints as
 * `lib/engine.ts`, so the numbers describe this app rather than a synthetic task.
 *
 *   npm run bench                    # default: 3 reps of every config
 *   BENCH_REPS=1 npm run bench       # cheaper smoke run
 *   BENCH_CONFIGS=haiku,opus-adaptive npm run bench
 *
 * Costs real money. Reads ANTHROPIC_API_KEY from .env.local (git-ignored).
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { WINDOW_SYSTEM, APPLY_DOM_PATCH_TOOL } from "../lib/tool-schema";
import { frozenSystem, cacheLastTurn } from "../lib/cache";
import { stripFences } from "../lib/html";
import type { RawOp } from "../lib/types";

// ── env ─────────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes("REPLACE")) {
  console.error("No real ANTHROPIC_API_KEY in .env.local — see .env.example.");
  process.exit(1);
}

// ── what we measure ─────────────────────────────────────────────────────────
const APP = "Calculator";
const INITIAL_USER = "Render the initial screen of the app."; // mirrors lib/engine.ts
const CLICKS = 5;
const REPS = Number(process.env.BENCH_REPS ?? 3);

/** Published list prices, USD per million tokens. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-5": { in: 5, out: 25 },
};

type Thinking =
  | { type: "disabled" }
  | { type: "adaptive" };

interface Config {
  key: string;
  model: string;
  thinking: Thinking;
  /** `effort` is REJECTED on Haiku 4.5, so it cannot be set uniformly. */
  effort?: "low" | "medium" | "high";
  note: string;
}

const CONFIGS: Config[] = [
  { key: "haiku", model: "claude-haiku-4-5", thinking: { type: "disabled" }, note: "app default" },
  { key: "sonnet", model: "claude-sonnet-5", thinking: { type: "disabled" }, note: "drop-in swap" },
  { key: "opus-disabled", model: "claude-opus-5", thinking: { type: "disabled" }, note: "naive swap — hazard config" },
  { key: "opus-adaptive", model: "claude-opus-5", thinking: { type: "adaptive" }, effort: "low", note: "recommended for Opus 5" },
];

interface CallStat {
  kind: "open" | "patch";
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stopReason: string | null;
  /** THE hazard check: did the forced tool call actually come back as a tool_use block? */
  toolUseBlock: boolean;
  ops: number;
  /** Visible text on a patch turn — should be empty; non-empty means leakage. */
  strayText: string;
  error?: string;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });

function usageOf(u: Anthropic.Usage | undefined, ms: number) {
  return {
    ms,
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

/** Thinking/effort params, shaped per model's accepted surface. */
function tuning(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = { thinking: cfg.thinking };
  if (cfg.effort) out.output_config = { effort: cfg.effort };
  return out;
}

async function runScenario(cfg: Config): Promise<CallStat[]> {
  const stats: CallStat[] = [];
  const system = frozenSystem(WINDOW_SYSTEM(APP));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: INITIAL_USER }];

  // ── 1. open ───────────────────────────────────────────────────────────────
  let html = "";
  {
    const t0 = Date.now();
    try {
      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: 4096,
        system,
        messages: cacheLastTurn(messages),
        ...tuning(cfg),
      } as Anthropic.MessageCreateParamsNonStreaming);
      html = stripFences(
        res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""),
      );
      messages.push({ role: "assistant", content: html });
      stats.push({
        kind: "open",
        ...usageOf(res.usage, Date.now() - t0),
        stopReason: res.stop_reason ?? null,
        toolUseBlock: false,
        ops: 0,
        strayText: "",
      });
    } catch (e) {
      stats.push({
        kind: "open", ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheWriteTokens: 0, stopReason: null, toolUseBlock: false, ops: 0, strayText: "",
        error: String((e as Error).message ?? e).slice(0, 200),
      });
      return stats;
    }
  }

  // Click real ids out of the model's own HTML, the way the host does.
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== "app-root");
  if (ids.length === 0) return stats;

  // ── 2. clicks ─────────────────────────────────────────────────────────────
  for (let i = 0; i < CLICKS; i++) {
    const elementId = ids[Math.floor((i * ids.length) / CLICKS) % ids.length];
    messages.push({
      role: "user",
      content:
        `The user clicked at x=${40 + i * 5}, y=${60 + i * 3} (percent of the window, top-left origin), ` +
        `on or near the element with id "${elementId}". ` +
        `Using the HTML you generated, determine what was clicked and return the DOM patch for the resulting screen.`,
    });

    const t0 = Date.now();
    try {
      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: 4096,
        system,
        tools: [APPLY_DOM_PATCH_TOOL],
        tool_choice: { type: "tool", name: "apply_dom_patch" },
        messages: cacheLastTurn(messages),
        ...tuning(cfg),
      } as Anthropic.MessageCreateParamsNonStreaming);

      const block = res.content.find((b) => b.type === "tool_use");
      const ops = block && block.type === "tool_use" ? ((block.input as { ops?: RawOp[] }).ops ?? []) : [];
      const strayText = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim();

      stats.push({
        kind: "patch",
        ...usageOf(res.usage, Date.now() - t0),
        stopReason: res.stop_reason ?? null,
        toolUseBlock: Boolean(block),
        ops: ops.length,
        strayText: strayText.slice(0, 300),
      });

      messages.push({ role: "assistant", content: res.content });
      if (block && block.type === "tool_use") {
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: block.id, content: "applied" }],
        });
      } else {
        // No tool_use block: engine.ts would return ops=[] here and the click would
        // silently do nothing. Drop the unanswered user turn so the run can continue.
        messages.pop();
      }
    } catch (e) {
      stats.push({
        kind: "patch", ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheWriteTokens: 0, stopReason: null, toolUseBlock: false, ops: 0, strayText: "",
        error: String((e as Error).message ?? e).slice(0, 200),
      });
      messages.pop();
    }
  }
  return stats;
}

// ── aggregate ───────────────────────────────────────────────────────────────
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function costOf(model: string, s: CallStat): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (s.inputTokens * p.in +
      s.cacheReadTokens * p.in * 0.1 +
      s.cacheWriteTokens * p.in * 2 +
      s.outputTokens * p.out) /
    1e6
  );
}

async function main() {
  const only = process.env.BENCH_CONFIGS?.split(",").map((s) => s.trim());
  const configs = only ? CONFIGS.filter((c) => only.includes(c.key)) : CONFIGS;
  const all: Record<string, CallStat[]> = {};

  for (const cfg of configs) {
    const stats: CallStat[] = [];
    for (let r = 0; r < REPS; r++) {
      process.stderr.write(`  ${cfg.key} rep ${r + 1}/${REPS}…\n`);
      stats.push(...(await runScenario(cfg)));
    }
    all[cfg.key] = stats;
  }

  const rows = configs.map((cfg) => {
    const s = all[cfg.key];
    const opens = s.filter((x) => x.kind === "open" && !x.error);
    const patches = s.filter((x) => x.kind === "patch" && !x.error);
    const errors = s.filter((x) => x.error);
    const noTool = patches.filter((x) => !x.toolUseBlock);
    const stray = patches.filter((x) => x.strayText.length > 0);
    const emptyOps = patches.filter((x) => x.toolUseBlock && x.ops === 0);
    const perClick = patches.length ? patches.reduce((a, x) => a + costOf(cfg.model, x), 0) / patches.length : 0;
    return {
      ...cfg,
      openMs: median(opens.map((x) => x.ms)),
      clickMs: median(patches.map((x) => x.ms)),
      cacheRead: median(patches.map((x) => x.cacheReadTokens)),
      outTok: median(patches.map((x) => x.outputTokens)),
      ops: median(patches.map((x) => x.ops)),
      perClick,
      patches: patches.length,
      noTool: noTool.length,
      stray: stray.length,
      emptyOps: emptyOps.length,
      errors: errors.length,
    };
  });

  const money = (n: number) => (n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`);
  const lines = [
    `Reps: ${REPS} × (1 open + ${CLICKS} clicks) per config. App: "${APP}". Medians.`,
    "",
    "| Config | Model | Open | Per click | Out tok/click | Cached tok/click | Ops/click | Cost/click | tool_use missing | stray text | errors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.key} (${r.note}) | \`${r.model}\` | ${(r.openMs / 1000).toFixed(1)}s | ${(r.clickMs / 1000).toFixed(1)}s | ${r.outTok} | ${r.cacheRead} | ${r.ops} | ${money(r.perClick)} | ${r.noTool}/${r.patches} | ${r.stray}/${r.patches} | ${r.errors} |`,
    ),
  ];

  const out = lines.join("\n");
  console.log("\n" + out + "\n");
  writeFileSync(new URL("../bench-results.json", import.meta.url), JSON.stringify({ reps: REPS, clicks: CLICKS, app: APP, rows, raw: all }, null, 2));
  console.error("Raw per-call data written to bench-results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
