<script lang="ts" setup>
import {
  IconArchive,
  IconPencil,
  IconRotateCcw,
  IconSettings,
  IconTrash,
} from "@/data/icons"
import type { ITeamCustomTool } from "@/types/domain"
import Avatar from "vue-boring-avatars"

const { t } = useI18n()

/**
 * Compact, non-expandable row mirror of `SettingsCustomAgentRow.vue`.
 * Same Item-based primitives, same three interactive zones (info /
 * cog menu / Switch), same lifecycle badge logic ("Disabled" wins
 * over "Archived" when both apply).
 *
 * Display affordances:
 *   - Title shows `displayName` when set, otherwise the wire-name
 *     (`name`) verbatim. Wire-name is the load-bearing identifier the
 *     model invokes; admins can pick a friendlier display label
 *     without altering the API surface.
 *   - Description renders the model-facing copy so admins see what
 *     the model sees — important for tuning when calls aren't
 *     happening as expected.
 *   - The avatar reuses `vue-boring-avatars` + chart-N palette so
 *     tools and agents have visually-consistent identity chips.
 */
const props = defineProps<{
  tool: ITeamCustomTool
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

const isArchived = computed(() => !!props.tool.archivedAt)

const statusBadgeKey = computed<"disabled" | "archived" | null>(() => {
  if (props.tool.enabled === false) return "disabled"
  if (props.tool.archivedAt) return "archived"
  return null
})

const titleText = computed(
  () => props.tool.displayName.trim() || props.tool.name
)

const avatarSeedEffective = computed(
  () => props.tool.avatarSeed.trim() || props.tool.name.trim() || "Tool"
)

const description = computed(() => props.tool.description.trim())

/**
 * Short label for the action kind shown next to the description as a
 * Badge — gives admins a quick "what is this tool" glance without
 * opening the editor. i18n keys live under `action.kinds.<kind>`.
 */
const actionKindLabel = computed(() =>
  t(`settings.agents.customTools.action.kinds.${props.tool.action.kind}`)
)

const deleteConfirmOpen = ref(false)

const handleDeleteConfirmed = (): void => {
  deleteConfirmOpen.value = false
  emit("remove")
}

const handleArchiveFromMenu = (): void => {
  if (isArchived.value) emit("restore")
  else emit("archive")
}

const onToggleEnabled = (value: boolean | string): void => {
  emit("toggleEnabled", Boolean(value))
}
</script>

<template>
  <Item variant="outline" :class="{ 'opacity-70': statusBadgeKey !== null }">
    <ItemMedia variant="image" class="rounded-full">
      <Avatar
        variant="marble"
        :name="avatarSeedEffective"
        :colors="[
          'var(--color-chart-1)',
          'var(--color-chart-2)',
          'var(--color-chart-3)',
          'var(--color-chart-4)',
          'var(--color-chart-5)',
        ]"
      />
    </ItemMedia>

    <ItemContent class="truncate">
      <ItemTitle class="flex items-center gap-2 truncate">
        <span class="truncate font-mono text-sm">
          {{ titleText }}
        </span>
        <Badge variant="secondary" class="shrink-0 text-xs">
          {{ actionKindLabel }}
        </Badge>
        <Badge v-if="statusBadgeKey === 'disabled'" variant="outline">
          {{ t("settings.agents.customTools.disabledBadge") }}
        </Badge>
        <Badge v-else-if="statusBadgeKey === 'archived'" variant="outline">
          {{ t("settings.agents.customTools.archivedBadge") }}
        </Badge>
      </ItemTitle>
      <ItemDescription v-if="description" class="truncate text-xs">
        {{ description }}
      </ItemDescription>
    </ItemContent>

    <ItemActions>
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
              {{ t("settings.agents.customTools.actions") }}
            </TooltipContent>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuItem @select="emit('edit')">
                <IconPencil />
                {{ t("settings.agents.customTools.edit") }}
              </DropdownMenuItem>
              <DropdownMenuItem @select="handleArchiveFromMenu">
                <Component :is="isArchived ? IconRotateCcw : IconArchive" />
                {{
                  isArchived
                    ? t("settings.agents.customTools.restore")
                    : t("settings.agents.customTools.archive")
                }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:text-destructive"
                @select="deleteConfirmOpen = true"
              >
                <IconTrash />
                {{ t("settings.agents.customTools.deleteForever") }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-block">
              <Switch
                :model-value="tool.enabled !== false"
                :disabled="!canManage || isSaving"
                @update:model-value="onToggleEnabled"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {{
              tool.enabled !== false
                ? t("settings.agents.customTools.enabledTooltip")
                : t("settings.agents.customTools.disabledTooltip")
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
          {{ t("settings.agents.customTools.deleteConfirmTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("settings.agents.customTools.deleteConfirmBody", {
              name: titleText,
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          class="text-current"
          @click="handleDeleteConfirmed"
        >
          {{ t("settings.agents.customTools.deleteForever") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
