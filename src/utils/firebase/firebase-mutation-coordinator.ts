import { isRetryableFirebaseError } from "@/utils/firebase/firebase-errors"
import {
  beginCloudSyncOperation,
  endCloudSyncOperation,
  getBackoffDelay,
  optimisticUpdater,
  sleep,
  type OptimisticMutationReceipt,
  type PendingCollection,
} from "@/utils/firebase/firebase-optimistic"
import {
  enqueue,
  syncEngine,
  type SyncMutatePayload,
} from "@/utils/firebase/firebase-sync-engine"

export interface CoordinatedMutationOptions {
  id: string
  pendingIds: PendingCollection
  applyLocal: () => void
  rollbackLocal: () => void
  mutation: SyncMutatePayload
  source?: string
  trackSync?: boolean
  maxRetries?: number
  retryBaseDelay?: number
  pendingReleaseDelayMs?: number
  onCommit?: (receipt: OptimisticMutationReceipt) => void
  onRollback?: (receipt: OptimisticMutationReceipt, error: unknown) => void
}

export interface CoordinatedMutationResult {
  operationId: string
  receipt: OptimisticMutationReceipt
}

export interface MutationPipelineContracts {
  optimisticUpdater: Pick<
    typeof optimisticUpdater,
    "applyLocal" | "commit" | "rollback"
  >
  syncEngine: Pick<typeof syncEngine, "enqueue">
}

export const mutationPipelineContracts: MutationPipelineContracts = {
  optimisticUpdater,
  syncEngine,
}

const enqueueInMicrotask = (mutation: SyncMutatePayload) =>
  new Promise<ReturnType<typeof enqueue>>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        resolve(enqueue(mutation, { schedule: "microtask" }))
      } catch (error) {
        reject(error)
      }
    })
  })

export async function mutateWithCoordinator(
  options: CoordinatedMutationOptions
): Promise<CoordinatedMutationResult> {
  const {
    id,
    pendingIds,
    applyLocal,
    rollbackLocal,
    mutation,
    source = mutation.source,
    trackSync = true,
    maxRetries = 0,
    retryBaseDelay = 1000,
    pendingReleaseDelayMs,
    onCommit,
    onRollback,
  } = options

  const receipt = mutationPipelineContracts.optimisticUpdater.applyLocal({
    id,
    source,
    pendingIds,
    applyLocal,
    rollback: rollbackLocal,
    pendingReleaseDelayMs,
  })

  const syncToken = trackSync ? beginCloudSyncOperation({ id, source }) : null
  let syncError: unknown

  try {
    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const queued = await enqueueInMicrotask(mutation)
        await queued.settled

        mutationPipelineContracts.optimisticUpdater.commit(receipt)
        onCommit?.(receipt)
        return {
          operationId: queued.operationId,
          receipt,
        }
      } catch (error) {
        lastError = error
        if (!isRetryableFirebaseError(error) || attempt >= maxRetries) {
          throw error
        }

        const delay = getBackoffDelay(attempt, retryBaseDelay)
        await sleep(delay)
      }
    }

    throw lastError ?? new Error("Mutation coordinator failed")
  } catch (error) {
    syncError = error
    mutationPipelineContracts.optimisticUpdater.rollback(receipt)
    onRollback?.(receipt, error)
    throw error
  } finally {
    if (syncToken !== null) {
      endCloudSyncOperation(syncToken, syncError)
    }
  }
}
