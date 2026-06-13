/**
 * useCreateActions — behaviour + permission gating behind the sidebar
 * "Create New" menu.
 *
 * The presentation metadata (icon, colour, label key, group) lives in
 * `defaultCreateMenu`; this composable attaches a `run` handler and a reactive
 * `{ disabled, reason }` gate to each entry, keyed by id. The `Record<…>` types
 * make TypeScript enforce that every menu id has both.
 *
 * Each intent reuses the trigger that already exists for it elsewhere, rather
 * than inventing a new mechanism:
 *   - write / code     → create a root node via the callable, then open it
 *   - agent / tool     → the globally-mounted editor dialogs (mitt events,
 *                        mounted in `layouts/app.vue`)
 *   - workflow         → a globally-mounted editor dialog (mitt event)
 *   - workspace        → the always-mounted switcher dialog (a mitt event the
 *                        switcher listens for)
 *
 * `CreateMenu` only renders inside `MainLayout`, which already gates on an
 * active team + workspace, so the node/workflow flows always have a workspace.
 */

import { useNodes } from "@/composables/useNodes"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  defaultCreateMenu,
  type CreateMenuGroup,
  type CreateMenuId,
} from "@/helpers/defaults"
import { CREATE_SEQUENCE_PREFIX } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { ROOT_PARENT_ID } from "@/types/nodes"
import { storeToRefs } from "pinia"
import { computed, type Component } from "vue"
import { useRouter } from "vue-router"
import { toast } from "vue-sonner"

export interface CreateAction {
  id: CreateMenuId
  label: string
  icon: Component
  iconClass: string
  disabled: boolean
  disabledReason: string | null
  /** Single-letter menu accelerator (see `useMenuActionHotkey`), lowercase. */
  hotkey: string
  /**
   * Multi-key "create" sequence (e.g. `["C", "D"]` for a new document): the
   * create prefix plus this intent's accelerator letter, uppercased. Bound by
   * `useGlobalHotkeySequences` and surfaced as a key hint in the ⌘K palette.
   */
  sequence: string[]
  run: () => void | Promise<void>
}

export interface CreateActionGroup {
  id: CreateMenuGroup
  actions: CreateAction[]
}

export function useCreateActions() {
  const { t } = useI18n()
  const router = useRouter()
  const { createFile } = useNodes()

  const {
    canCreateWorkspace,
    getCannotCreateWorkspaceReason,
    currentWorkspace,
  } = useWorkspaceActions()

  // Admin gate shared by the AI trio (agent / tool / workflow) — mirrors the
  // `isOwner || isAdmin` check inside `useTeamAgents` / `useTeamWorkflows`.
  const { isOwner, isAdmin } = storeToRefs(useMembershipStore())
  const canManageAI = computed(() => isOwner.value || isAdmin.value)

  // Team-wide feature toggles — a silent read of the agent-config store (no
  // toast / save machinery). An unset key defaults to enabled, matching the
  // server's normalization, so a not-yet-loaded config never wrongly hides.
  const { config } = storeToRefs(useAgentConfigStore())
  const featureOn = (key: "customAgents" | "customTools" | "customWorkflows") =>
    config.value.tools[key] !== false

  // Create a root-level node in the active workspace, then route to it: the
  // write/code pages open whatever `:nodeId` the URL carries.
  const createAndOpenNode = async (scope: "write" | "code"): Promise<void> => {
    const ws = currentWorkspace.value
    if (!ws) return
    try {
      const name = t(
        scope === "write"
          ? "mainSidebar.create.newDocumentName"
          : "mainSidebar.create.newCodeName"
      )
      const nodeId = await createFile(
        scope,
        ws.teamId,
        ws.id,
        ROOT_PARENT_ID,
        name
      )
      await router.push(`/${scope}/${nodeId}`)
    } catch (error) {
      console.error("[useCreateActions] node create failed:", error)
      toast.error(t("mainSidebar.create.createError"))
    }
  }

  const aiReason = (on: boolean): string | null => {
    if (!canManageAI.value) return t("mainSidebar.create.disabledAdminOnly")
    if (!on) return t("mainSidebar.create.disabledFeatureOff")
    return null
  }

  // Per-intent click action, keyed by id so the menu can't add an entry
  // without a handler.
  const runById: Record<CreateMenuId, () => void | Promise<void>> = {
    write: () => createAndOpenNode("write"),
    code: () => createAndOpenNode("code"),
    agent: () => emitter.emit("Dialog.CustomAgents.Open", "new"),
    tool: () => emitter.emit("Dialog.CustomTools.Open", "new"),
    workflow: () => emitter.emit("Dialog.CustomWorkflow.Open"),
    workspace: () => emitter.emit("Dialog.CreateWorkspace.Open"),
  }

  // The ONE mnemonic key per create intent, deliberately shared by both
  // surfaces so they can never drift: the in-menu accelerator (rendered in
  // `CreateMenu` + bound via `data-hotkey`) AND the second key of the global
  // `C`-prefixed create sequence (`sequence` below, shown in ⌘K). Keep them in
  // sync by only ever editing this map.
  //
  // Each is the label's first letter — Document → d, Code file → c, Agent → a,
  // Tool → t, Workflow → w. Two are structurally constrained, not arbitrary:
  // Workspace would also be `w`, so it yields that to Workflow (the more
  // central feature) and takes `s` (Space); and `code` keeps `c` (the clearest
  // mnemonic) even though that makes its sequence the doubled `C C`. Must stay
  // unique across the six.
  const hotkeyById: Record<CreateMenuId, string> = {
    write: "d",
    code: "c",
    agent: "a",
    tool: "t",
    workflow: "w",
    workspace: "s",
  }

  // Per-intent reactive gate. Evaluated inside the `groups` computed so the
  // menu re-reads it as permissions / toggles change.
  const gateById: Record<
    CreateMenuId,
    () => { disabled: boolean; reason: string | null }
  > = {
    write: () => ({ disabled: !currentWorkspace.value, reason: null }),
    code: () => ({ disabled: !currentWorkspace.value, reason: null }),
    agent: () => {
      const on = featureOn("customAgents")
      return { disabled: !canManageAI.value || !on, reason: aiReason(on) }
    },
    tool: () => {
      const on = featureOn("customTools")
      return { disabled: !canManageAI.value || !on, reason: aiReason(on) }
    },
    workflow: () => {
      const on = featureOn("customWorkflows")
      return {
        disabled: !canManageAI.value || !on || !currentWorkspace.value,
        reason: aiReason(on),
      }
    },
    workspace: () => ({
      disabled: !canCreateWorkspace.value,
      reason: getCannotCreateWorkspaceReason.value,
    }),
  }

  const groupOrder: CreateMenuGroup[] = ["content", "ai", "org"]

  const groups = computed<CreateActionGroup[]>(() =>
    groupOrder.map((group) => ({
      id: group,
      actions: defaultCreateMenu
        .filter((item) => item.group === group)
        .map((item) => {
          const { disabled, reason } = gateById[item.id]()
          return {
            id: item.id,
            label: t(item.titleKey),
            icon: item.icon,
            iconClass: item.style.text,
            disabled,
            disabledReason: reason,
            hotkey: hotkeyById[item.id],
            sequence: [
              CREATE_SEQUENCE_PREFIX,
              hotkeyById[item.id].toUpperCase(),
            ],
            run: runById[item.id],
          }
        }),
    }))
  )

  return { groups }
}
