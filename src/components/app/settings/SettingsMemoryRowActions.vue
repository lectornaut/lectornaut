<script lang="ts" setup>
import {
  IconArchive,
  IconLock,
  IconMoreHorizontal,
  IconPencil,
  IconPin,
  IconPinOff,
  IconRotateCcw,
  IconTrash2,
  IconUsers,
} from "@/data/icons"
import type { IMemory } from "@/schemas/memory"
import { computed } from "vue"

const props = defineProps<{
  memory: IMemory
  /** Owner/admin/member — may edit/pin/archive/delete. Guests get a chip. */
  manageable: boolean
  /** Owner-only — may change this memory's visibility (share/unshare). */
  canShare: boolean
  /** Master Memory switch off ⇒ governance-only: edit is hidden. */
  editable: boolean
}>()

const emit = defineEmits<{
  (e: "edit", memory: IMemory): void
  (e: "share", memory: IMemory): void
  (e: "pin", memory: IMemory): void
  (e: "archive", memory: IMemory): void
  (e: "delete", memory: IMemory): void
}>()

const { t } = useI18n()

const archived = computed(() => props.memory.archived === true)
const pinned = computed(() => props.memory.pinned === true)
const shared = computed(() => props.memory.visibility === "shared")
</script>

<template>
  <span v-if="!manageable" class="text-muted-foreground text-xs">
    {{ t("ai.visibilityShared") }}
  </span>
  <TooltipProvider v-else>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              class="data-[state=open]:bg-accent"
              :aria-label="t('settings.memory.rowActions')"
              @click.stop
            >
              <IconMoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ t("settings.memory.rowActions") }}</TooltipContent>
        <DropdownMenuContent align="end">
          <DropdownMenuItem v-if="editable" @click="emit('edit', memory)">
            <IconPencil />
            {{ t("actions.edit") }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="canShare" @click="emit('share', memory)">
            <Component :is="shared ? IconLock : IconUsers" />
            {{
              shared ? t("settings.memory.unshare") : t("settings.memory.share")
            }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('pin', memory)">
            <Component :is="pinned ? IconPinOff : IconPin" />
            {{ pinned ? t("settings.memory.unpin") : t("settings.memory.pin") }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('archive', memory)">
            <Component :is="archived ? IconRotateCcw : IconArchive" />
            {{
              archived
                ? t("settings.memory.restore")
                : t("settings.memory.archive")
            }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            @click="emit('delete', memory)"
          >
            <IconTrash2 />
            {{ t("actions.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>
