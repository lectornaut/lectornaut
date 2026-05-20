/**
 * useTeamCustomTools — i18n-aware composable wrapper around
 * `useTeamCustomToolsStore`.
 *
 * Same shape as `useTeamAgents` so settings UIs can reuse the i18n
 * messages → toasts plumbing and the `canManage` admin gate without
 * any further abstraction. Silent consumers (e.g. the composer
 * eventually rendering custom tools as quick-pick chips) should bind
 * to `useTeamCustomToolsStore()` directly and skip the toast layer.
 */

import type {
  CreateTeamCustomToolDraft,
  UpdateTeamCustomToolPatch,
} from "@/composables/useFunctions"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamCustomToolsStore } from "@/stores/teamCustomToolsStore"
import type { ITeamCustomTool } from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import { toast } from "vue-sonner"

interface UseTeamCustomToolsI18n {
  permissionRequired?: string
  createSuccess?: string
  createError?: string
  updateSuccess?: string
  updateError?: string
  archiveSuccess?: string
  archiveError?: string
  restoreSuccess?: string
  restoreError?: string
  enableSuccess?: string
  disableSuccess?: string
  setEnabledError?: string
  deleteSuccess?: string
  deleteError?: string
}

export function useTeamCustomTools(messagesRef?: () => UseTeamCustomToolsI18n) {
  const store = useTeamCustomToolsStore()
  const {
    tools,
    selectableTools,
    disabledTools,
    archivedTools,
    isLoading,
    isSaving,
    loadError,
  } = storeToRefs(store)

  const membershipStore = useMembershipStore()
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  const canManage = computed(() => isOwner.value || isAdmin.value)

  const cannotManageReason = computed(() => {
    if (canManage.value) return null
    const msg = messagesRef?.().permissionRequired ?? ""
    return msg.length > 0 ? msg : null
  })

  const guardManage = (): boolean => {
    if (canManage.value) return true
    const msg = messagesRef?.().permissionRequired ?? ""
    if (msg) toast.error(msg)
    return false
  }

  const create = async (
    draft: CreateTeamCustomToolDraft
  ): Promise<ITeamCustomTool | null> => {
    if (!guardManage()) return null
    try {
      const tool = await store.create(draft)
      const okMsg = messagesRef?.().createSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return tool
    } catch (error) {
      console.error("[useTeamCustomTools] failed to create tool:", error)
      const errMsg = messagesRef?.().createError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const update = async (
    toolId: string,
    patch: UpdateTeamCustomToolPatch
  ): Promise<ITeamCustomTool | null> => {
    if (!guardManage()) return null
    try {
      const tool = await store.update(toolId, patch)
      const okMsg = messagesRef?.().updateSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return tool
    } catch (error) {
      console.error("[useTeamCustomTools] failed to update tool:", error)
      const errMsg = messagesRef?.().updateError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const archive = async (toolId: string): Promise<ITeamCustomTool | null> => {
    if (!guardManage()) return null
    try {
      const tool = await store.archive(toolId)
      const okMsg = messagesRef?.().archiveSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return tool
    } catch (error) {
      console.error("[useTeamCustomTools] failed to archive tool:", error)
      const errMsg = messagesRef?.().archiveError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const restore = async (toolId: string): Promise<ITeamCustomTool | null> => {
    if (!guardManage()) return null
    try {
      const tool = await store.restore(toolId)
      const okMsg = messagesRef?.().restoreSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return tool
    } catch (error) {
      console.error("[useTeamCustomTools] failed to restore tool:", error)
      const errMsg = messagesRef?.().restoreError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const setEnabled = async (
    toolId: string,
    enabled: boolean
  ): Promise<ITeamCustomTool | null> => {
    if (!guardManage()) return null
    try {
      const tool = await store.setEnabled(toolId, enabled)
      const okMsg = enabled
        ? (messagesRef?.().enableSuccess ?? "")
        : (messagesRef?.().disableSuccess ?? "")
      if (okMsg) toast.success(okMsg)
      return tool
    } catch (error) {
      console.error("[useTeamCustomTools] failed to toggle tool:", error)
      const errMsg = messagesRef?.().setEnabledError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const remove = async (toolId: string): Promise<boolean> => {
    if (!guardManage()) return false
    try {
      await store.remove(toolId)
      const okMsg = messagesRef?.().deleteSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return true
    } catch (error) {
      console.error("[useTeamCustomTools] failed to delete tool:", error)
      const errMsg = messagesRef?.().deleteError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  return {
    tools,
    selectableTools,
    disabledTools,
    archivedTools,
    isLoading,
    isSaving,
    loadError,
    canManage,
    cannotManageReason,
    create,
    update,
    archive,
    restore,
    setEnabled,
    remove,
  }
}
