/**
 * Workflows — team automations that run the AI agent server-side on a
 * schedule, in response to a content event, or on demand. There is no
 * logged-in user: each run executes AS a designated team agent (a Member-role
 * team member), under that agent's role, via `runHeadlessAgentTurn` (bot.ts).
 *
 * Topology (no Cloud Tasks — a Firestore collection is the durable queue):
 *
 *   trigger (schedule tick │ node onWrite │ manual callable)
 *        └─ creates teams/{teamId}/workflowRuns/{runId}  (status: "queued")
 *              └─ onDocumentCreated → executeWorkflowRun  (the worker)
 *                    └─ runHeadlessAgentTurn(...)  → edits content, persists
 *
 * The worker is idempotent (runIdempotentEvent) and self-contained: a run doc
 * captures the prompt/agent/workspace at enqueue time, so it survives the
 * source workflow being edited mid-flight. Cost is bounded by the per-turn
 * guards already in bot.ts (tool-iteration cap, 90s deadline, output caps)
 * plus the monthly token budget gate inside `runAgentTurn` — an over-budget
 * run lands as `blocked`, never an unbounded spend.
 *
 * Writes to `workflows` / `workflowRuns` are server-only (admin SDK); the
 * Firestore rules expose admin-only reads.
 */

import * as logger from "firebase-functions/logger"
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { z } from "zod"

import { DEFAULT_AGENT_ID } from "./agents.js"
import { estimateTokenCostUsd } from "./billingConfig.js"
import {
  getMembershipRole,
  getMembershipRoleOrNull,
  isAdminRole,
  requireVerifiedAuth,
  runHeadlessAgentTurn,
} from "./bot.js"
import { loadTeamAgentConfig } from "./botAgentConfig.js"
import {
  applyProposedChange,
  type CapturedNodeChange,
  type ResolvedNodeContext,
} from "./botNodeTools.js"
import { BUILT_IN_AGENTS_BY_ID, isBuiltInAgentId } from "./builtInAgents.js"
import { admin, db } from "./firebase.js"
import { makeEventIdempotencyKey, runIdempotentEvent } from "./idempotency.js"
import {
  CALLABLE_OPTS,
  GENKIT_OPTS,
  SCHEDULED_OPTS,
  TRIGGER_OPTS,
} from "./runtimeConfig.js"
import { anthropicApiKey, geminiApiKey, openaiApiKey } from "./secrets.js"
import { assertWorkflowAutomaticEntitled } from "./usageMetering.js"
import { getWorkflowPreset } from "./workflowPresets.js"

const FieldValue = admin.firestore.FieldValue
const Timestamp = admin.firestore.Timestamp

/** Max scheduled workflows enqueued per dispatcher tick (fits one 300s run). */
const DISPATCH_BATCH = 200
/** Truncated agent reply stored on a run for the history view. */
const REPLY_PREVIEW_MAX = 600

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Structured schedule presets (no cron dependency). `nextRunAt` is plain
 * arithmetic over these — see `computeNextRunMs`. Arbitrary cron is a
 * fast-follow if teams need finer control.
 */
const scheduleSchema = z.discriminatedUnion("type", [
  // Every N hours from the moment it's saved.
  z.object({
    type: z.literal("interval"),
    everyHours: z.number().int().min(1).max(720),
  }),
  // Daily at a UTC minute-of-day (0–1439).
  z.object({
    type: z.literal("daily"),
    atMinuteUTC: z.number().int().min(0).max(1439),
  }),
  // Weekly on a UTC weekday (0=Sun) at a UTC minute-of-day.
  z.object({
    type: z.literal("weekly"),
    dayOfWeek: z.number().int().min(0).max(6),
    atMinuteUTC: z.number().int().min(0).max(1439),
  }),
])
type WorkflowSchedule = z.infer<typeof scheduleSchema>

const updateModeSchema = z.enum(["automatic", "require_review"])

const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), schedule: scheduleSchema }),
  z.object({
    type: z.literal("event"),
    scope: z.enum(["code", "write"]),
    // Coalesce a burst of edits: enqueue at most one run per window.
    debounceMinutes: z.number().int().min(0).max(1440).optional(),
  }),
  z.object({ type: z.literal("manual") }),
])
type WorkflowTrigger = z.infer<typeof triggerSchema>

const nodeRefSchema = z.object({
  scope: z.enum(["code", "write"]),
  nodeId: z.string().min(1),
})

const workflowDraftSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  /** The team agent this workflow runs AS (must be a team member). */
  agentId: z.string().min(1),
  workspaceId: z.string().min(1),
  /** Tree the workflow may edit; null = the workspace's `write` tree. */
  targetScope: z.enum(["code", "write"]).nullish(),
  /** The procedure the agent follows each run. */
  instructions: z.string().min(1).max(8000),
  /** Optional supplementary instructions appended to `instructions`. */
  additionalPrompt: z.string().max(2000).optional(),
  trigger: triggerSchema,
  /** Optional workspace nodes to ground every run. */
  contextNodes: z.array(nodeRefSchema).max(10).optional(),
  /** `require_review` (default) stages edits for approval; `automatic` applies. */
  updateMode: updateModeSchema.optional(),
  enabled: z.boolean().optional(),
})
type WorkflowDraft = z.infer<typeof workflowDraftSchema>

/** Update accepts the same shape, minus the immutable agent/workspace binding. */
const workflowUpdateSchema = workflowDraftSchema
  .omit({ agentId: true, workspaceId: true })
  .partial()

interface WorkflowDoc {
  name: string
  description: string
  /** null = custom; non-null = a seeded predefined instance. */
  presetKey: string | null
  agentId: string
  workspaceId: string
  targetScope: "code" | "write" | null
  instructions: string
  additionalPrompt: string
  trigger: WorkflowTrigger
  contextNodes: { scope: "code" | "write"; nodeId: string }[]
  updateMode: "automatic" | "require_review"
  enabled: boolean
  archivedAt: admin.firestore.Timestamp | null
}

type RunStatus =
  | "queued"
  | "running"
  | "success" // automatic run that applied its edits
  | "awaiting_review" // require_review run: changeset staged, pending approval
  | "applied" // require_review run: approved + applied
  | "cancelled" // require_review run: rejected
  | "error"
  | "blocked" // over budget / not entitled
  | "skipped" // workflow disabled or removed before it ran

// ─── Paths + auth helpers ─────────────────────────────────────────────────────

const workflowsPath = (teamId: string) => `teams/${teamId}/workflows`
const workflowRunsPath = (teamId: string) => `teams/${teamId}/workflowRuns`

async function assertAdminRole(teamId: string, uid: string): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  if (!isAdminRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only team owners and admins can manage workflows."
    )
  }
}

/**
 * A workflow can only run as an agent that (a) exists + isn't archived and
 * (b) is a team member (so it has a role to act under). Validated at write
 * time so a workflow can't be saved that would fail every run.
 *
 * Built-in personas (`_`-prefixed) have no `agents/{id}` doc — they live in
 * the static registry — so their existence is validated against
 * `BUILT_IN_AGENTS_BY_ID` instead of Firestore. Membership is required for
 * BOTH kinds: a built-in must be explicitly added as a team member (just like
 * a custom agent) before a workflow can run as it. Mirrors `resolveActingRole`
 * in bot.ts, which gates the actual turn on the agent's membership role.
 */
async function assertAgentRunnable(
  teamId: string,
  agentId: string
): Promise<void> {
  const role = await getMembershipRoleOrNull(teamId, agentId)
  if (isBuiltInAgentId(agentId)) {
    if (!BUILT_IN_AGENTS_BY_ID[agentId]) {
      throw new HttpsError(
        "failed-precondition",
        "Choose an existing, non-archived team agent for this workflow."
      )
    }
  } else {
    const agentSnap = await db.doc(`teams/${teamId}/agents/${agentId}`).get()
    if (!agentSnap.exists || agentSnap.data()?.archivedAt) {
      throw new HttpsError(
        "failed-precondition",
        "Choose an existing, non-archived team agent for this workflow."
      )
    }
  }
  if (!role) {
    throw new HttpsError(
      "failed-precondition",
      "That agent isn't a team member yet. Add it as a team member (with " +
        "edit rights) before using it in a workflow."
    )
  }
}

/** Message shown when the team-wide custom-workflows gate blocks an action. */
const CUSTOM_WORKFLOWS_OFF =
  "Custom workflows are turned off for this team. An admin can re-enable " +
  "them in Settings → Workflows."

/**
 * Team-wide "custom workflows" gate — mirrors the `customAgents` usage gate in
 * bot.ts. CUSTOM workflows (`presetKey == null`) are blocked from being created
 * or run when off; PREDEFINED workflows (`presetKey != null`) are unaffected,
 * just as built-in personas differ from the custom-agents feature flag.
 */
async function customWorkflowsEnabled(teamId: string): Promise<boolean> {
  const cfg = await loadTeamAgentConfig(teamId)
  return cfg.tools.customWorkflows !== false
}

// ─── Scheduling math ──────────────────────────────────────────────────────────

/** Next fire time (epoch ms) at/after `fromMs` for a structured schedule. */
function computeNextRunMs(schedule: WorkflowSchedule, fromMs: number): number {
  if (schedule.type === "interval") {
    return fromMs + schedule.everyHours * 3_600_000
  }
  const from = new Date(fromMs)
  // Date.UTC normalizes minute overflow (atMinuteUTC up to 1439 = 23:59).
  const at = (y: number, mo: number, d: number) =>
    Date.UTC(y, mo, d, 0, schedule.atMinuteUTC, 0, 0)

  if (schedule.type === "daily") {
    let next = at(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
    if (next <= fromMs)
      next = at(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + 1
      )
    return next
  }
  // weekly
  const base = new Date(
    at(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  )
  const dayDiff = (schedule.dayOfWeek - base.getUTCDay() + 7) % 7
  let next = base.getTime() + dayDiff * 86_400_000
  if (next <= fromMs) next += 7 * 86_400_000
  return next
}

/**
 * The `nextRunAt` a workflow doc should carry: a Timestamp when it's an
 * enabled schedule, otherwise `FieldValue.delete()` so event/manual (and
 * disabled) workflows are absent from the dispatcher's `nextRunAt` query.
 */
function nextRunAtField(
  enabled: boolean,
  trigger: WorkflowTrigger,
  nowMs: number
): admin.firestore.Timestamp | admin.firestore.FieldValue {
  if (enabled && trigger.type === "schedule") {
    return Timestamp.fromMillis(computeNextRunMs(trigger.schedule, nowMs))
  }
  return FieldValue.delete()
}

// ─── Run queue ────────────────────────────────────────────────────────────────

/**
 * Create a `queued` run doc — the durable hand-off to the worker. Captures the
 * prompt/agent/workspace/context so the run is self-contained even if the
 * source workflow changes or is deleted before the worker picks it up.
 */
async function enqueueWorkflowRun(params: {
  teamId: string
  workflowId: string
  workflow: Pick<
    WorkflowDoc,
    | "agentId"
    | "workspaceId"
    | "instructions"
    | "additionalPrompt"
    | "contextNodes"
    | "updateMode"
    | "targetScope"
    | "presetKey"
  >
  /** Structured `triggeredBy` (schedule | event | manual) snapshotted on the run. */
  triggeredBy: Record<string, unknown>
  triggerEventId?: string | null
}): Promise<string> {
  const runRef = db.collection(workflowRunsPath(params.teamId)).doc()
  const wf = params.workflow
  // Compose the single instruction the agent runs from instructions + the
  // optional supplementary prompt. Snapshotted so the run is self-contained.
  const prompt = wf.additionalPrompt
    ? `${wf.instructions}\n\n${wf.additionalPrompt}`
    : wf.instructions
  await runRef.set({
    workflowId: params.workflowId,
    agentId: wf.agentId,
    workspaceId: wf.workspaceId,
    presetKey: wf.presetKey ?? null,
    prompt,
    contextNodes: wf.contextNodes ?? [],
    targetScope: wf.targetScope ?? null,
    updateMode: wf.updateMode ?? "require_review",
    triggeredBy: params.triggeredBy,
    triggerEventId: params.triggerEventId ?? null,
    status: "queued" satisfies RunStatus,
    changes: [],
    usage: null,
    queuedAt: FieldValue.serverTimestamp(),
  })
  return runRef.id
}

// ─── CRUD callables (admin-gated) ─────────────────────────────────────────────

function buildWorkflowDocData(
  draft: WorkflowDraft,
  uid: string,
  nowMs: number,
  presetKey: string | null = null
) {
  const enabled = draft.enabled ?? true
  return {
    name: draft.name,
    description: draft.description ?? "",
    presetKey,
    agentId: draft.agentId,
    workspaceId: draft.workspaceId,
    targetScope: draft.targetScope ?? null,
    instructions: draft.instructions,
    additionalPrompt: draft.additionalPrompt ?? "",
    trigger: draft.trigger,
    contextNodes: draft.contextNodes ?? [],
    updateMode: draft.updateMode ?? "require_review",
    enabled,
    archivedAt: null,
    createdByUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    // Only enabled schedules carry a nextRunAt (drives the dispatcher).
    ...(enabled && draft.trigger.type === "schedule"
      ? { nextRunAt: nextRunAtField(true, draft.trigger, nowMs) }
      : {}),
  }
}

export const createTeamWorkflow = onCall<{ teamId: string; draft: unknown }>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, draft } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    await assertAdminRole(teamId, auth.uid)
    // CRUD gate: creating a workflow here is always a CUSTOM one (predefined
    // come from enableTeamWorkflowPreset), so block when the team-wide toggle
    // is off — defense in depth behind the client's disabled "New workflow".
    if (!(await customWorkflowsEnabled(teamId))) {
      throw new HttpsError("failed-precondition", CUSTOM_WORKFLOWS_OFF)
    }

    const parsed = workflowDraftSchema.safeParse(draft ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid workflow: ${parsed.error.message}`
      )
    }
    await assertAgentRunnable(teamId, parsed.data.agentId)

    const ref = db.collection(workflowsPath(teamId)).doc()
    await ref.set(buildWorkflowDocData(parsed.data, auth.uid, Date.now()))
    return { workflowId: ref.id }
  }
)

export const updateTeamWorkflow = onCall<{
  teamId: string
  workflowId: string
  patch: unknown
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workflowId, patch } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const parsed = workflowUpdateSchema.safeParse(patch ?? {})
  if (!parsed.success) {
    throw new HttpsError(
      "invalid-argument",
      `Invalid workflow patch: ${parsed.error.message}`
    )
  }

  const ref = db.doc(`${workflowsPath(teamId)}/${workflowId}`)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError("not-found", "Workflow not found.")
  }
  const current = snap.data() as WorkflowDoc

  // Resolve the post-update enabled + trigger so nextRunAt stays consistent.
  const nextEnabled = parsed.data.enabled ?? current.enabled
  const nextTrigger = parsed.data.trigger ?? current.trigger

  await ref.update({
    ...parsed.data,
    updatedAt: FieldValue.serverTimestamp(),
    nextRunAt: nextRunAtField(nextEnabled, nextTrigger, Date.now()),
  })
  return { ok: true }
})

export const setTeamWorkflowEnabled = onCall<{
  teamId: string
  workflowId: string
  enabled: boolean
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workflowId, enabled } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "enabled must be a boolean.")
  }
  await assertAdminRole(teamId, auth.uid)

  const ref = db.doc(`${workflowsPath(teamId)}/${workflowId}`)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError("not-found", "Workflow not found.")
  }
  const current = snap.data() as WorkflowDoc
  await ref.update({
    enabled,
    updatedAt: FieldValue.serverTimestamp(),
    nextRunAt: nextRunAtField(enabled, current.trigger, Date.now()),
  })
  return { ok: true }
})

export const archiveTeamWorkflow = onCall<{
  teamId: string
  workflowId: string
  archived: boolean
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workflowId, archived } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const ref = db.doc(`${workflowsPath(teamId)}/${workflowId}`)
  // Archiving also disables (and drops nextRunAt) so an archived workflow
  // never fires.
  await ref.update({
    archivedAt: archived ? FieldValue.serverTimestamp() : null,
    enabled: false,
    updatedAt: FieldValue.serverTimestamp(),
    nextRunAt: FieldValue.delete(),
  })
  return { ok: true }
})

export const deleteTeamWorkflow = onCall<{
  teamId: string
  workflowId: string
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workflowId } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)
  await db.doc(`${workflowsPath(teamId)}/${workflowId}`).delete()
  return { ok: true }
})

/** Fire a workflow by hand (also the easiest way to test the engine). */
export const runTeamWorkflowNow = onCall<{
  teamId: string
  workflowId: string
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workflowId } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const snap = await db.doc(`${workflowsPath(teamId)}/${workflowId}`).get()
  if (!snap.exists) {
    throw new HttpsError("not-found", "Workflow not found.")
  }
  const wf = snap.data() as WorkflowDoc
  if (wf.archivedAt) {
    throw new HttpsError("failed-precondition", "This workflow is archived.")
  }
  // Usage gate: a custom workflow can't be run when the team toggle is off.
  if (!wf.presetKey && !(await customWorkflowsEnabled(teamId))) {
    throw new HttpsError("failed-precondition", CUSTOM_WORKFLOWS_OFF)
  }
  const runId = await enqueueWorkflowRun({
    teamId,
    workflowId,
    workflow: wf,
    triggeredBy: { type: "manual", uid: auth.uid },
  })
  return { runId }
})

/**
 * Approve (apply the staged changeset) or reject (discard) a `require_review`
 * run. Admin-gated — the approving admin's role is the authority for the
 * writes, which stay attributed to the workflow's agent. Only an
 * `awaiting_review` run can be decided.
 */
export const reviewTeamWorkflowRun = onCall<{
  teamId: string
  runId: string
  decision: "approve" | "reject"
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, runId, decision } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof runId !== "string" || !runId) {
    throw new HttpsError("invalid-argument", "runId is required.")
  }
  if (decision !== "approve" && decision !== "reject") {
    throw new HttpsError(
      "invalid-argument",
      "decision must be 'approve' or 'reject'."
    )
  }
  await assertAdminRole(teamId, auth.uid)

  const runRef = db.doc(`${workflowRunsPath(teamId)}/${runId}`)
  const runSnap = await runRef.get()
  if (!runSnap.exists) throw new HttpsError("not-found", "Run not found.")
  const run = runSnap.data() as {
    status?: string
    agentId?: string
    workspaceId?: string
  }
  if (run.status !== "awaiting_review") {
    throw new HttpsError(
      "failed-precondition",
      "This run isn't awaiting review."
    )
  }

  if (decision === "reject") {
    await runRef.update({
      status: "cancelled" satisfies RunStatus,
      reviewedByUid: auth.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      finishedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true, status: "cancelled" }
  }

  // Approve — replay each staged proposal through the SAME commit core the
  // live tools use, so an approved edit is identical to an immediate one.
  const agentId = run.agentId ?? ""
  const workspaceId = run.workspaceId ?? ""
  // Built-ins have no `agents/{id}` doc — resolve their display name from the
  // static registry; custom agents read it from their Firestore doc.
  let agentName = "Agent"
  if (isBuiltInAgentId(agentId)) {
    agentName = BUILT_IN_AGENTS_BY_ID[agentId]?.name ?? "Agent"
  } else if (agentId) {
    const agentSnap = await db.doc(`teams/${teamId}/agents/${agentId}`).get()
    agentName = (agentSnap.data()?.name as string | undefined) ?? "Agent"
  }
  const resolved: ResolvedNodeContext = {
    teamId,
    workspaceId,
    agentId,
    agentName,
    actorUid: auth.uid, // the approving admin's authority backs the write
  }

  const proposed = await runRef
    .collection("proposedChanges")
    .orderBy("index")
    .get()
  let failures = 0
  for (const doc of proposed.docs) {
    const change = doc.data() as CapturedNodeChange
    try {
      const res = await applyProposedChange(resolved, change)
      if (!res.ok) failures++
    } catch {
      failures++
    }
  }

  await runRef.update({
    status: "applied" satisfies RunStatus,
    reviewedByUid: auth.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    finishedAt: FieldValue.serverTimestamp(),
    ...(failures > 0
      ? {
          error: `${failures} change(s) couldn't be applied — the target may have changed since the run.`,
        }
      : {}),
  })
  return { ok: true, status: "applied" }
})

/**
 * Materialize a predefined catalog preset as a `presetKey != null` workflow —
 * validated + persisted through the exact same path as a custom workflow.
 * Refuses presets whose underlying dependency doesn't exist yet.
 */
export const enableTeamWorkflowPreset = onCall<{
  teamId: string
  presetKey: string
  workspaceId: string
  agentId: string
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, presetKey, workspaceId, agentId } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
  }
  if (typeof agentId !== "string" || !agentId) {
    throw new HttpsError("invalid-argument", "agentId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const preset =
    typeof presetKey === "string" ? getWorkflowPreset(presetKey) : undefined
  if (!preset) throw new HttpsError("invalid-argument", "Unknown preset.")
  if (preset.requiresDependency) {
    throw new HttpsError(
      "failed-precondition",
      "This predefined workflow isn't available yet — it depends on a " +
        "feature that hasn't shipped."
    )
  }
  await assertAgentRunnable(teamId, agentId)

  const parsed = workflowDraftSchema.safeParse({
    name: preset.name,
    description: preset.description,
    agentId,
    workspaceId,
    targetScope: preset.defaultTargetScope,
    instructions: preset.instructions,
    additionalPrompt: preset.additionalPrompt,
    trigger: preset.defaultTrigger,
    updateMode: preset.defaultUpdateMode,
    enabled: true,
  })
  if (!parsed.success) {
    throw new HttpsError("internal", `Invalid preset: ${parsed.error.message}`)
  }

  const ref = db.collection(workflowsPath(teamId)).doc()
  await ref.set(
    buildWorkflowDocData(parsed.data, auth.uid, Date.now(), preset.key)
  )
  return { workflowId: ref.id }
})

// ─── Scheduled dispatcher (tick) ──────────────────────────────────────────────

/**
 * Fixed-cadence tick: find scheduled workflows whose `nextRunAt` is due,
 * enqueue a run for each, and advance `nextRunAt` to the next slot. Only
 * enabled schedule workflows carry `nextRunAt`, so the single-field query
 * needs no composite index; `enabled` is re-checked in code as a belt-and-
 * suspenders guard. Missed slots are NOT backfilled — `nextRunAt` advances
 * from now, avoiding a thundering herd after downtime.
 */
export const dispatchScheduledWorkflows = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    retryCount: 1,
    ...SCHEDULED_OPTS,
  },
  async () => {
    const nowMs = Date.now()
    const due = await db
      .collectionGroup("workflows")
      .where("nextRunAt", "<=", Timestamp.fromMillis(nowMs))
      .limit(DISPATCH_BATCH)
      .get()
    if (due.empty) return

    let dispatched = 0
    // Per-tick cache of the custom-workflows gate, keyed by team, so a batch
    // touching many workflows from one team reads the config at most once.
    const gateByTeam = new Map<string, boolean>()
    for (const doc of due.docs) {
      const teamId = doc.ref.parent.parent?.id
      const wf = doc.data() as WorkflowDoc
      if (!teamId) continue
      if (wf.enabled === false || wf.archivedAt) continue
      if (wf.trigger?.type !== "schedule") continue
      // Usage gate: skip CUSTOM workflows when the team toggle is off.
      if (!wf.presetKey) {
        let ok = gateByTeam.get(teamId)
        if (ok === undefined) {
          ok = await customWorkflowsEnabled(teamId)
          gateByTeam.set(teamId, ok)
        }
        if (!ok) continue
      }
      try {
        await enqueueWorkflowRun({
          teamId,
          workflowId: doc.id,
          workflow: wf,
          triggeredBy: { type: "schedule" },
        })
        await doc.ref.update({
          nextRunAt: Timestamp.fromMillis(
            computeNextRunMs(wf.trigger.schedule, nowMs)
          ),
          lastEnqueuedAt: FieldValue.serverTimestamp(),
        })
        dispatched++
      } catch (err) {
        logger.warn("[workflows] dispatch failed for one workflow", {
          teamId,
          workflowId: doc.id,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    }
    logger.info("[workflows] dispatch tick complete", {
      due: due.size,
      dispatched,
    })
  }
)

// ─── Content-event triggers ───────────────────────────────────────────────────

/**
 * One trigger per node scope. When a human edits a code/write node, enqueue a
 * run for each enabled `event` workflow bound to that scope + workspace.
 * Guards against re-fire loops: skips deletes, content-unchanged writes (which
 * include the embed-on-write trigger's writeback), and writes authored by an
 * agent member (so an agent's own edit can't retrigger workflows).
 */
function makeWorkflowTrigger(scope: "code" | "write") {
  return onDocumentWritten(
    {
      document: `teams/{teamId}/workspaces/{workspaceId}/${scope}/{nodeId}`,
      ...TRIGGER_OPTS,
    },
    async (event) => {
      const teamId = event.params.teamId as string
      const workspaceId = event.params.workspaceId as string
      const nodeId = event.params.nodeId as string
      const before = event.data?.before?.data()
      const after = event.data?.after?.data()

      if (!after) return // deletion — nothing to react to
      if (before && before.content === after.content) return // no content change

      // Skip agent-authored writes to break agent-edit → trigger → agent-edit
      // loops. Agent ids look like uids, so resolve the membership kind.
      const updatedBy =
        typeof after.updatedBy === "string" ? after.updatedBy : null
      if (updatedBy) {
        const member = await db
          .doc(`teams/${teamId}/memberships/${updatedBy}`)
          .get()
        if (member.exists && member.data()?.kind === "agent") return
      }

      // Single-equality query (auto-indexed); filter the rest in code.
      const candidates = await db
        .collection(workflowsPath(teamId))
        .where("workspaceId", "==", workspaceId)
        .get()
      // Resolved lazily once per event (only if a custom candidate appears).
      let customGate: boolean | null = null
      for (const doc of candidates.docs) {
        const wf = doc.data() as WorkflowDoc
        const trig = wf.trigger
        if (wf.enabled === false || wf.archivedAt) continue
        if (trig?.type !== "event" || trig.scope !== scope) continue
        // Usage gate: skip CUSTOM workflows when the team toggle is off.
        if (!wf.presetKey) {
          if (customGate === null) {
            customGate = await customWorkflowsEnabled(teamId)
          }
          if (!customGate) continue
        }

        // Debounce: coalesce a burst of edits into at most one run per window
        // (leading-edge — the first edit fires, later ones inside the window
        // are suppressed). Bounds cost when a doc is saved repeatedly.
        const debounceMs = (trig.debounceMinutes ?? 0) * 60_000
        if (debounceMs > 0) {
          const last =
            (
              doc.data().lastEventEnqueuedAt as
                | admin.firestore.Timestamp
                | undefined
            )?.toMillis() ?? 0
          if (Date.now() - last < debounceMs) continue
        }

        // One enqueue per (workflow, triggering event) even on redelivery.
        await runIdempotentEvent(
          { key: makeEventIdempotencyKey(`workflowEvent:${doc.id}`, event.id) },
          async () => {
            await enqueueWorkflowRun({
              teamId,
              workflowId: doc.id,
              workflow: wf,
              triggeredBy: { type: "event", scope, nodeId },
              triggerEventId: event.id,
            })
            if (debounceMs > 0) {
              await doc.ref.update({
                lastEventEnqueuedAt: FieldValue.serverTimestamp(),
              })
            }
          }
        )
      }
    }
  )
}

export const runWorkflowsOnCodeWrite = makeWorkflowTrigger("code")
export const runWorkflowsOnWriteWrite = makeWorkflowTrigger("write")

// ─── Worker ───────────────────────────────────────────────────────────────────

/**
 * Execute a queued run: run the agent headlessly, then record the outcome on
 * the run + its workflow. Errors are caught and written as a terminal status
 * (never rethrown) so Cloud Functions doesn't auto-retry an LLM turn — a
 * double-retry would double-spend. The idempotency wrapper only guards against
 * duplicate delivery of the same create event.
 */
export const executeWorkflowRun = onDocumentCreated(
  {
    document: "teams/{teamId}/workflowRuns/{runId}",
    ...GENKIT_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
  },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const run = snap.data()
    if (run.status !== "queued") return // only fresh runs

    const teamId = event.params.teamId as string

    await runIdempotentEvent(
      { key: makeEventIdempotencyKey("executeWorkflowRun", event.id) },
      async () => {
        const workflowRef = db.doc(`${workflowsPath(teamId)}/${run.workflowId}`)
        await snap.ref.update({
          status: "running" satisfies RunStatus,
          startedAt: FieldValue.serverTimestamp(),
        })

        const finish = async (
          status: RunStatus,
          extra: Record<string, unknown> = {}
        ) => {
          await snap.ref.update({
            status,
            finishedAt: FieldValue.serverTimestamp(),
            ...extra,
          })
          // Best-effort lastRun stamp on the source workflow (may be gone).
          await workflowRef
            .update({
              lastRunAt: FieldValue.serverTimestamp(),
              lastRunStatus: status,
            })
            .catch(() => undefined)
        }

        // The workflow may have been disabled/deleted between enqueue and now.
        const wfSnap = await workflowRef.get()
        const wf = wfSnap.data() as WorkflowDoc | undefined
        if (!wfSnap.exists || wf?.enabled === false || wf?.archivedAt) {
          await snap.ref.update({
            status: "skipped" satisfies RunStatus,
            finishedAt: FieldValue.serverTimestamp(),
            error: "Workflow was disabled or removed before it ran.",
          })
          return
        }
        // Usage gate (authoritative backstop): a CUSTOM workflow can't run
        // when the team toggle is off, even if a run was already enqueued.
        if (wf && !wf.presetKey && !(await customWorkflowsEnabled(teamId))) {
          await snap.ref.update({
            status: "skipped" satisfies RunStatus,
            finishedAt: FieldValue.serverTimestamp(),
            error: CUSTOM_WORKFLOWS_OFF,
          })
          return
        }

        const updateMode: "automatic" | "require_review" =
          run.updateMode === "automatic" ? "automatic" : "require_review"
        const targetScope =
          (run.targetScope as "code" | "write" | null | undefined) ?? null

        // Entitlement gate for AUTO-APPLY runs (the brief's hard rule): an
        // automatic run mutates content unattended, so it additionally
        // requires an entitled team. require_review is human-gated and skips
        // this. Budget (assertWithinBudget) covers BOTH inside runAgentTurn.
        if (updateMode === "automatic") {
          try {
            await assertWorkflowAutomaticEntitled(teamId)
          } catch (err) {
            await finish("blocked", {
              error: (err instanceof Error ? err.message : String(err)).slice(
                0,
                500
              ),
            })
            return
          }
        }

        try {
          const result = await runHeadlessAgentTurn({
            agentId: run.agentId,
            teamId,
            workspaceId: run.workspaceId,
            message: run.prompt,
            contextNodes: run.contextNodes ?? [],
            updateMode,
            targetScope,
            // The Default agent may hand off to a team specialist mid-run; a
            // specific picked agent runs alone (the admin chose it). The
            // handed-off turn inherits this run's capture + metering.
            allowTransfer: run.agentId === DEFAULT_AGENT_ID,
          })

          const usage = {
            model: result.usage.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            estimatedCostUsd: estimateTokenCostUsd(
              result.usage.model,
              result.usage.inputTokens,
              result.usage.outputTokens
            ),
          }
          // Lightweight summaries on the run doc; full payloads (for replay)
          // go in the proposedChanges subcollection for require_review runs.
          const changeSummaries = result.changes.map((c) => ({
            scope: c.scope,
            nodeId: c.nodeId ?? null,
            op: c.op,
            summary: c.summary,
            sourceNodeId: c.sourceNodeId ?? null,
          }))

          if (updateMode === "require_review") {
            // One doc per change keeps the run doc under Firestore's 1MB cap.
            if (result.changes.length > 0) {
              const batch = db.batch()
              result.changes.forEach((c, i) => {
                batch.set(
                  snap.ref.collection("proposedChanges").doc(String(i)),
                  {
                    index: i,
                    op: c.op,
                    scope: c.scope,
                    nodeId: c.nodeId ?? null,
                    summary: c.summary,
                    sourceNodeId: c.sourceNodeId ?? null,
                    input: c.input,
                  }
                )
              })
              await batch.commit()
            }
            await finish("awaiting_review", {
              sessionId: result.sessionId,
              replyPreview: result.reply.slice(0, REPLY_PREVIEW_MAX),
              usage,
              changes: changeSummaries,
            })
          } else {
            await finish("success", {
              sessionId: result.sessionId,
              replyPreview: result.reply.slice(0, REPLY_PREVIEW_MAX),
              usage,
              changes: changeSummaries,
            })
          }
        } catch (err) {
          const code = (err as { code?: string }).code
          const message = err instanceof Error ? err.message : String(err)
          // Over-budget is a distinct, expected outcome (not a failure).
          const status: RunStatus =
            code === "resource-exhausted" ? "blocked" : "error"
          logger.warn("[workflows] run finished with non-success", {
            teamId,
            workflowId: run.workflowId,
            runId: event.params.runId,
            status,
            message,
          })
          await finish(status, { error: message.slice(0, 500) })
        }
      }
    )
  }
)
