import Anthropic from "@anthropic-ai/sdk";

// The ONLY module that constructs the SDK client. Engine + routes import these;
// tests mock this module so the real API is never called.
export const MODEL = "claude-haiku-4-5";
// 30s ceiling instead of the SDK's 10-minute default: a stalled call must not hold
// a window's busy overlay for minutes. Reads ANTHROPIC_API_KEY from env.
export const anthropic = new Anthropic({ timeout: 30_000, maxRetries: 3 });

/** Budget for a window's initial render. */
export const OPEN_MAX_TOKENS = 4096;
/** Second, much larger budget used once when the initial render truncates. */
export const OPEN_RETRY_MAX_TOKENS = 16000;
