<script lang="ts" setup>
import {
  IconArchive,
  IconPencil,
  IconRotateCcw,
  IconSettings,
  IconTrash,
} from "@/data/icons"
import type { ITeamAgent } from "@/types/domain"
import { settingsLifecycleStatus } from "@/helpers/settingsPresentation"

const { t } = useI18n()

/**
 * Compact, non-expandable agent row for the inline list inside
 * `SettingsAgents.vue`. Built on the shadcn-style `<Item>` primitives
 * (Item / ItemMedia / ItemContent / ItemTitle / ItemDescription /
 * ItemActions) so spacing, hover, and focus styling stay consistent
 * with member / device / team rows elsewhere in Settings.
 *
 * Three interactive zones:
 *   1. Avatar + title + description — purely informational. Editing
 *      happens via the cog menu's Edit action so the affordance is
 *      explicit and consistent with archive / delete from the same
 *      menu.
 *   2. Cog dropdown (ItemActions) — Edit, Archive (or Restore),
 *      Delete forever. Delete opens the sibling AlertDialog because
 *      it's irreversible; archive runs without confirmation (Restore
 *      reverses it).
 *   3. Enable/Disable Switch (ItemActions) — admin toggle, mirrors
 *      the team provider Switch pattern.
 *
 * Status badge in the title surfaces lifecycle state at a glance —
 * "Disabled" wins for display when both apply (it's the stronger gate).
 */
const props = defineProps<{
  agent: ITeamAgent
  canManage: boolean
  isSaving: boolean
}>()

const emit = defineEmits<{
  edit: []
  toggleEnabled: [enabled: boolean]
  archive: []
  restore: []
  remove: []
}>()

const isArchived = computed(() => !!props.agent.archivedAt)

const statusBadgeKey = computed<"disabled" | "archived" | null>(() => {
  return settingsLifecycleStatus(
    props.agent.enabled !== false,
    !!props.agent.archivedAt
  )
})

const avatarSeedEffective = computed(
  () => props.agent.avatarSeed.trim() || props.agent.name.trim() || "Agent"
)

const description = computed(() => props.agent.description.trim())

const deleteConfirmOpen = ref(false)

const handleDeleteConfirmed = (): void => {
  deleteConfirmOpen.value = false
  emit("remove")
}

const handleArchiveFromMenu = (): void => {
  if (isArchived.value) {
    emit("restore")
  } else {
    emit("archive")
  }
}

const onToggleEnabled = (value: boolean | string): void => {
  emit("toggleEnabled", Boolean(value))
}
</script>

<template>
  <Item
    variant="outline"
    class="flex-nowrap"
    :class="{ 'opacity-70': statusBadgeKey !== null }"
  >
    <ItemMedia variant="image" class="rounded-4xl">
      <AppAvatar variant="beam" :name="avatarSeedEffective" class="size-full" />
    </ItemMedia>

    <SettingsIdentity :title="agent.name" :description="description">
      <template #badges>
        <Badge v-if="statusBadgeKey === 'disabled'" variant="outline">
          {{ t("settings.agents.custom.disabledBadge") }}
        </Badge>
        <Badge v-else-if="statusBadgeKey === 'archived'" variant="outline">
          {{ t("settings.agents.custom.archivedBadge") }}
        </Badge>
      </template>
    </SettingsIdentity>

    <ItemActions>
      <!--
        Cog actions dropdown. Includes the destructive "Delete forever"
        entry — clicking it opens the AlertDialog below rather than
        acting immediately, since the action is irreversible.
      -->
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="!canManage || isSaving"
                >
                  <IconSettings />
                </InputGroupButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {{ t("settings.agents.custom.actions") }}
            </TooltipContent>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuItem data-hotkey="e" @select="emit('edit')">
                <IconPencil />
                {{ t("settings.agents.custom.edit") }}
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem data-hotkey="a" @select="handleArchiveFromMenu">
                <Component :is="isArchived ? IconRotateCcw : IconArchive" />
                {{
                  isArchived
                    ? t("settings.agents.custom.restore")
                    : t("settings.agents.custom.archive")
                }}
                <DropdownMenuShortcut>A</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-hotkey="backspace delete"
                @select="deleteConfirmOpen = true"
              >
                <IconTrash />
                {{ t("settings.agents.custom.deleteForever") }}
                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      </TooltipProvider>

      <!--
        Enable/disable Switch — mirrors the team provider Switch
        pattern. Tooltip copy swaps with state so admins see what the
        next click will do, not what the last one did.
      -->
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-block">
              <Switch
                :model-value="agent.enabled !== false"
                :disabled="!canManage || isSaving"
                @update:model-value="onToggleEnabled"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {{
              agent.enabled !== false
                ? t("settings.agents.custom.enabledTooltip")
                : t("settings.agents.custom.disabledTooltip")
            }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </ItemActions>
  </Item>

  <!--
    Hard-delete confirmation — required because the action is
    irreversible. Sibling of the Item so the overlay isn't constrained
    by the row layout. Archive intentionally has no equivalent guard
    (it's reversible via Restore from the same menu).
  -->
  <AlertDialog v-model:open="deleteConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("settings.agents.custom.deleteConfirmTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("settings.agents.custom.deleteConfirmBody", {
              name: agent.name,
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel
          >{{ t("common.cancel") }}<Kbd>Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction @click="handleDeleteConfirmed">
          {{ t("settings.agents.custom.deleteForever") }}
          <Kbd>↩</Kbd>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
