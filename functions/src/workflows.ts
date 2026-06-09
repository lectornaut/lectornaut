/**
 * Workflows — team automations that run the AI agent server-side on a
 * schedule, in response to a content event, or on demand. There is no
 * logged-in user: each run executes AS a designated team agent (a Member-role
 * team member), under that agent's role, via `runHeadlessAgentTurn` (bot.ts).
 *
 * Topology (no Cloud Tasks — a Firestore collection is the durable queue):
 *
 *   trigger (schedule tick │ node onWrite │ manual callable)
 *        └─ creates …/workspaces/{w}/workflowRuns/{runId}  (status: "queued")
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
 * Workflows and their run history both persist per-workspace under
 * `teams/{teamId}/workspaces/{workspaceId}/{workflows,workflowRuns}` and are
 * read team-wide via a collectionGroup on the denormalized `teamId`. Both are
 * written server-only (admin SDK); the rules expose member reads for workflows
 * (the picker/automations UI) and admin-only reads for runs.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { z } from "zod"
import { DEFAULT_AGENT_ID } from "./agents.js"
import { requireVerifiedAuth } from "./auth.js"
import { assertAdminRole as assertTeamAdminRole } from "./authGuards.js"
import { estimateTokenCostUsd } from "./billingConfig.js"
import { getMembershipRoleOrNull, runHeadlessAgentTurn } from "./bot.js"
import { loadTeamAgentConfig } from "./botAgentConfig.js"
import { CONTEXT_NODE_MAX } from "./botContext.js"
import {
  applyProposedChange,
  type CapturedNodeChange,
  type ResolvedNodeContext,
} from "./botNodeTools.js"
import { BUILT_IN_AGENTS_BY_ID, isBuiltInAgentId } from "./builtInAgents.js"
import {
  NODE_SCOPES,
  WORKFLOW_UPDATE_MODES,
  type WorkflowRunStatus,
} from "./domain.js"
import { db } from "./firebase.js"
import { makeEventIdempotencyKey, runIdempotentEvent } from "./idempotency.js"
import { sendNotificationToMany } from "./notifier.js"
import {
  CALLABLE_OPTS,
  GENKIT_OPTS,
  SCHEDULED_OPTS,
  TRIGGER_OPTS,
} from "./runtimeConfig.js"
import {
  anthropicApiKey,
  geminiApiKey,
  openaiApiKey,
  postmarkApiKey,
} from "./secrets.js"
import { getTeamAdminsAndOwners } from "./teams.js"
import type { WorkspaceNodeScope } from "./types.js"
import { assertWorkflowAutomaticEntitled } from "./usageMetering.js"
import { getWorkflowPreset } from "./workflowPresets.js"

/** Max scheduled workflows enqueued per dispatcher tick (fits one 300s run). */
const DISPATCH_BATCH = 200
/** Truncated agent reply stored on a run for the history view. */
const REPLY_PREVIEW_MAX = 600
/** Max active (non-archived) workflows per team (workflows cap themselves). */
const MAX_ACTIVE_WORKFLOWS = 50

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

const updateModeSchema = z.enum(WORKFLOW_UPDATE_MODES)

const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), schedule: scheduleSchema }),
  z.object({
    type: z.literal("event"),
    scope: z.enum(NODE_SCOPES),
    // Coalesce a burst of edits: enqueue at most one run per window.
    debounceMinutes: z.number().int().min(0).max(1440).optional(),
  }),
  z.object({ type: z.literal("manual") }),
])
type WorkflowTrigger = z.infer<typeof triggerSchema>

const nodeRefSchema = z.object({
  scope: z.enum(NODE_SCOPES),
  nodeId: z.string().min(1),
})

const workflowDraftSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  /** Seed for the workflow's generative avatar; falls back to `name`. */
  avatarSeed: z.string().max(40).optional(),
  /** The team agent this workflow runs AS (must be a team member). */
  agentId: z.string().min(1),
  workspaceId: z.string().min(1),
  /** Tree the workflow may edit; null = the workspace's `write` tree. */
  targetScope: z.enum(NODE_SCOPES).nullish(),
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
  // Denormalized so collection-group reads/queries (the team-wide client list,
  // the slot count, the scheduler) recover the team without path-walking the
  // now-nested `teams/{t}/workspaces/{w}/workflows` location.
  teamId: string
  name: string
  description: string
  avatarSeed: string
  /**
   * Provenance: the catalog preset key for a materialized preset, or null for a
   * hand-authored custom workflow. The custom-workflows gate keys off
   * `!presetKey`.
   */
  presetKey: string | null
  agentId: string
  workspaceId: string
  targetScope: WorkspaceNodeScope | null
  instructions: string
  additionalPrompt: string
  trigger: WorkflowTrigger
  contextNodes: { scope: WorkspaceNodeScope; nodeId: string }[]
  updateMode: "automatic" | "require_review"
  enabled: boolean
  archivedAt: Timestamp | null
}

type RunStatus = WorkflowRunStatus

// ─── Paths + auth helpers ─────────────────────────────────────────────────────

// Workflows + run history persist under each workspace (sibling collections).
// `integrationsPath` is retained for AGENT lookups only — a workflow runs AS a
// team agent, and agents live in the agent+tool integrations collection.
const workflowsPath = (teamId: string, workspaceId: string) =>
  `teams/${teamId}/workspaces/${workspaceId}/workflows`
const workflowRunsPath = (teamId: string, workspaceId: string) =>
  `teams/${teamId}/workspaces/${workspaceId}/workflowRuns`
const integrationsPath = (teamId: string) => `teams/${teamId}/integrations`
/**
 * Team-level "availability" gate for predefined presets (the Integrations
 * surface). Workspace-agnostic: records WHICH presets the team offers,
 * separately from per-workspace deployment (a `presetKey != null` workflow
 * doc). The doc id is the presetKey. See `setTeamWorkflowAvailability`.
 */
const availableWorkflowsPath = (teamId: string) =>
  `teams/${teamId}/availableWorkflows`

/** Owner/admin gate (shared role logic — see authGuards.ts + shared/permissions). */
const assertAdminRole = (teamId: string, uid: string): Promise<void> =>
  assertTeamAdminRole(
    teamId,
    uid,
    "Only team owners and admins can manage workflows."
  )

/**
 * Cap active (non-archived) workflows per team. Enforced on BOTH create paths
 * (custom + preset) so workflows can't grow unbounded, mirroring the agent/tool
 * caps in integrations.ts.
 */
async function assertWorkflowSlotAvailable(teamId: string): Promise<void> {
  // Workflows now live under each workspace; count them team-wide via a
  // collection group on the denormalized `teamId` (COLLECTION_GROUP index:
  // teamId,archivedAt).
  const snap = await db
    .collectionGroup("workflows")
    .where("teamId", "==", teamId)
    .where("archivedAt", "==", null)
    .count()
    .get()
  if (snap.data().count >= MAX_ACTIVE_WORKFLOWS) {
    throw new HttpsError(
      "failed-precondition",
      `Active workflow limit reached (${MAX_ACTIVE_WORKFLOWS}). ` +
        "Archive or delete one to free a slot."
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
    const agentSnap = await db
      .doc(`${integrationsPath(teamId)}/${agentId}`)
      .get()
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
): Timestamp | FieldValue {
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
  /**
   * The node whose edit fired an `event` trigger. Captured into the run's
   * `contextNodes` so the agent is grounded in the exact content that changed
   * (schedule/manual runs pass none — they have no triggering node).
   */
  triggerNode?: { scope: WorkspaceNodeScope; nodeId: string } | null
}): Promise<string> {
  const wf = params.workflow
  const runRef = db
    .collection(workflowRunsPath(params.teamId, wf.workspaceId))
    .doc()
  // Compose the single instruction the agent runs from instructions + the
  // optional supplementary prompt. Snapshotted so the run is self-contained.
  const prompt = wf.additionalPrompt
    ? `${wf.instructions}\n\n${wf.additionalPrompt}`
    : wf.instructions
  // Ground the run in the node that triggered it. An event run otherwise
  // carries NO pointer to the changed node — the agent gets only the static
  // instructions and can't tell which document to act on (it asks the caller
  // to "attach the file"). Prepend the trigger node so the cap never drops it,
  // dedupe it against the workflow's configured context nodes, and clamp to
  // CONTEXT_NODE_MAX.
  const configuredNodes = wf.contextNodes ?? []
  const trig = params.triggerNode
  const contextNodes = trig
    ? [
        trig,
        ...configuredNodes.filter(
          (n) => !(n.scope === trig.scope && n.nodeId === trig.nodeId)
        ),
      ].slice(0, CONTEXT_NODE_MAX)
    : configuredNodes
  await runRef.set({
    workflowId: params.workflowId,
    agentId: wf.agentId,
    workspaceId: wf.workspaceId,
    presetKey: wf.presetKey ?? null,
    prompt,
    contextNodes,
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
  teamId: string,
  draft: WorkflowDraft,
  uid: string,
  nowMs: number,
  presetKey: string | null = null
) {
  const enabled = draft.enabled ?? true
  return {
    // Denormalized for collection-group reads (see WorkflowDoc.teamId).
    teamId,
    // Provenance: a non-null presetKey marks a materialized catalog preset;
    // null is a hand-authored custom workflow.
    presetKey,
    name: draft.name,
    description: draft.description ?? "",
    avatarSeed: draft.avatarSeed ?? "",
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
    await assertWorkflowSlotAvailable(teamId)

    const ref = db
      .collection(workflowsPath(teamId, parsed.data.workspaceId))
      .doc()
    await ref.set(
      buildWorkflowDocData(teamId, parsed.data, auth.uid, Date.now())
    )
    return { workflowId: ref.id }
  }
)

export const updateTeamWorkflow = onCall<{
  teamId: string
  workspaceId: string
  workflowId: string
  patch: unknown
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, workflowId, patch } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
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

  const ref = db.doc(`${workflowsPath(teamId, workspaceId)}/${workflowId}`)
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
  workspaceId: string
  workflowId: string
  enabled: boolean
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, workflowId, enabled } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "enabled must be a boolean.")
  }
  await assertAdminRole(teamId, auth.uid)

  const ref = db.doc(`${workflowsPath(teamId, workspaceId)}/${workflowId}`)
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
  workspaceId: string
  workflowId: string
  archived: boolean
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, workflowId, archived } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const ref = db.doc(`${workflowsPath(teamId, workspaceId)}/${workflowId}`)
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
  workspaceId: string
  workflowId: string
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, workflowId } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)
  await db.doc(`${workflowsPath(teamId, workspaceId)}/${workflowId}`).delete()
  return { ok: true }
})

/** Fire a workflow by hand (also the easiest way to test the engine). */
export const runTeamWorkflowNow = onCall<{
  teamId: string
  workspaceId: string
  workflowId: string
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, workflowId } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
  }
  if (typeof workflowId !== "string" || !workflowId) {
    throw new HttpsError("invalid-argument", "workflowId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const snap = await db
    .doc(`${workflowsPath(teamId, workspaceId)}/${workflowId}`)
    .get()
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
  workspaceId: string
  runId: string
  decision: "approve" | "reject"
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, runId, decision } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
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

  const runRef = db.doc(`${workflowRunsPath(teamId, workspaceId)}/${runId}`)
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
    // Transactional compare-and-set: only the caller that observes
    // `awaiting_review` *inside* the transaction wins, so a double-reject (or
    // an approve racing a reject) can't both fire.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef)
      if (!snap.exists) throw new HttpsError("not-found", "Run not found.")
      if ((snap.data() as { status?: string }).status !== "awaiting_review") {
        throw new HttpsError(
          "failed-precondition",
          "This run isn't awaiting review."
        )
      }
      tx.update(runRef, {
        status: "cancelled" satisfies RunStatus,
        reviewedByUid: auth.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        finishedAt: FieldValue.serverTimestamp(),
      })
    })
    return { ok: true, status: "cancelled" }
  }

  // Approve — replay each staged proposal through the SAME commit core the
  // live tools use, so an approved edit is identical to an immediate one.
  const agentId = run.agentId ?? ""
  // Built-ins have no `agents/{id}` doc — resolve their display name from the
  // static registry; custom agents read it from their Firestore doc.
  const agentName = await resolveAgentName(teamId, agentId)
  const resolved: ResolvedNodeContext = {
    teamId,
    workspaceId,
    agentId,
    agentName,
    actorUid: auth.uid, // the approving admin's authority backs the write
  }

  // Replay is NOT idempotent on its own (a create makes a new node, an update
  // bumps the relay `seq`), so a double-approve — double-click, retried
  // callable, or two admins — would double-apply. Guard with the same once-only
  // lock the worker uses: of N concurrent calls only one runs the body; the
  // rest no-op. Each proposed change is additionally stamped `applied` as it
  // commits, so a retry after a mid-replay crash skips the already-committed
  // ones (the lock can expire on its stale-processing TTL; the stamp is the
  // durable per-change guard).
  const approveKey = makeEventIdempotencyKey(
    "reviewTeamWorkflowRun.approve",
    runId
  )
  let finalStatus: RunStatus | null = null
  const { executed } = await runIdempotentEvent(
    { key: approveKey },
    async () => {
      // Re-read inside the locked section: closes an approve-racing-reject
      // window where the run was cancelled between the precondition read above
      // and acquiring the lock.
      const fresh = await runRef.get()
      const runData = fresh.exists
        ? (fresh.data() as { status?: string; changes?: unknown[] })
        : null
      if (!runData || runData.status !== "awaiting_review") {
        return
      }

      const proposed = await runRef
        .collection("proposedChanges")
        .orderBy("index")
        .get()

      // The run doc carries a lightweight `changes` summary array, parallel to
      // the proposedChanges subcollection (same order + `index`). Stamp each
      // entry with its apply outcome so the timeline shows which change failed.
      const summaries: Record<string, unknown>[] = Array.isArray(
        runData.changes
      )
        ? (runData.changes as Record<string, unknown>[]).map((c) => ({ ...c }))
        : []
      const stampSummary = (
        idx: number | null,
        ok: boolean,
        applyError: string | null
      ) => {
        if (idx !== null && summaries[idx]) {
          summaries[idx] = { ...summaries[idx], applied: ok, applyError }
        }
      }

      let failures = 0
      let successes = 0
      for (const changeDoc of proposed.docs) {
        const change = changeDoc.data() as CapturedNodeChange & {
          applied?: boolean
          index?: number
        }
        const idx = typeof change.index === "number" ? change.index : null
        // Crash-retry idempotency: a change already committed by a prior
        // partial run is skipped, not re-applied.
        if (change.applied === true) {
          successes++
          stampSummary(idx, true, null)
          continue
        }
        const res = await applyProposedChange(resolved, change).catch(
          (error: unknown) => ({
            ok: false as const,
            message: (error as Error).message,
          })
        )
        if (res.ok) successes++
        else failures++
        const applyError = res.ok ? null : (res.message ?? "Unknown error")
        stampSummary(idx, res.ok, applyError)
        // Persist the outcome on the full-payload doc too (durable record;
        // also what the next retry reads to skip an already-applied change).
        await changeDoc.ref.set(
          {
            applied: res.ok,
            applyError,
            appliedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      }

      const nextStatus: RunStatus =
        failures === 0
          ? "applied"
          : successes > 0
            ? "partially_applied"
            : "error"
      finalStatus = nextStatus

      await runRef.update({
        status: nextStatus,
        reviewedByUid: auth.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        finishedAt: FieldValue.serverTimestamp(),
        ...(summaries.length > 0 ? { changes: summaries } : {}),
        error:
          failures > 0
            ? `${failures} of ${proposed.size} change(s) couldn't be applied — see each change for details.`
            : FieldValue.delete(),
      })
    }
  )

  if (!executed || finalStatus === null) {
    // Duplicate/concurrent decision — report the run's current status rather
    // than re-applying or throwing on a harmless double-submit.
    const current = (await runRef.get()).data() as { status?: RunStatus }
    return { ok: true, status: current?.status ?? "applied" }
  }
  return { ok: true, status: finalStatus }
})

/**
 * Permanently remove a run from history. Admin-gated. Uses `recursiveDelete` so
 * the run's `proposedChanges` subcollection (present on require_review runs) is
 * cleared alongside the run doc — a plain delete would orphan it. Deleting a run
 * is history cleanup only; it does not cancel an in-flight execution.
 */
export const deleteTeamWorkflowRun = onCall<{
  teamId: string
  workspaceId: string
  runId: string
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, workspaceId, runId } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpsError("invalid-argument", "workspaceId is required.")
  }
  if (typeof runId !== "string" || !runId) {
    throw new HttpsError("invalid-argument", "runId is required.")
  }
  await assertAdminRole(teamId, auth.uid)

  const runRef = db.doc(`${workflowRunsPath(teamId, workspaceId)}/${runId}`)
  const snap = await runRef.get()
  if (!snap.exists) throw new HttpsError("not-found", "Run not found.")
  await db.recursiveDelete(runRef)
  return { ok: true }
})

/**
 * Materialize a predefined catalog preset as a `presetKey != null` workflow —
 * validated + persisted through the exact same path as a custom workflow.
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
  await assertAgentRunnable(teamId, agentId)

  const parsed = workflowDraftSchema.safeParse({
    name: preset.name,
    description: preset.description,
    avatarSeed: preset.avatarSeed,
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
  await assertWorkflowSlotAvailable(teamId)

  const ref = db.collection(workflowsPath(teamId, workspaceId)).doc()
  await ref.set(
    buildWorkflowDocData(teamId, parsed.data, auth.uid, Date.now(), preset.key)
  )
  return { workflowId: ref.id }
})

/**
 * Make a predefined preset available to the team (the Integrations toggle), or
 * remove it. Availability is the team tier of the two-tier model; per-workspace
 * deployment (enableTeamWorkflowPreset) is the workspace tier.
 *
 *   available=true  → upsert teams/{teamId}/availableWorkflows/{presetKey}
 *   available=false → delete it AND archive every live deployment of that
 *                     preset across the team, so an unavailable preset can't
 *                     keep firing in any workspace.
 *
 * NOTE: deployment is NOT gated on availability server-side — the client only
 * surfaces available presets to deploy, and treats a preset with any live
 * deployment as implicitly available (the grandfather union in
 * teamWorkflowsStore), so no backfill of this collection is needed.
 */
export const setTeamWorkflowAvailability = onCall<{
  teamId: string
  presetKey: string
  available: boolean
}>({ ...CALLABLE_OPTS, enforceAppCheck: true }, async (request) => {
  const auth = requireVerifiedAuth(request.auth)
  const { teamId, presetKey, available } = request.data ?? {}
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  if (typeof presetKey !== "string" || !presetKey) {
    throw new HttpsError("invalid-argument", "presetKey is required.")
  }
  if (typeof available !== "boolean") {
    throw new HttpsError("invalid-argument", "available must be a boolean.")
  }
  if (!getWorkflowPreset(presetKey)) {
    throw new HttpsError("invalid-argument", "Unknown preset.")
  }
  await assertAdminRole(teamId, auth.uid)

  const ref = db.doc(`${availableWorkflowsPath(teamId)}/${presetKey}`)
  if (available) {
    await ref.set({
      presetKey,
      addedByUid: auth.uid,
      addedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true, archived: 0 }
  }

  // Removing availability also archives every live deployment of this preset
  // across the team (all workspaces) so the scheduler + event triggers stop
  // firing it. Workflows live under each workspace now, so query team-wide via
  // the collection group on the denormalized `teamId`; presetKey + archivedAt
  // are filtered in code to avoid extra composite indexes (deployments per team
  // are bounded by the slot cap). Mirrors archiveTeamWorkflow's write.
  const deployments = await db
    .collectionGroup("workflows")
    .where("teamId", "==", teamId)
    .get()
  const batch = db.batch()
  batch.delete(ref)
  let archived = 0
  for (const doc of deployments.docs) {
    const data = doc.data()
    if (data.presetKey !== presetKey || data.archivedAt) continue
    batch.update(doc.ref, {
      archivedAt: FieldValue.serverTimestamp(),
      enabled: false,
      updatedAt: FieldValue.serverTimestamp(),
      nextRunAt: FieldValue.delete(),
    })
    archived += 1
  }
  await batch.commit()
  return { ok: true, archived }
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
      const wf = doc.data() as WorkflowDoc
      const teamId = wf.teamId
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
function makeWorkflowTrigger(scope: WorkspaceNodeScope) {
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

      // Workflows for this workspace live in its own subcollection now.
      const candidates = await db
        .collection(workflowsPath(teamId, workspaceId))
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
              doc.data().lastEventEnqueuedAt as Timestamp | undefined
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
              // Attach the node that changed so the agent can scan its content.
              triggerNode: { scope, nodeId },
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

// ─── Completion notifications ─────────────────────────────────────────────────

/**
 * Resolve an agent's display name. Built-ins (`_`-prefixed) have no
 * `agents/{id}` doc — their name lives in the static registry; custom agents
 * read it from their Firestore doc. Shared by the run-completion notification
 * and the review-replay path.
 */
async function resolveAgentName(
  teamId: string,
  agentId: string
): Promise<string> {
  if (!agentId) return "Agent"
  if (isBuiltInAgentId(agentId)) {
    return BUILT_IN_AGENTS_BY_ID[agentId]?.name ?? "Agent"
  }
  const agentSnap = await db.doc(`${integrationsPath(teamId)}/${agentId}`).get()
  return (agentSnap.data()?.name as string | undefined) ?? "Agent"
}

/**
 * The run outcomes worth telling a human about, with the label + email accent
 * colour shown in the notification. Routine `success` and `skipped` are
 * intentionally absent — notifying on every scheduled success would flood
 * inboxes. `applied`/`partially_applied`/`cancelled` happen at human review
 * time (handled on screen), so they're not here either.
 */
const RUN_NOTIFY: Partial<
  Record<
    RunStatus,
    { label: string; kind: "review" | "error" | "blocked"; color: string }
  >
> = {
  awaiting_review: {
    label: "Awaiting review",
    kind: "review",
    color: "#7c3aed",
  },
  error: { label: "Error", kind: "error", color: "#dc2626" },
  blocked: { label: "Blocked", kind: "blocked", color: "#d97706" },
}

/** Human label for a run's trigger (mirrors the client `runTriggerOptions`). */
function runTriggerLabel(triggeredBy: unknown): string {
  const type =
    triggeredBy && typeof triggeredBy === "object"
      ? (triggeredBy as { type?: unknown }).type
      : undefined
  if (type === "schedule") return "Schedule"
  if (type === "event") return "Content change"
  if (type === "manual") return "Manual"
  return "—"
}

/**
 * Notify team admins/owners when a run finishes in a noteworthy state
 * (awaiting review, error, blocked) — a no-op for every other status. Reuses
 * the shared notifier (`sendNotificationToMany`), so per-user channel/category
 * preferences and the `workflow.run` email template apply automatically.
 *
 * Best-effort: any failure is logged and swallowed so it can never throw out of
 * the worker. A thrown error there could trigger a Cloud Functions retry, which
 * would re-run the LLM turn and double-spend.
 */
async function notifyRunCompletion(params: {
  teamId: string
  workspaceId: string
  runId: string
  workflow: WorkflowDoc | undefined
  run: FirebaseFirestore.DocumentData
  status: RunStatus
  extra: Record<string, unknown>
}): Promise<void> {
  const meta = RUN_NOTIFY[params.status]
  if (!meta) return // only the noteworthy statuses notify

  try {
    const { teamId, workspaceId, workflow, run, extra } = params

    const recipients = await getTeamAdminsAndOwners(teamId)
    if (recipients.length === 0) return

    const workflowName = workflow?.name || "Workflow"
    const agentName = await resolveAgentName(
      teamId,
      typeof run.agentId === "string" ? run.agentId : ""
    )

    // Workspace name is decorative — never let it block the notification.
    let workspaceName = ""
    try {
      const wsSnap = await db
        .doc(`teams/${teamId}/workspaces/${workspaceId}`)
        .get()
      workspaceName = (wsSnap.data()?.name as string | undefined) ?? ""
    } catch {
      workspaceName = ""
    }

    // The run's lightweight change summaries (parallel to proposedChanges).
    const changesRaw = Array.isArray(extra.changes)
      ? (extra.changes as Record<string, unknown>[])
      : []
    const changeCount = changesRaw.length
    const changeList = changesRaw.slice(0, 5).map((c) => ({
      op: typeof c.op === "string" ? c.op : "change",
      summary: typeof c.summary === "string" ? c.summary : "",
    }))

    const usage = (extra.usage ?? run.usage ?? null) as {
      inputTokens?: number
      outputTokens?: number
      estimatedCostUsd?: number
    } | null
    const tokenTotal = usage
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : 0
    const costUsd =
      usage && typeof usage.estimatedCostUsd === "number"
        ? `$${usage.estimatedCostUsd.toFixed(2)}`
        : ""

    const replyPreview =
      typeof extra.replyPreview === "string" ? extra.replyPreview : ""
    const errorMessage = typeof extra.error === "string" ? extra.error : ""
    const triggerLabel = runTriggerLabel(run.triggeredBy)

    const title = `${workflowName} — ${meta.label}`
    let description: string
    if (meta.kind === "review") {
      const noun = changeCount === 1 ? "change" : "changes"
      description = `${changeCount} ${noun} staged for review · via ${triggerLabel}`
    } else if (meta.kind === "error") {
      description = errorMessage ? `Run failed: ${errorMessage}` : "Run failed."
    } else {
      description = errorMessage
        ? `Run blocked: ${errorMessage}`
        : "Run blocked (over budget or not entitled)."
    }
    description = description.slice(0, 160)

    const workflowId =
      typeof run.workflowId === "string" ? run.workflowId : params.runId

    const templateData = {
      workflowName,
      statusLabel: meta.label,
      statusColor: meta.color,
      isReview: meta.kind === "review",
      isError: meta.kind === "error",
      isBlocked: meta.kind === "blocked",
      triggerLabel,
      agentName,
      workspaceName,
      changeCount,
      changeList,
      replyPreview,
      errorMessage,
      tokens: tokenTotal ? tokenTotal.toLocaleString("en-US") : "",
      costUsd,
    }

    await sendNotificationToMany(
      recipients.map((m) => ({
        userId: m.userId,
        userEmail: m.email,
        type: "workflow.run" as const,
        title,
        description,
        url: "/runs",
        source: { entityType: "workflow", entityId: workflowId },
        emailData: { templateData },
      }))
    )
  } catch (err) {
    logger.warn("[workflows] run-completion notification failed", {
      teamId: params.teamId,
      runId: params.runId,
      status: params.status,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

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
    document: "teams/{teamId}/workspaces/{workspaceId}/workflowRuns/{runId}",
    ...GENKIT_OPTS,
    // postmarkApiKey: the worker emails admins on noteworthy run outcomes
    // (awaiting_review / error / blocked) via notifyRunCompletion.
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey, postmarkApiKey],
  },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const run = snap.data()
    if (run.status !== "queued") return // only fresh runs

    const teamId = event.params.teamId as string
    const workspaceId = event.params.workspaceId as string

    await runIdempotentEvent(
      { key: makeEventIdempotencyKey("executeWorkflowRun", event.id) },
      async () => {
        const workflowRef = db.doc(
          `${workflowsPath(teamId, workspaceId)}/${run.workflowId}`
        )
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

          // Best-effort: notify admins/owners on noteworthy outcomes (awaiting
          // review / error / blocked). A no-op for routine success; guarded
          // internally so it can never throw and trigger a worker retry. `wf`
          // is resolved above before any finish() call, so the closure is safe.
          await notifyRunCompletion({
            teamId,
            workspaceId,
            runId: snap.ref.id,
            workflow: wf,
            run,
            status,
            extra,
          })
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
          (run.targetScope as WorkspaceNodeScope | null | undefined) ?? null

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
