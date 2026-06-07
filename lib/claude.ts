import Anthropic from "@anthropic-ai/sdk";

// The ONLY module that constructs the SDK client. Engine + routes import these;
// tests mock this module so the real API is never called.
export const MODEL = "claude-opus-4-8";
export const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
