/**
 * Per-team LLM token/cost metering + monthly budget enforcement.
 *
 * Every agent turn (interactive chat OR a headless Workflows run) is metered
 * by the response-side `meteringMiddleware` (genkitMiddleware.ts), which calls
 * `incrementTeamTokenUsage` with the turn's model and input/output token
 * counts. Usage accumulates in `teams/{teamId}/usage/{YYYY-MM}`. Before a turn
 * runs, `assertWithinBudget` compares the month's token and estimated-cost
 * usage against their active caps and throws `resource-exhausted` once either
 * cap is reached — covering interactive AND autonomous runs.
 *
 * NOTE: minor AI surfaces (summarize, compare, config generators) are not yet
 * metered — only chat turns, which dominate cost. Wire `onUsage` through their
 * `aiMiddlewares()` calls too when full-fidelity accounting is needed.
 */

import { FieldValue } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { HttpsError } from "firebase-functions/v2/https"
import {
  estimateTokenCostUsd,
  getPlanTokenAllowance,
  type PlanKey,
} from "./billingConfig.js"
import {
  MONTHLY_COST_CAP_MIN_CENTS,
  resolveEffectiveTokenAllowance,
} from "./domain.js"
import { db } from "./firebase.js"

/** Calendar-month bucket key (UTC), e.g. "2026-05". */
export function currentUsageMonthKey(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

function usageDocRef(
  teamId: string,
  monthKey: string = currentUsageMonthKey()
) {
  return db.doc(`teams/${teamId}/usage/${monthKey}`)
}

/**
 * Add a turn's token counts to the team's current-month usage doc. Uses atomic
 * `FieldValue.increment` so concurrent turns don't clobber each other.
 * Fire-and-forget by contract: callers `void` it, and any failure is logged
 * rather than thrown — metering must never break or delay a chat turn.
 */
export async function incrementTeamTokenUsage(
  teamId: string,
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const input = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0
  const output = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0
  if (input === 0 && output === 0) return
  const estimatedCostUsd = estimateTokenCostUsd(model, input, output)
  const monthKey = currentUsageMonthKey()
  try {
    await usageDocRef(teamId, monthKey).set(
      {
        month: monthKey,
        inputTokens: FieldValue.increment(input),
        outputTokens: FieldValue.increment(output),
        totalTokens: FieldValue.increment(input + output),
        estimatedCostUsd: FieldValue.increment(estimatedCostUsd),
        turnCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  } catch (err) {
    logger.warn("[usageMetering] failed to record token usage", {
      teamId,
      monthKey,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

export interface TeamUsageBudget {
  planKey: PlanKey
  /** Plan allowance in total tokens; `Infinity` for unlimited plans. */
  allowance: number
  /** Total tokens consumed this month. */
  used: number
  /** Tokens left before the cap; `Infinity` for unlimited plans. */
  remaining: number
  unlimited: boolean
  /** Estimated USD cost accumulated this month. */
  estimatedCostUsd: number
  /** Configured monthly estimated-cost cap in USD; `Infinity` when unset. */
  costAllowanceUsd: number
  /** Estimated USD cost remaining before the optional cost cap. */
  costRemainingUsd: number
  costLimited: boolean
}

/** Read a team's plan allowance + this month's usage. */
export async function getTeamUsageAndBudget(
  teamId: string
): Promise<TeamUsageBudget> {
  const [teamSnap, usageSnap, agentCfgSnap] = await Promise.all([
    db.doc(`teams/${teamId}`).get(),
    usageDocRef(teamId).get(),
    // Read the raw doc rather than importing botAgentConfig.ts (which
    // imports bot.ts, which imports this file) — avoids a load-order cycle.
    db.doc(`teams/${teamId}/settings/agent`).get(),
  ])
  const billing = (teamSnap.data()?.billing ?? {}) as {
    planKey?: PlanKey | null
  }
  const planKey: PlanKey = billing.planKey ?? "personal"
  const planAllowance = getPlanTokenAllowance(planKey)
  // Team-set soft cap (Settings → Usage). Only ever LOWERS the plan allowance.
  const teamCap = agentCfgSnap.data()?.monthlyTokenCap
  const rawAllowance = resolveEffectiveTokenAllowance(planAllowance, teamCap)
  const unlimited = rawAllowance < 0
  const used = Number(usageSnap.data()?.totalTokens ?? 0)
  const estimatedCostUsd = Number(usageSnap.data()?.estimatedCostUsd ?? 0)
  const rawCostCapCents = agentCfgSnap.data()?.monthlyCostCapCents
  const costAllowanceUsd =
    typeof rawCostCapCents === "number" &&
    Number.isFinite(rawCostCapCents) &&
    rawCostCapCents >= MONTHLY_COST_CAP_MIN_CENTS
      ? rawCostCapCents / 100
      : Number.POSITIVE_INFINITY
  const costRemainingUsd = Math.max(0, costAllowanceUsd - estimatedCostUsd)
  const allowance = unlimited ? Number.POSITIVE_INFINITY : rawAllowance
  const remaining = unlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, rawAllowance - used)
  return {
    planKey,
    allowance,
    used,
    remaining,
    unlimited,
    estimatedCostUsd,
    costAllowanceUsd,
    costRemainingUsd,
    costLimited: Number.isFinite(costAllowanceUsd),
  }
}

/**
 * Hard-cap gate: throw `resource-exhausted` when a team has consumed its
 * monthly token allowance. Called before every metered turn (interactive +
 * Workflows), so both inherit the same ceiling.
 */
export async function assertWithinBudget(teamId: string): Promise<void> {
  const {
    remaining,
    used,
    allowance,
    planKey,
    unlimited,
    estimatedCostUsd,
    costAllowanceUsd,
    costLimited,
  } = await getTeamUsageAndBudget(teamId)
  if (
    (unlimited || remaining > 0) &&
    (!costLimited || estimatedCostUsd < costAllowanceUsd)
  ) {
    return
  }
  if (costLimited && estimatedCostUsd >= costAllowanceUsd) {
    throw new HttpsError(
      "resource-exhausted",
      `This team has reached its monthly estimated AI cost limit ` +
        `($${estimatedCostUsd.toFixed(2)} / $${costAllowanceUsd.toFixed(2)}). ` +
        `It resets at the start of next month — lower usage or raise the ` +
        `cost cap in Settings → Usage.`
    )
  }
  throw new HttpsError(
    "resource-exhausted",
    `This team has reached its monthly AI usage limit ` +
      `(${used.toLocaleString()} / ${allowance.toLocaleString()} tokens on the ` +
      `${planKey} plan). It resets at the start of next month — raise the ` +
      `team cap in Settings → Usage or upgrade the plan for a higher limit.`
  )
}
