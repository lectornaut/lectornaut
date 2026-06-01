/**
 * Per-team LLM token metering + monthly budget enforcement.
 *
 * Every agent turn (interactive chat OR a headless Workflows run) is metered
 * by the response-side `meteringMiddleware` (genkitMiddleware.ts), which calls
 * `incrementTeamTokenUsage` with the turn's input/output token counts. Usage
 * accumulates in `teams/{teamId}/usage/{YYYY-MM}`. Before a turn runs,
 * `assertWithinBudget` compares the month's `totalTokens` against the team's
 * plan allowance (billingConfig.ts) and throws `resource-exhausted` once the
 * cap is reached — a HARD cap covering interactive AND autonomous runs.
 *
 * NOTE: minor AI surfaces (summarize, compare, config generators) are not yet
 * metered — only chat turns, which dominate cost. Wire `onUsage` through their
 * `aiMiddlewares()` calls too when full-fidelity accounting is needed.
 */

import * as logger from "firebase-functions/logger"
import { HttpsError } from "firebase-functions/v2/https"

import { getPlanTokenAllowance, type PlanKey } from "./billingConfig.js"
import { admin, db } from "./firebase.js"

const FieldValue = admin.firestore.FieldValue

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
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const input = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0
  const output = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0
  if (input === 0 && output === 0) return
  const monthKey = currentUsageMonthKey()
  try {
    await usageDocRef(teamId, monthKey).set(
      {
        month: monthKey,
        inputTokens: FieldValue.increment(input),
        outputTokens: FieldValue.increment(output),
        totalTokens: FieldValue.increment(input + output),
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
}

/** Read a team's plan allowance + this month's usage. */
export async function getTeamUsageAndBudget(
  teamId: string
): Promise<TeamUsageBudget> {
  const [teamSnap, usageSnap] = await Promise.all([
    db.doc(`teams/${teamId}`).get(),
    usageDocRef(teamId).get(),
  ])
  const billing = (teamSnap.data()?.billing ?? {}) as {
    planKey?: PlanKey | null
  }
  const planKey: PlanKey = billing.planKey ?? "personal"
  const rawAllowance = getPlanTokenAllowance(planKey)
  const unlimited = rawAllowance < 0
  const used = Number(usageSnap.data()?.totalTokens ?? 0)
  const allowance = unlimited ? Number.POSITIVE_INFINITY : rawAllowance
  const remaining = unlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, rawAllowance - used)
  return { planKey, allowance, used, remaining, unlimited }
}

/**
 * Hard-cap gate: throw `resource-exhausted` when a team has consumed its
 * monthly token allowance. Called before every metered turn (interactive +
 * Workflows), so both inherit the same ceiling.
 */
export async function assertWithinBudget(teamId: string): Promise<void> {
  const { remaining, used, allowance, planKey, unlimited } =
    await getTeamUsageAndBudget(teamId)
  if (unlimited || remaining > 0) return
  throw new HttpsError(
    "resource-exhausted",
    `This team has reached its monthly AI usage limit ` +
      `(${used.toLocaleString()} / ${allowance.toLocaleString()} tokens on the ` +
      `${planKey} plan). It resets at the start of next month — or upgrade the ` +
      `plan for a higher limit.`
  )
}

/**
 * Entitlement gate for AUTOMATIC (auto-apply) Workflows runs. `require_review`
 * runs are human-gated and skip this; an `automatic` run both spends tokens
 * AND mutates content with no human in the loop, so it additionally requires
 * the team to be entitled (active/among-grace subscription). Blocks only when
 * entitlement is EXPLICITLY false, so a team with the field unset isn't locked
 * out — tune to `!== true` for a stricter posture. Throws `failed-precondition`
 * (the worker maps it to a `blocked` run, not an error — no spend, no edits).
 */
export async function assertWorkflowAutomaticEntitled(
  teamId: string
): Promise<void> {
  const teamSnap = await db.doc(`teams/${teamId}`).get()
  const billing = (teamSnap.data()?.billing ?? {}) as { isEntitled?: boolean }
  if (billing.isEntitled === false) {
    throw new HttpsError(
      "failed-precondition",
      "Automatic workflows require an active subscription. Switch this " +
        "workflow to require-review, or update billing to enable auto-apply."
    )
  }
}
