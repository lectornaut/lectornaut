/**
 * Team Workflows store — the team's automations (server-run agents).
 *
 * Storage model (two-tier — team availability → per-workspace deployment):
 *   - Availability: teams/{teamId}/availableWorkflows/{presetKey} — which
 *     predefined presets the team offers (the Integrations tier).
 *   - Workflows:   teams/{teamId}/workspaces/{workspaceId}/workflows/{id} — the
 *     per-workspace deployments (materialized, opt-in; trigger/run/schedule
 *     runtime). Provenance is `presetKey` (null = custom).
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
  updateTeamWorkflow as updateTeamWorkflowFn,
  type CreateWorkflowDraft,
  type UpdateWorkflowPatch,
  type WorkflowReviewDecision,
} from "@/composables/useFunctions"
import { firestore } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import type { IWorkflow, IWorkflowRun } from "@/types/domain"
import {
  useCollectionQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import {
  collection,
  collectionGroup,
  limit,
  orderBy,
  query,
  where,
  type FirestoreDataConverter,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref } from "vue"

/** Most recent run docs to subscribe to for the history view. */
const RECENT_RUNS_LIMIT = 50

// Workflow/run docs are written only server-side (admin SDK) and validated
// there, so the client converter trusts the shape and just injects the id +
// teamId read from the doc (denormalized — workflows are nested under a
// workspace now, so the path no longer yields the team). `avatarSeed` needs
// a runtime fallback: it shipped after the first workflows, so docs written
// before it exists have no value, and the row/editor call `.trim()` on it.
// Normalize here (mirroring teamAgentsStore) so `IWorkflow.avatarSeed` is
// always a string in practice, matching its schema type.
const workflowConverter: FirestoreDataConverter<IWorkflow> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) => {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      ...data,
      teamId: typeof data.teamId === "string" ? data.teamId : "",
      // `presetKey` (null = custom) is the workflow's provenance field.
      presetKey: typeof data.presetKey === "string" ? data.presetKey : null,
      avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    } as IWorkflow
  },
}

const workflowRunConverter: FirestoreDataConverter<IWorkflowRun> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) =>
    ({ id: snapshot.id, ...snapshot.data() }) as IWorkflowRun,
}

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
  const authStore = useAuthStore()
  const { currentTeamId, currentWorkspaceId } = storeToRefs(authStore)

  const isSaving = ref(false)

  // Workflows live under each workspace now; read the team's whole set via a
  // collectionGroup on the denormalized `teamId`, so the team-wide list,
  // grandfather union, and runs explorer keep working unchanged. The
  // per-workspace surfaces filter this via the `ws*` computeds below.
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
  const workflows = computed<IWorkflow[]>(() => workflowsQuery.data.value ?? [])
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
      (availableQuery.data.value ?? []).map((d) => d.presetKey)
    )
    for (const w of activeWorkflows.value) {
      if (w.presetKey) keys.add(w.presetKey)
    }
    return keys
  })

  const isLoading = computed<boolean>(() => workflowsQuery.isLoading.value)
  const loadError = computed<string | null>(
    () => workflowsQuery.error.value?.message ?? null
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
    await setTeamWorkflowEnabledFn({ teamId, workspaceId, workflowId, enabled })
  }

  const archive = async (
    workflowId: string,
    archived: boolean
  ): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    await archiveTeamWorkflowFn({ teamId, workspaceId, workflowId, archived })
  }

  const remove = async (workflowId: string): Promise<void> => {
    const teamId = requireTeam()
    const workspaceId = requireWorkflowWorkspaceId(workflowId)
    await deleteTeamWorkflowFn({ teamId, workspaceId, workflowId })
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

  /** Approve (apply staged edits) or reject a `require_review` run. */
  const reviewRun = async (
    runId: string,
    decision: WorkflowReviewDecision
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
    await deleteTeamWorkflowRunFn({ teamId, workspaceId, runId })
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
    archive,
    remove,
    runNow,
    reviewRun,
    removeRun,
    enablePreset,
    setAvailability,
  }
})
