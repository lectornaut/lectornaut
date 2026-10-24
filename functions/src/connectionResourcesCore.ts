import {
  isConnectionOwned,
  type ConnectionResources,
} from "@lectornaut/shared/connectionResources"
import type { ConnectionProvider } from "@lectornaut/shared/domain"

export function connectionIntegrationDefinitions(
  resources: ConnectionResources
) {
  return [
    ...resources.tools.map((r) => ({
      ...r,
      type: "tool" as const,
      spec: null,
    })),
    ...resources.agents.map((r) => ({ ...r, type: "agent" as const })),
  ]
}

export function connectionResourcePatch(
  provider: ConnectionProvider,
  definition: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (existing && !isConnectionOwned(existing, provider)) {
    throw new Error(
      `Connection resource collision: ${String(definition.sourceKey ?? definition.presetKey)}`
    )
  }
  return {
    ...definition,
    source: "published",
    connectionProvider: provider,
    ...(definition.type === "agent" ? { isPublic: false } : {}),
    archivedAt: null,
    // Refreshing configuration must not undo a team's per-resource opt-out.
    enabled: existing?.enabled ?? true,
  }
}
