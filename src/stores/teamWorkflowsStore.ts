/**
 * Team Workflows store — the team's automations (server-run agents).
 *
 * Storage model (two-tier — team availability → per-workspace deployment):
 *   - Availability: teams/{teamId}/availableWorkflows/{presetKey} — which
 *     predefined presets the team offers (the Integrations tier).
 *   - Workflows:   teams/{teamId}/workspaces/{workspaceId}/workflows/{id} — the
 *     per-workspace deployments (materialized, opt-in; trigger/run/schedule
 *     runtime). Provenance is `presetKey` (null = custom).
 *   - Opt-ins:     …/workflows/{id}/subscribers/{uid} — who a per-member
 *     workflow runs for. Each member reads only their own doc (admins read
 *     the list), so the member-readable workflow doc never says who opted in.
 *   - Run history: teams/{teamId}/workspaces/{workspaceId}/workflowRuns/{runId}
 *   - Read:  workflows + runs are read team-wide via a collectionGroup on the
 *     denormalized `teamId` (live subscription). Writes are callable-only
 *            (admin-gated server-side).
 *
 * Workflows are one of the three integration building blocks, but they are NOT
 * integration docs — they're unified with agents + tools only at the catalog +
 * the client registry facade (`useIntegrationsRegistry`), never in storage.
 *
 * Mirrors `teamAgentsStore`: reads flow through the shared TanStack-backed
 * `useCollectionQuery` cache (one live listener per team, torn down + rekeyed
 * on team switch), and mutations call the Cloud Functions in `useFunctions`.
 */

import { useConnectionStatus } from "@/composables/useConnectionStatus"
import {
  archiveTeamWorkflow as archiveTeamWorkflowFn,
  createTeamWorkflow as createTeamWorkflowFn,
  deleteTeamWorkflow as deleteTeamWorkflowFn,
  deleteTeamWorkflowRun as deleteTeamWorkflowRunFn,
  enableTeamWorkflowPreset as enableTeamWorkflowPresetFn,
  reviewTeamWorkflowRun as reviewTeamWorkflowRunFn,
  runTeamWorkflowNow as runTeamWorkflowNowFn,
  setTeamWorkflowAvailability as setTeamWorkflowAvailabilityFn,
  setTeamWorkflowEnabled as setTeamWorkflowEnabledFn,
  setTeamWorkflowSubscription as setTeamWorkflowSubscriptionFn,
  updateTeamWorkflow as updateTeamWorkflowFn,
  type CreateWorkflowDraft,
  type UpdateWorkflowPatch,
  type WorkflowReviewDecision,
} from "@/composables/useFunctions"
import { firestore } from "@/modules/firebase"
import { queryClient } from "@/modules/queryClient"
import type { workflowSubscriberSchema } from "@/schemas/domain"
import { useAuthStore } from "@/stores/authStore"
import type { IWorkflow, IWorkflowRun } from "@/types/domain"
import {
  holdOptimistic,
  useCollectionQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import {
  collection,
  collectionGroup,
  doc,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentReference,
  type FirestoreDataConverter,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref } from "vue"
import type { z } from "zod"

/** Most recent run docs to subscribe to for the history view. */
const RECENT_RUNS_LIMIT = 50

// Workflow/run docs are written only server-side (admin SDK) and validated
// there, so the client converter trusts the shape and just injects the id.
const workflowConverter: FirestoreDataConverter<IWorkflow> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) =>
    ({ id: snapshot.id, ...snapshot.data() }) as IWorkflow,
}

const workflowRunConverter: FirestoreDataConverter<IWorkflowRun> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) =>
    ({ id: snapshot.id, ...snapshot.data() }) as IWorkflowRun,
}

/** One member's opt-in to a per-member workflow ("Run for me"). */
export type IWorkflowSubscriber = z.infer<typeof workflowSubscriberSchema>

const workflowSubscriberConverter: FirestoreDataConverter<IWorkflowSubscriber> =
  {
    toFirestore: () => ({}),
    fromFirestore: (snapshot) =>
      ({ ...snapshot.data(), uid: snapshot.id }) as IWorkflowSubscriber,
  }

const workflowSubscribersPath = (wf: IWorkflow): string =>
  `teams/${wf.teamId}/workspaces/${wf.workspaceId}/workflows/${wf.id}/subscribers`

/** A member's own opt-in doc (rules: readable by that member + admins). */
export const workflowSubscriberRef = (
  wf: IWorkflow,
  uid: string
): DocumentReference<IWorkflowSubscriber> =>
  doc(firestore, workflowSubscribersPath(wf), uid).withConverter(
    workflowSubscriberConverter
  )

/** Every opt-in to a workflow — admin-only by the rules. */
export const workflowSubscribersSource = (
  wf: IWorkflow
): CollectionQuerySource => ({
  query: collection(firestore, workflowSubscribersPath(wf)).withConverter(
    workflowSubscriberConverter
  ),
  path: workflowSubscribersPath(wf),
})

/**
 * Team availability docs (`teams/{teamId}/availableWorkflows/{presetKey}`) —
 * the team tier of the two-tier model. The doc id IS the presetKey; the body
 * (addedByUid/addedAt) is provenance we don't need on the client.
 */
interface AvailableWorkflow {
  presetKey: string
}
const availableWorkflowConverter: FirestoreDataConverter<AvailableWorkflow> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) => ({ presetKey: snapshot.id }),
}

export const useTeamWorkflowsStore = defineStore("teamWorkflows", () => {
  const connectionStatus = useConnectionStatus()
  const authStore = useAuthStore()
  const { currentTeamId, currentWorkspaceId } = storeToRefs(authStore)

  const isSaving = ref(false)

  // Workflows live under each workspace now; read the team's whole set via a
  // collectionGroup on the denormalized `teamId` (the team-wide list and runs
  // explorer). The per-workspace surfaces filter it via the `ws*` computeds.
  const workflowsQuery = useCollectionQuery<IWorkflow>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      return {
        query: query(
          collectionGroup(firestore, "workflows").withConverter(
            workflowConverter
          ),
          where("teamId", "==", teamId)
        ),
        path: `collectionGroup:workflows:${teamId}`,
      }
    }
  )

  // Runs are pure per-workspace data (like nodes + bot sessions): read only the
  // CURRENT workspace's run history, directly from its subcollection. No team
  // rollup — within a workspace you see that workspace's runs, full stop.
  const runsQuery = useCollectionQuery<IWorkflowRun>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      const workspaceId = currentWorkspaceId.value
      if (!teamId || !workspaceId) return null
      const path = `teams/${teamId}/workspaces/${workspaceId}/workflowRuns`
      return {
        query: query(
          collection(firestore, path).withConverter(workflowRunConverter),
          orderBy("queuedAt", "desc"),
          limit(RECENT_RUNS_LIMIT)
        ),
        path,
      }
    }
  )

  // Team availability (Integrations tier): which presets the team offers,
  // independent of any per-workspace deployment.
  const availableQuery = useCollectionQuery<AvailableWorkflow>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/availableWorkflows`
      return {
        query: collection(firestore, path).withConverter(
          availableWorkflowConverter
        ),
        path,
      }
    }
  )

  const isArchived = (w: IWorkflow) => !!w.archivedAt

  /** Every workflow for the active team (active + archived). */
  const workflows = computed<IWorkflow[]>(() =>
    (workflowsQuery.data.value ?? [])
      .filter(
        (w) =>
          !w.connectionProvider ||
          (!!w.presetKey && connectionStatus.installed("workflow", w.presetKey))
      )
      .map((w) =>
        w.connectionProvider &&
        w.presetKey &&
        (!connectionStatus.installed("workflow", w.presetKey) ||
          connectionStatus.disabled("workflow", w.presetKey))
          ? { ...w, enabled: false }
          : w
      )
  )
  const activeWorkflows = computed<IWorkflow[]>(() =>
    workflows.value.filter((w) => !isArchived(w))
  )
  const archivedWorkflows = computed<IWorkflow[]>(() =>
    workflows.value.filter(isArchived)
  )
  const recentRuns = computed<IWorkflowRun[]>(() => runsQuery.data.value ?? [])

  /** Runs that captured a changeset and are waiting on an admin decision. */
  const awaitingReviewRuns = computed<IWorkflowRun[]>(() =>
    recentRuns.value.filter((r) => r.status === "awaiting_review")
  )

  // ── Workspace-scoped views (the per-workspace surfaces) ──────────────────
  // A workflow is pinned to one workspace by its immutable `workspaceId`. The
  // Settings/Workflows surfaces show only the CURRENT workspace's deployments;
  // the team-wide `activeWorkflows`/`recentRuns` above still back the (Phase 1)
  // team-wide Runs explorer until runs relocate under the workspace.
  const inCurrentWorkspace = (w: IWorkflow): boolean =>
    w.workspaceId === currentWorkspaceId.value
  const wsActiveWorkflows = computed<IWorkflow[]>(() =>
    activeWorkflows.value.filter(inCurrentWorkspace)
  )
  const wsArchivedWorkflows = computed<IWorkflow[]>(() =>
    archivedWorkflows.value.filter(inCurrentWorkspace)
  )
  /** presetKeys deployed (active) in the CURRENT workspace — drives per-workspace toggles. */
  const wsDeployedPresetKeys = computed<Set<string>>(
    () =>
      new Set(
        wsActiveWorkflows.value
          .map((w) => w.presetKey)
          .filter((k): k is string => !!k)
      )
  )

  /**
   * presetKeys the team has made available (Integrations tier): the union of
   * the explicit availability docs and any preset with a live deployment in ANY
   * workspace. The second term means a deployed preset always counts as
   * available — covering presets enabled before the availability collection
   * existed — so no availability backfill is ever required.
   */
  const availablePresetKeys = computed<Set<string>>(() => {
    const keys = new Set<string>(
      (availableQuery.data.value ?? [])
        .map((d) => d.presetKey)
        .filter(
          (key) =>
            !connectionStatus.providerFor("workflow", key) ||
            connectionStatus.installed("workflow", key)
        )
    )
    for (const w of activeWorkflows.value) {
      if (w.presetKey && !w.connectionProvider) keys.add(w.presetKey)
    }
    return keys
  })

  const isLoading = computed<boolean>(
    () =>
      workflowsQuery.isLoading.value ||
      availableQuery.isLoading.value ||
      connectionStatus.isLoading.value
  )
  const loadError = computed<string | null>(
    () =>
      workflowsQuery.error.value?.message ??
      availableQuery.error.value?.message ??
      connectionStatus.error.value?.message ??
      null
  )

  const getById = (id: string): IWorkflow | null =>
    workflows.value.find((w) => w.id === id) ?? null

  /** Recent runs for a single workflow (already sorted newest-first). */
  const runsForWorkflow = (workflowId: string): IWorkflowRun[] =>
    recentRuns.value.filter((r) => r.workflowId === workflowId)

  // ── Mutations (callable-backed, admin-gated server-side) ─────────────────

  const requireTeam = (): string => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("No active team.")
    return teamId
  }

  // Workflows are nested under their workspace, so the mutation callables need
  // the workspaceId — recover it from the (team-wide) loaded doc by id.
  const requireWorkflowWorkspaceId = (workflowId: string): string => {
    const workspaceId = getById(workflowId)?.workspaceId
    if (!workspaceId) throw new Error("Workflow not found.")
    return workspaceId
  }

  // Optimistic cache writes for the lifecycle toggles: patch the live TanStack
  // cache (the team-wide workflows collectionGroup, or a workspace's runs list),
  // hold the key against the listener, run the callable, then reconcile on the
  // held snapshot's release — or roll back on failure. Mirrors the integrations
  // store: the row reflects the change instantly, no wait for the round-trip +
  // snapshot echo. (create/update/enablePreset keep their `isSaving` spinner —
  // they're form-dialog saves, not toggles.)
  const workflowsCacheKey = (teamId: string): FirestoreQueryKey =>
    queryKeys.list(`collectionGroup:workflows:${teamId}`)
  const runsCacheKey = (
    teamId: string,
    workspaceId: string
  ): FirestoreQueryKey =>
    queryKeys.list(`teams/${teamId}/workspaces/${workspaceId}/workflowRuns`)

  const runCacheWrite = async <T>(
    key: FirestoreQueryKey,
    applyOptimistic: (current: T | undefined) => T,
    run: () => Promise<unknown>
  ): Promise<void> => {
    const previous = queryClient.getQueryData<T>(key)
    const release = holdOptimistic(key)
    queryClient.setQueryData<T>(key, applyOptimistic(previous))
    try {
      await run()
    } catch (error) {
      queryClient.setQueryData(key, previous)
      throw error
    } finally {
      setTimeout(() => release(), 120)
    }
  }

  const create = async (draft: CreateWorkflowDraft): Promise<string> => {
    const teamId = requireTeam()
    if (isSaving.value)
      throw new Error("A workflow save is already in progress.")
    isSaving.value = true
    try {
      const { data } = await createTeamWorkflowFn({ teamId, draft })
      return data.workflowId
    } finally {
      isSaving.value = false
    }
  }

  const update = async (
    workflowId: string,
    patch: UpdateWorkflowPatch
  ): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    if (isSaving.value)
      throw new Error("A workflow save is already in progress.")
    isSaving.value = true
    try {
      await updateTeamWorkflowFn({ teamId, workspaceId, workflowId, patch })
    } finally {
      isSaving.value = false
    }
  }

  const setEnabled = async (
    workflowId: string,
    enabled: boolean
  ): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    await runCacheWrite<IWorkflow[]>(
      workflowsCacheKey(teamId),
      (current = []) =>
        current.map((w) => (w.id === workflowId ? { ...w, enabled } : w)),
      () =>
        setTeamWorkflowEnabledFn({ teamId, workspaceId, workflowId, enabled })
    )
  }

  /**
   * Write the current user's own opt-in: patch their cached subscriber doc
   * (what `useWorkflowSubscription` renders), then call the server.
   */
  const writeMySubscription = async (
    workflowId: string,
    applyOptimistic: (
      current: IWorkflowSubscriber | null | undefined,
      wf: IWorkflow,
      uid: string
    ) => IWorkflowSubscriber | null,
    change: { subscribed?: boolean; notify?: boolean }
  ): Promise<void> => {
    const teamId = requireTeam()
    const wf = getById(workflowId)
    const uid = authStore.currentUser?.uid
    if (!wf || !uid) throw new Error("Workflow not found.")
    await runCacheWrite<IWorkflowSubscriber | null>(
      queryKeys.doc(workflowSubscriberRef(wf, uid).path),
      (current) => applyOptimistic(current, wf, uid),
      () =>
        setTeamWorkflowSubscriptionFn({
          teamId,
          workspaceId: wf.workspaceId,
          workflowId,
          ...change,
        })
    )
  }

  /** "Run for me": opt the current user in or out of a per-member workflow. */
  const setSubscribed = (workflowId: string, subscribed: boolean) =>
    writeMySubscription(
      workflowId,
      (current, wf, uid) =>
        subscribed
          ? {
              ...current,
              uid,
              approvedRev: wf.consentRev,
              paused: null,
            }
          : null,
      { subscribed }
    )

  /** "Notify me": whether the current user hears about their own runs. */
  const setNotify = (workflowId: string, notify: boolean) =>
    writeMySubscription(
      workflowId,
      (current) => (current ? { ...current, notify } : null),
      { notify }
    )

  const archive = async (
    workflowId: string,
    archived: boolean
  ): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    await runCacheWrite<IWorkflow[]>(
      workflowsCacheKey(teamId),
      (current = []) =>
        current.map((w) =>
          w.id === workflowId
            ? { ...w, archivedAt: archived ? Timestamp.now() : null }
            : w
        ),
      () => archiveTeamWorkflowFn({ teamId, workspaceId, workflowId, archived })
    )
  }

  const remove = async (workflowId: string): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    await runCacheWrite<IWorkflow[]>(
      workflowsCacheKey(teamId),
      (current = []) => current.filter((w) => w.id !== workflowId),
      () => deleteTeamWorkflowFn({ teamId, workspaceId, workflowId })
    )
  }

  const runNow = async (workflowId: string): Promise<string> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    const { data } = await runTeamWorkflowNowFn({
      teamId,
      workspaceId,
      workflowId,
    })
    return data.runId
  }

  /**
   * Whether a run's staged changes came from instructions the workflow no
   * longer has (same composition as the server's `composePrompt`). The server
   * refuses to approve such a run unless the admin acknowledges it.
   */
  const isRunPromptStale = (runId: string): boolean => {
    const run = recentRuns.value.find((r) => r.id === runId)
    const wf = run ? getById(run.workflowId) : null
    if (!run?.prompt || !wf) return false
    const live = wf.additionalPrompt
      ? `${wf.instructions}\n\n${wf.additionalPrompt}`
      : wf.instructions
    return live !== run.prompt
  }

  /** Approve (apply staged edits) or reject a `require_review` run. */
  const reviewRun = async (
    runId: string,
    decision: WorkflowReviewDecision,
    acknowledgeStale = false
  ): Promise<string> => {
    const teamId = requireTeam()
    const workspaceId = recentRuns.value.find(
      (r) => r.id === runId
    )?.workspaceId
    if (!workspaceId) throw new Error("Run not found.")
    const { data } = await reviewTeamWorkflowRunFn({
      teamId,
      workspaceId,
      runId,
      decision,
      ...(acknowledgeStale ? { acknowledgeStale } : {}),
    })
    return data.status
  }

  /** Permanently remove a run from history. */
  const removeRun = async (runId: string): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = recentRuns.value.find(
      (r) => r.id === runId
    )?.workspaceId
    if (!workspaceId) throw new Error("Run not found.")
    await runCacheWrite<IWorkflowRun[]>(
      runsCacheKey(teamId, workspaceId),
      (current = []) => current.filter((r) => r.id !== runId),
      () => deleteTeamWorkflowRunFn({ teamId, workspaceId, runId })
    )
  }

  /** Materialize a predefined catalog preset as a runnable workflow. */
  const enablePreset = async (
    presetKey: string,
    binding: { workspaceId: string; agentId: string }
  ): Promise<string> => {
    const teamId = requireTeam()
    if (isSaving.value)
      throw new Error("A workflow save is already in progress.")
    isSaving.value = true
    try {
      const { data } = await enableTeamWorkflowPresetFn({
        teamId,
        presetKey,
        ...binding,
      })
      return data.workflowId
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Make a preset available to the team, or remove it (the Integrations
   * toggle). Team-tier availability — workspace-agnostic. Removing also
   * archives every live deployment of the preset across the team (handled
   * server-side). Per-workspace deployment is `enablePreset` (above), called
   * from a workspace's Workflows settings.
   */
  const setAvailability = async (
    presetKey: string,
    available: boolean
  ): Promise<void> => {
    const teamId = requireTeam()
    await setTeamWorkflowAvailabilityFn({ teamId, presetKey, available })
  }

  return {
    workflows,
    activeWorkflows,
    archivedWorkflows,
    wsActiveWorkflows,
    wsArchivedWorkflows,
    wsDeployedPresetKeys,
    availablePresetKeys,
    recentRuns,
    awaitingReviewRuns,
    isLoading,
    isSaving,
    loadError,
    getById,
    runsForWorkflow,
    create,
    update,
    setEnabled,
    setSubscribed,
    setNotify,
    archive,
    remove,
    runNow,
    isRunPromptStale,
    reviewRun,
    removeRun,
    enablePreset,
    setAvailability,
  }
})
