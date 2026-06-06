import type Anthropic from "@anthropic-ai/sdk";

export const WINDOW_SYSTEM = (appName: string): string =>
`You are simulating the UI of a single desktop application as a live HTML fragment. App: "${appName}".
Rules:
1) Output ONLY an HTML fragment for the window body. No <html>, <head>, <script>, or <style> tags. Style with inline style="" attributes only.
2) EVERY interactive element MUST have a unique, stable id (e.g. id="r1", id="display"). Reuse the same id across turns — never renumber an existing element.
3) There is no code behind this UI. Maintain ALL app state yourself from the click history in this conversation; the rendered values are the source of truth.
4) On the initial turn, return the full HTML. On later turns, you will be told which element id was clicked and must return a minimal DOM patch via the apply_dom_patch tool.
5) Make it look like a real, modern version of the app.
If the message lists current field values, treat them as exactly what the user typed. For a web browser app, render a browser with an address bar; when the user navigates, render a plausible, fully hallucinated web page for the typed URL while keeping the browser chrome and address bar.`;

export const SEARCH_SYSTEM =
`You are the search backend of a whimsical operating system that can conjure any app on demand. Given the user's query, invent up to 6 plausible, fun applications that fit it.
Every app NAME must be ORIGINAL and made-up — a believable indie-app brand name. Do NOT use the name of any real, existing, or trademarked product, company, or service, and avoid plain dictionary words. Coin new names (you may blend or twist words). Each app also needs a single emoji icon and a one-line blurb. Always respond by calling the app_results tool.`;

export const APPLY_DOM_PATCH_TOOL: Anthropic.Tool = {
  name: "apply_dom_patch",
  strict: true,
  description:
    "Return the minimal set of DOM edits that result from the user's click. Target elements ONLY by their existing id. To add new elements use insertHTML and give every new element a unique id.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["ops"],
    properties: {
      ops: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["op", "id"],
          properties: {
            op: {
              type: "string",
              enum: ["setText", "setAttr", "removeAttr", "addClass", "removeClass", "replaceHTML", "insertHTML", "remove"],
            },
            id: { type: "string" },
            attr: { type: "string" },
            value: { type: "string" },
            position: { type: "string", enum: ["before", "after", "firstChild", "lastChild"] },
          },
        },
      },
    },
  } as Anthropic.Tool["input_schema"],
};

export const APP_CARDS_TOOL: Anthropic.Tool = {
  name: "app_results",
  strict: true,
  description: "Return the list of fabricated apps that match the user's search.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "icon", "blurb"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            icon: { type: "string" },
            blurb: { type: "string" },
          },
        },
      },
    },
  } as Anthropic.Tool["input_schema"],
};
