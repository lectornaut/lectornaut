<script lang="ts" setup>
import {
  IconArchive,
  IconPencil,
  IconRotateCcw,
  IconSettings,
  IconTrash,
} from "@/data/icons"
import { computed, ref } from "vue"

/**
 * Workflow row for Settings → Workflows, built on the shadcn-style `<Item>`
 * primitives (ItemMedia / ItemContent / ItemTitle / ItemDescription /
 * ItemActions) so the custom + archived lists line up with the custom-agent and
 * custom-tool rows in the sibling settings panes — same three interactive zones
 * (info / cog menu / Switch) and the same lifecycle-badge logic ("Disabled"
 * wins over "Archived" when both apply).
 *
 * Workflow-specific vs. the agent / tool rows:
 *   - The media slot renders a `vue-boring-avatars` portrait seeded from
 *     `avatarSeed` (falling back to `name`), matching the custom-agent and
 *     custom-tool rows. Workflows use the `bauhaus` variant to stay distinct
 *     from agents (`beam`) and tools (`marble`) while sharing the chart-N
 *     palette.
 *   - The cog menu is flag-driven: predefined rows expose only "Edit"; custom
 *     rows add Archive / Restore + Delete-forever (`canArchive` / `isArchived`
 *     / `canDelete`).
 *   - `switchDisabled` lets a gated predefined preset (dependency not shipped
 *     yet) render its Switch inert.
 */
const props = defineProps<{
  /** Stable element id for the Switch (the workflow doc id). */
  id: string
  name: string
  description: string
  /** Seed for the row's generative avatar; falls back to `name` when blank. */
  avatarSeed: string
  enabled: boolean
  isPredefined: boolean
  isArchived: boolean
  canManage: boolean
  isSaving: boolean
  /** Custom + active → can archive. */
  canArchive: boolean
  /** Custom → can hard-delete. */
  canDelete: boolean
  /** e.g. a gated predefined preset whose dependency doesn't exist yet. */
  switchDisabled?: boolean
}>()

const emit = defineEmits<{
  edit: []
  toggleEnabled: [enabled: boolean]
  archive: []
  restore: []
  remove: []
}>()

const { t } = useI18n()

const statusBadgeKey = computed<"disabled" | "archived" | null>(() => {
  if (props.isArchived) return "archived"
  if (!props.enabled) return "disabled"
  return null
})

const avatarSeedEffective = computed(
  () => props.avatarSeed.trim() || props.name.trim() || "Workflow"
)

const deleteConfirmOpen = ref(false)
const handleDeleteConfirmed = (): void => {
  deleteConfirmOpen.value = false
  emit("remove")
}
const onToggleEnabled = (value: boolean | string): void => {
  emit("toggleEnabled", Boolean(value))
}
</script>

<template>
  <Item variant="outline" :class="{ 'opacity-70': statusBadgeKey !== null }">
    <ItemMedia variant="image" class="rounded-full">
      <AppAvatar
        variant="bauhaus"
        :name="avatarSeedEffective"
        class="size-full"
      />
    </ItemMedia>

    <ItemContent>
      <ItemTitle class="flex items-center gap-2 truncate">
        <span class="truncate">{{ name }}</span>
        <Badge v-if="isPredefined" variant="secondary" class="shrink-0">
          {{ t("settings.workflows.predefinedBadge") }}
        </Badge>
        <Badge
          v-if="statusBadgeKey === 'disabled'"
          variant="outline"
          class="shrink-0"
        >
          {{ t("settings.workflows.disabled") }}
        </Badge>
        <Badge
          v-else-if="statusBadgeKey === 'archived'"
          variant="outline"
          class="shrink-0"
        >
          {{ t("settings.workflows.archivedBadge") }}
        </Badge>
      </ItemTitle>
      <ItemDescription v-if="description" class="text-xs">
        {{ description }}
      </ItemDescription>
    </ItemContent>

    <ItemActions>
      <!-- Configure cog. Always has Edit; custom rows add Archive / Restore +
           Delete-forever. -->
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
              {{ t("settings.workflows.configure") }}
            </TooltipContent>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuItem data-hotkey="e" @select="emit('edit')">
                <IconPencil />
                {{ t("settings.workflows.edit") }}
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <template v-if="canArchive || isArchived || canDelete">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  v-if="isArchived"
                  data-hotkey="a"
                  @select="emit('restore')"
                >
                  <IconRotateCcw />
                  {{ t("settings.workflows.restore") }}
                  <DropdownMenuShortcut>A</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-else-if="canArchive"
                  data-hotkey="a"
                  @select="emit('archive')"
                >
                  <IconArchive />
                  {{ t("settings.workflows.archive") }}
                  <DropdownMenuShortcut>A</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="canDelete"
                  variant="destructive"
                  data-hotkey="backspace delete"
                  @select="deleteConfirmOpen = true"
                >
                  <IconTrash />
                  {{ t("settings.workflows.delete") }}
                  <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      </TooltipProvider>

      <!-- Enable / disable Switch. Tooltip copy swaps with state so admins see
           what the next click does. -->
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-block">
              <Switch
                :id="`wf-row-${id}`"
                :model-value="enabled"
                :disabled="!canManage || isSaving || switchDisabled"
                @update:model-value="onToggleEnabled"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {{
              enabled
                ? t("settings.workflows.disableAction")
                : t("settings.workflows.enableAction")
            }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </ItemActions>
  </Item>

  <AlertDialog v-model:open="deleteConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("settings.workflows.deleteConfirmTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("settings.workflows.confirmDelete", { name }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel
          >{{ t("settings.workflows.cancel") }}<Kbd>Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction @click="handleDeleteConfirmed">
          {{ t("settings.workflows.delete") }}
          <Kbd>↩</Kbd>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
