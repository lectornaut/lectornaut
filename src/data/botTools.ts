/**
 * Client-side catalog of bot tools — used to render the slash menu in
 * `AiChatComposer.vue`. Each entry mirrors a model-callable tool
 * defined server-side in `functions/src/botBuiltinTools.ts` (the demo
 * + interrupt tools), `functions/src/botRag.ts` (semantic search),
 * and `functions/src/botSummarize.ts` (structured summarization).
 *
 * `BotToolName` excludes `customAgents`, `customWorkflows`, `customTools`,
 * `summarizeNodeInspector`, `manageContent`, AND `readContent`
 * deliberately — those keys on `IBotAgentToolToggles` are *feature gates*
 * (whole custom-agents UI; whole custom-workflows UI; whole custom-tools UI;
 * the node inspector's Generate-summary button; the node-WRITE tool block;
 * the node-READ tool block) rather than single model-callable tools. Including any in this
 * catalog would surface a meaningless entry in the composer's slash menu.
 * (`manageContent` / `readContent` still get per-agent toggles, but the
 * agent editor appends those rows explicitly — see
 * `SettingsCustomAgents.vue` — precisely because they're not catalog
 * tools.)
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
  IconArchive,
  IconArrowRight,
  IconColumns,
  IconDices,
  IconFilePlus,
  IconFileText,
  IconGlobe,
  IconHelpCircle,
  IconLink,
  IconList,
  IconPencil,
  IconRotateCcw,
  IconSearch,
  IconSquarePen,
} from "@/data/icons"
import type { IBotAgentToolToggles } from "@/types/domain"
import type { Component } from "vue"

export type BotToolName = Exclude<
  keyof IBotAgentToolToggles,
  | "customAgents"
  | "customWorkflows"
  | "customTools"
  | "summarizeNodeInspector"
  | "manageContent"
  | "readContent"
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
  rollDice: {
    name: "rollDice",
    label: "Roll dice",
    description: "Roll a six-sided die.",
    icon: IconDices,
    example: "Roll a die for me.",
  },
  browseInternet: {
    name: "browseInternet",
    label: "Browse the internet",
    description: "Search the live web for current or external facts.",
    icon: IconGlobe,
    // Sentence prefix the user completes with what to look up — nudges
    // the model to call the tool without Discord-style `/` syntax.
    example: "Search the web for ",
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
  listWorkspaceNodes: {
    name: "listWorkspaceNodes",
    label: "List workspace",
    description:
      "Enumerate files and folders by name — a directory listing, not a search.",
    icon: IconList,
    // Sentence prefix the user completes — nudges the model to enumerate
    // rather than reach for semantic search.
    example: "List the workspace files in ",
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
  compareNodes: {
    name: "compareNodes",
    label: "Compare nodes",
    description:
      "Contrast 2–5 workspace nodes — overlaps, contradictions, and what each contributes.",
    icon: IconColumns,
    // Open prompt the user completes with the docs to compare. When
    // the user has multiple nodes attached, the model picks the refs
    // from the attached-context block; when not, it chains via
    // `searchWorkspaceNodes` first to locate them.
    example: "Compare the workspace documents about ",
  },
  findRelatedNodes: {
    name: "findRelatedNodes",
    label: "Find related nodes",
    description:
      "Surface other workspace nodes similar to a given one — via stored embeddings.",
    icon: IconLink,
    // Sentence prefix — the user names a document and the model
    // resolves the ref (from attached context or a search). The
    // server tool reuses the stored embedding so this is cheap.
    example: "Find workspace docs related to ",
  },
}

export const BOT_TOOL_CATALOG: readonly BotToolDescriptor[] =
  Object.values(CATALOG_BY_NAME)

/**
 * Catalog for the agent node-CRUD tools (`functions/src/botNodeTools.ts`).
 *
 * Kept OUTSIDE `CATALOG_BY_NAME` / `IBotAgentToolToggles` because these aren't
 * single-tool per-agent toggles — the server registers them as two blocks
 * gated by a membership intersection plus the `manageContent` / `readContent`
 * feature toggles (see `bot.ts`'s `nodeWriteEnabled` / `nodeReadEnabled`). The
 * composer's slash menu mirrors that gating in its own group so users see —
 * and can prompt for — the actions the active agent can actually perform.
 *
 * The `kind` discriminator lets the composer split READ from WRITE: a member
 * with read-only rights sees `readNode` but none of the mutators. Each entry
 * also carries the friendly label + icon used by `BotChatToolCall.vue`'s
 * tool-call cards via `botToolLabel` / `botToolIcon` — same source of truth,
 * so a label change here ripples to the inline card automatically. Keep the
 * keys in sync with the tool `name`s in `botNodeTools.ts`.
 */
export interface BotNodeToolDescriptor {
  name: string
  kind: "read" | "write"
  label: string
  description: string
  icon: Component
  /** Prompt text inserted when the user picks this tool from the menu. */
  example: string
}

const NODE_TOOL_DISPLAY: Readonly<Record<string, BotNodeToolDescriptor>> = {
  readNode: {
    name: "readNode",
    kind: "read",
    label: "Read node",
    description: "Open a workspace file or folder and pull in its content.",
    icon: IconFileText,
    example: "Read the workspace file ",
  },
  createNode: {
    name: "createNode",
    kind: "write",
    label: "Create node",
    description: "Add a new file or folder to the workspace.",
    icon: IconFilePlus,
    example: "Create a new workspace file called ",
  },
  updateNodeContent: {
    name: "updateNodeContent",
    kind: "write",
    label: "Edit content",
    description: "Rewrite the contents of a workspace file.",
    icon: IconSquarePen,
    example: "Edit the workspace file ",
  },
  renameNode: {
    name: "renameNode",
    kind: "write",
    label: "Rename node",
    description: "Change the display name of a workspace file or folder.",
    icon: IconPencil,
    example: "Rename the workspace node ",
  },
  moveNode: {
    name: "moveNode",
    kind: "write",
    label: "Move node",
    description: "Move a workspace file or folder into another folder.",
    icon: IconArrowRight,
    example: "Move the workspace node ",
  },
  archiveNode: {
    name: "archiveNode",
    kind: "write",
    label: "Archive node",
    description: "Soft-delete a workspace file or folder (recoverable).",
    icon: IconArchive,
    example: "Archive the workspace node ",
  },
  unarchiveNode: {
    name: "unarchiveNode",
    kind: "write",
    label: "Restore node",
    description: "Restore a previously archived workspace file or folder.",
    icon: IconRotateCcw,
    example: "Restore the archived workspace node ",
  },
}

/**
 * Catalog source-of-truth as an iterable array — drives the slash menu's
 * "Content" group in `AiChatComposer.vue`. Display order in the picker
 * follows declaration order in `NODE_TOOL_DISPLAY` (insertion order on
 * a plain object literal is stable). The READ tool is first so a
 * read-only agent's single visible entry sits at the top of the group.
 */
export const BOT_NODE_TOOL_CATALOG: readonly BotNodeToolDescriptor[] =
  Object.values(NODE_TOOL_DISPLAY)

/**
 * Resolve a built-in tool's wire name to its human-friendly label
 * (e.g. `"rollDice"` → `"Roll dice"`) — the same string the slash menu
 * shows. Returns `undefined` for names not in the catalog so callers can
 * fall back to a custom tool's `displayName` or the raw wire name.
 *
 * Typed to accept any `string` (not just `BotToolName`) because callers
 * resolve names coming off the chat stream, which include custom-tool
 * names and tools deliberately omitted from this catalog (e.g.
 * `transferToAgent`).
 */
export const botToolLabel = (name: string): string | undefined =>
  CATALOG_BY_NAME[name as BotToolName]?.label ?? NODE_TOOL_DISPLAY[name]?.label

/**
 * Resolve a built-in tool's wire name to its catalog icon component
 * (e.g. `"rollDice"` → `IconDices`). Returns `undefined` for names
 * not in the catalog — callers fall back to a custom tool's avatar or a
 * generic glyph. Same lenient `string` signature as `botToolLabel`.
 */
export const botToolIcon = (name: string): Component | undefined =>
  CATALOG_BY_NAME[name as BotToolName]?.icon ?? NODE_TOOL_DISPLAY[name]?.icon
