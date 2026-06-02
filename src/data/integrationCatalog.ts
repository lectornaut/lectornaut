/**
 * Client integration catalog — the marketplace SEAM (mirror of
 * `functions/src/integrationCatalog.ts`). It adapts the three building blocks'
 * shipped catalogs — built-in agents (`builtInAgents.ts`), built-in tools
 * (`botTools.ts`), and workflow presets (`workflowPresets.ts`) — into ONE
 * `(type, key)`-addressable list.
 *
 * This is the taxonomy half of the unification: all three building blocks are
 * browsable behind one shape here, and the behavior half lives in
 * `useIntegrationsRegistry`. Crucially, NEITHER requires the docs to share a
 * collection — install/enable STATE still lives per-nature (agents + tools in
 * the `integrations` store, workflows in `teamWorkflowsStore`). A future
 * "published" marketplace source plugs in by emitting the same `CatalogEntry`.
 */

import { BOT_TOOL_CATALOG } from "@/data/botTools"
import { BUILT_IN_AGENTS } from "@/data/builtInAgents"
import { WORKFLOW_PRESETS } from "@/data/workflowPresets"

/** The conceptual taxonomy spans all three building blocks. */
export type CatalogEntryType = "agent" | "tool" | "workflow"

/**
 * One installable catalog entry. Only the display-and-address fields are common
 * across types; type-specific payload (a persona, a tool handler, a workflow's
 * trigger/instructions) is resolved downstream by `(type, key)`, never carried
 * here — this stays the static, shippable "what can be installed" list.
 */
export interface CatalogEntry {
  type: CatalogEntryType
  /** Stable catalog key (== the built-in agent/tool sourceKey or preset key). */
  key: string
  name: string
  description: string
  avatarSeed: string
}

const AGENT_ENTRIES: CatalogEntry[] = BUILT_IN_AGENTS.map((a) => ({
  type: "agent",
  key: a.id,
  name: a.name,
  description: a.description,
  avatarSeed: a.avatarSeed,
}))

const TOOL_ENTRIES: CatalogEntry[] = BOT_TOOL_CATALOG.map((tool) => ({
  type: "tool",
  key: tool.name,
  name: tool.label,
  description: tool.description,
  // Built-in tools have no avatar field — seed from the (stable) wire-name,
  // matching `integrationsStore`'s built-in tool overlay.
  avatarSeed: tool.name,
}))

const WORKFLOW_ENTRIES: CatalogEntry[] = WORKFLOW_PRESETS.map((preset) => ({
  type: "workflow",
  key: preset.key,
  name: preset.name,
  description: preset.description,
  avatarSeed: preset.avatarSeed,
}))

/** The full installable catalog across all three building blocks. */
export const INTEGRATION_CATALOG: readonly CatalogEntry[] = [
  ...AGENT_ENTRIES,
  ...TOOL_ENTRIES,
  ...WORKFLOW_ENTRIES,
]

/** Catalog entries of one type (narrowed view onto the unified list). */
export function listCatalog(type: CatalogEntryType): CatalogEntry[] {
  return INTEGRATION_CATALOG.filter((entry) => entry.type === type)
}
