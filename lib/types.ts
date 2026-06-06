import type Anthropic from "@anthropic-ai/sdk";

/** A DOM edit as emitted by the model (validated/applied host-side). */
export interface RawOp {
  op: "setText" | "setAttr" | "removeAttr" | "addClass" | "removeClass" | "replaceHTML" | "insertHTML" | "remove";
  id: string;
  attr?: string;
  value?: string;
  position?: "before" | "after" | "firstChild" | "lastChild";
}

/** One fabricated app result from the search backend. */
export interface AppCard {
  id: string;
  name: string;
  icon: string;
  blurb: string;
}

/** One window's entire state = its Claude conversation. */
export interface WindowSession {
  id: string;
  appName: string;
  messages: Anthropic.MessageParam[];
  clickCount: number;
}
