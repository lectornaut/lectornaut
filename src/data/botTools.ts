/**
 * Client-side catalog of bot tools — used to render the slash menu in
 * `AiChatComposer.vue`. Each entry mirrors a tool defined server-side in
 * `functions/src/bot.ts` (one of `getWeather`, `rollDice`, `askQuestion`).
 *
 * Using `keyof IBotAgentToolToggles` for `name` ties this list to the
 * server's tool-toggle keyset: if a new tool is registered server-side,
 * the toggle schema gains a new key and TypeScript will flag a missing
 * entry here at compile time.
 *
 * The `example` is what the slash menu inserts into the textarea on
 * pick — a natural-language prompt that nudges the model to invoke the
 * tool. We deliberately don't insert `/toolName` (Discord-style) because
 * Genkit's tool-call decision is driven by the prompt, not by syntax.
 */

import { IconCloudRain, IconDices, IconHelpCircle } from "@/data/icons"
import type { IBotAgentToolToggles } from "@/types/domain"
import type { Component } from "vue"

export type BotToolName = keyof IBotAgentToolToggles

export interface BotToolDescriptor {
  name: BotToolName
  label: string
  description: string
  icon: Component
  /** Prompt text inserted when the user picks this tool from the menu. */
  example: string
}

export const BOT_TOOL_CATALOG: readonly BotToolDescriptor[] = [
  {
    name: "getWeather",
    label: "Weather",
    description: "Look up the current weather for a location.",
    icon: IconCloudRain,
    example: "What's the weather in ",
  },
  {
    name: "rollDice",
    label: "Roll dice",
    description: "Roll a six-sided die.",
    icon: IconDices,
    example: "Roll a die for me.",
  },
  {
    name: "askQuestion",
    label: "Ask a clarifying question",
    description: "Pause and ask me a question with choices to pick from.",
    icon: IconHelpCircle,
    example: "Ask me a clarifying question about ",
  },
] as const
