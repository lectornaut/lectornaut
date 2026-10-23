import type { BotToolPermissionMode } from "./domain.js"

export interface ToolPermissionEvaluation {
  approved: boolean
  reason: string
}

export type ToolPermissionEvaluator = (
  toolName: string,
  input: unknown
) => Promise<ToolPermissionEvaluation>

/** Explicit human decisions always win over the current mode. */
export async function resolveToolPermission(opts: {
  mode?: BotToolPermissionMode
  resumedDecision: "pending" | "approved" | "declined"
  toolName: string
  input: unknown
  evaluate?: ToolPermissionEvaluator
}): Promise<{
  decision: "pending" | "approved" | "declined"
  reason?: string
}> {
  if (opts.resumedDecision !== "pending") {
    return { decision: opts.resumedDecision }
  }
  if (opts.mode === "allow") return { decision: "approved" }
  if (opts.mode !== "automatic") return { decision: "pending" }
  if (!opts.evaluate)
    throw new Error("Tool permission evaluator is unavailable.")
  const result = await opts.evaluate(opts.toolName, opts.input)
  return {
    decision: result.approved ? "approved" : "declined",
    reason: result.reason,
  }
}
