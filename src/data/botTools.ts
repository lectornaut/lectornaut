/**
 * Client-side catalog of bot tools — used to render the slash menu in
 * `AiChatComposer.vue`. Each entry mirrors a model-callable tool
 * defined server-side in `functions/src/botBuiltinTools.ts` (the demo
 * + interrupt tools), `functions/src/botRag.ts` (semantic search),
 * and `functions/src/botSummarize.ts` (structured summarization).
 *
 * `BotToolName` excludes `customAgents` AND `customTools` deliberately
 * — those keys on `IBotAgentToolToggles` are *feature gates* (whole
 * custom-agents UI; whole custom-tools UI) rather than model-callable
 * tools. Including either in this catalog would surface a meaningless
 * entry in the composer's slash menu and in per-agent tool subset UIs.
 *
 * Type-level exhaustiveness: `CATALOG_BY_NAME` is typed as
 * `Record<BotToolName, BotToolDescriptor>`, so adding a new tool to
 * `IBotAgentToolToggles` (and therefore to `BotToolName`) is an
 * immediate compile error here — "Property 'X' is missing in type
 * { ... }". This replaces a prior `readonly BotToolDescriptor[]`
 * shape that *claimed* in a comment to enforce coverage but
 * didn't — arrays accept any subset of a union, including empty.
 * The bug shape this enforcement prevents: `searchWorkspaceNodes`
 * and `summarizeNode` were added server-side but silently absent
 * from this catalog for a release, invisible in the slash menu.
 *
 * The `example` is what the slash menu inserts into the textarea on
 * pick — a natural-language prompt that nudges the model to invoke the
 * tool. We deliberately don't insert `/toolName` (Discord-style) because
 * Genkit's tool-call decision is driven by the prompt, not by syntax.
 * For tools that need a concrete target (e.g. `summarizeNode` needs a
 * node), the example is a sentence prefix the user fills in with a
 * name or topic; the model handles discovery via `searchWorkspaceNodes`
 * if it doesn't have the IDs already.
 */

import {
  IconCloudRain,
  IconDices,
  IconFileText,
  IconHelpCircle,
  IconSearch,
} from "@/data/icons"
import type { IBotAgentToolToggles } from "@/types/domain"
import type { Component } from "vue"

export type BotToolName = Exclude<
  keyof IBotAgentToolToggles,
  "customAgents" | "customTools"
>

export interface BotToolDescriptor {
  name: BotToolName
  label: string
  description: string
  icon: Component
  /** Prompt text inserted when the user picks this tool from the menu. */
  example: string
}

/**
 * Catalog source-of-truth, keyed by tool name. The `Record` type
 * forces an entry for every `BotToolName` — adding a tool to the
 * schema without adding a descriptor here is a compile error, not a
 * silent picker omission.
 *
 * Display order in the slash menu follows declaration order here
 * because `Object.values()` preserves insertion order on plain
 * object literals. Reorder these keys to reorder the picker.
 */
const CATALOG_BY_NAME: Record<BotToolName, BotToolDescriptor> = {
  getWeather: {
    name: "getWeather",
    label: "Weather",
    description: "Look up the current weather for a location.",
    icon: IconCloudRain,
    example: "What's the weather in ",
  },
  rollDice: {
    name: "rollDice",
    label: "Roll dice",
    description: "Roll a six-sided die.",
    icon: IconDices,
    example: "Roll a die for me.",
  },
  askQuestion: {
    name: "askQuestion",
    label: "Ask a clarifying question",
    description: "Pause and ask me a question with choices to pick from.",
    icon: IconHelpCircle,
    example: "Ask me a clarifying question about ",
  },
  searchWorkspaceNodes: {
    name: "searchWorkspaceNodes",
    label: "Search workspace",
    description: "Find files or folders by what they contain.",
    icon: IconSearch,
    example: "Find the workspace notes about ",
  },
  summarizeNode: {
    name: "summarizeNode",
    label: "Summarize node",
    description: "Generate a structured summary with key points and tags.",
    icon: IconFileText,
    // Sentence prefix the user fills in with a node name or topic.
    // When the user hasn't attached anything, the model handles
    // discovery by chaining `searchWorkspaceNodes` → `summarizeNode`
    // (see the tool's server-side description for the exact
    // chain-or-attach logic). Works equally well whether or not the
    // user has pre-attached a node via the composer's + button.
    example: "Summarize the workspace document about ",
  },
}

export const BOT_TOOL_CATALOG: readonly BotToolDescriptor[] =
  Object.values(CATALOG_BY_NAME)
