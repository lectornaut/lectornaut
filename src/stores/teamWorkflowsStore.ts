/**
 * Team Workflows store — the team's automations (server-run agents).
 *
 * Storage model:
 *   - Workflows:  teams/{teamId}/workflows/{workflowId}
 *   - Run history: teams/{teamId}/workflowRuns/{runId}
 *   - Read:  live Firestore subscription (admin-only per the rules). Writes
 *            are callable-only (admin-gated server-side).
 *
 * Mirrors `teamAgentsStore`: reads flow through the shared TanStack-backed
 * `useCollectionQuery` cache (one live listener per team, torn down + rekeyed
 * on team switch), and mutations call the Cloud Functions in `useFunctions`.
 */

import {
  archiveTeamWorkflow as archiveTeamWorkflowFn,
  createTeamWorkflow as createTeamWorkflowFn,
  deleteTeamWorkflow as deleteTeamWorkflowFn,
  enableTeamWorkflowPreset as enableTeamWorkflowPresetFn,
  reviewTeamWorkflowRun as reviewTeamWorkflowRunFn,
  runTeamWorkflowNow as runTeamWorkflowNowFn,
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
  limit,
  orderBy,
  query,
  type FirestoreDataConverter,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref } from "vue"

/** Most recent run docs to subscribe to for the history view. */
const RECENT_RUNS_LIMIT = 50

// Workflow/run docs are written only server-side (admin SDK) and validated
// there, so the client converter trusts the shape and just injects the id +
// teamId recovered from the doc path.
const workflowConverter: FirestoreDataConverter<IWorkflow> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) =>
    ({
      id: snapshot.id,
      teamId: snapshot.ref.parent.parent?.id ?? "",
      ...snapshot.data(),
    }) as IWorkflow,
}

const workflowRunConverter: FirestoreDataConverter<IWorkflowRun> = {
  toFirestore: () => ({}),
  fromFirestore: (snapshot) =>
    ({ id: snapshot.id, ...snapshot.data() }) as IWorkflowRun,
}

export const useTeamWorkflowsStore = defineStore("teamWorkflows", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const isSaving = ref(false)

  const workflowsQuery = useCollectionQuery<IWorkflow>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/workflows`
      return {
        query: collection(firestore, path).withConverter(workflowConverter),
        path,
      }
    }
  )

  const runsQuery = useCollectionQuery<IWorkflowRun>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/workflowRuns`
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

  /** presetKeys already materialized as (active) workflows — drives catalog toggles. */
  const enabledPresetKeys = computed<Set<string>>(
    () =>
      new Set(
        activeWorkflows.value
          .map((w) => w.presetKey)
          .filter((k): k is string => !!k)
      )
  )

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
    if (isSaving.value)
      throw new Error("A workflow save is already in progress.")
    isSaving.value = true
    try {
      await updateTeamWorkflowFn({ teamId, workflowId, patch })
    } finally {
      isSaving.value = false
    }
  }

  const setEnabled = async (
    workflowId: string,
    enabled: boolean
  ): Promise<void> => {
    const teamId = requireTeam()
    await setTeamWorkflowEnabledFn({ teamId, workflowId, enabled })
  }

  const archive = async (
    workflowId: string,
    archived: boolean
  ): Promise<void> => {
    const teamId = requireTeam()
    await archiveTeamWorkflowFn({ teamId, workflowId, archived })
  }

  const remove = async (workflowId: string): Promise<void> => {
    const teamId = requireTeam()
    await deleteTeamWorkflowFn({ teamId, workflowId })
  }

  const runNow = async (workflowId: string): Promise<string> => {
    const teamId = requireTeam()
    const { data } = await runTeamWorkflowNowFn({ teamId, workflowId })
    return data.runId
  }

  /** Approve (apply staged edits) or reject a `require_review` run. */
  const reviewRun = async (
    runId: string,
    decision: WorkflowReviewDecision
  ): Promise<string> => {
    const teamId = requireTeam()
    const { data } = await reviewTeamWorkflowRunFn({ teamId, runId, decision })
    return data.status
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

  return {
    workflows,
    activeWorkflows,
    archivedWorkflows,
    recentRuns,
    awaitingReviewRuns,
    enabledPresetKeys,
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
    enablePreset,
  }
})
