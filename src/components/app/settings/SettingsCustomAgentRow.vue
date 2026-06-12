<script lang="ts" setup>
import {
  IconArchive,
  IconPencil,
  IconRotateCcw,
  IconSettings,
  IconTrash,
} from "@/data/icons"
import type { ITeamAgent } from "@/types/domain"

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

/** Lifecycle status for the inline badge — see Card's matching enum. */
const statusBadgeKey = computed<"disabled" | "archived" | null>(() => {
  if (props.agent.enabled === false) return "disabled"
  if (props.agent.archivedAt) return "archived"
  return null
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
  <Item variant="outline" :class="{ 'opacity-70': statusBadgeKey !== null }">
    <!--
      `variant="image"` on ItemMedia gives the responsive size-10 /
      size-8 / size-6 sizing the family already encodes for different
      Item sizes. We override `rounded-sm` → `rounded-full` because
      boring-avatars renders a SVG portrait that wants a circle clip.
    -->
    <ItemMedia variant="image" class="rounded-full">
      <AppAvatar variant="beam" :name="avatarSeedEffective" class="size-full" />
    </ItemMedia>

    <ItemContent>
      <ItemTitle>
        {{ agent.name }}
        <Badge v-if="statusBadgeKey === 'disabled'" variant="outline">
          {{ t("settings.agents.custom.disabledBadge") }}
        </Badge>
        <Badge v-else-if="statusBadgeKey === 'archived'" variant="outline">
          {{ t("settings.agents.custom.archivedBadge") }}
        </Badge>
      </ItemTitle>
      <ItemDescription v-if="description" class="text-xs">
        {{ description }}
      </ItemDescription>
    </ItemContent>

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
                variant="destructive"
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
          >{{ t("common.cancel") }}<Kbd aria-hidden="true">Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction @click="handleDeleteConfirmed">
          {{ t("settings.agents.custom.deleteForever") }}
          <Kbd aria-hidden="true">↩</Kbd>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
