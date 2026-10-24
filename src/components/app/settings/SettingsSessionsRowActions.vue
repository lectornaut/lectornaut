<script lang="ts" setup>
import {
  IconArchive,
  IconPencil,
  IconRotateCcw,
  IconTrash2,
} from "@/data/icons"
import type { IBotSession } from "@/types/domain"
import { computed } from "vue"

const props = defineProps<{
  session: IBotSession
  /** True when the current user owns this session and may mutate it. */
  manageable: boolean
}>()

const emit = defineEmits<{
  (e: "rename", session: IBotSession): void
  (e: "archive", session: IBotSession): void
  (e: "delete", session: IBotSession): void
}>()

const { t } = useI18n()

const archived = computed(() => !!props.session.archivedAt)
</script>

<template>
  <!-- Read-only chip for sessions owned by other team members. The -->
  <!-- composable's mutation calls would silently no-op for non-owners, -->
  <!-- but hiding the menu entirely is clearer than a menu of dead links. -->
  <span v-if="!manageable" class="text-muted-foreground text-xs">
    {{ t("ai.visibilityShared") }}
  </span>
  <TooltipProvider v-else>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <DataTableRowActionsButton :label="t('ai.chatActions')" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ t("ai.chatActions") }}</TooltipContent>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-hotkey="r" @click="emit('rename', session)">
            <IconPencil />
            {{ t("actions.rename") }}
            <DropdownMenuShortcut>R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem data-hotkey="a" @click="emit('archive', session)">
            <Component :is="archived ? IconRotateCcw : IconArchive" />
            {{ archived ? t("ai.restore") : t("ai.archive") }}
            <DropdownMenuShortcut>A</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-hotkey="backspace delete"
            @click="emit('delete', session)"
          >
            <IconTrash2 />
            {{ t("actions.delete") }}
            <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>
