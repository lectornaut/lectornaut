<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  useShortcutRecorder,
  type ShortcutRecorderTarget,
} from "@/composables/useShortcutRecorder"
import {
  IconArrowUpRight,
  IconBookOpen,
  IconCheck,
  IconChevronRight,
  IconKeyboard,
  IconMessageCircle,
  IconRotateCcw,
  IconSearch,
  IconSettings2,
} from "@/data/icons"
import {
  getFilteredShortcuts,
  getFlatShortcuts,
  getHotkeyCombos,
  getShortcutId,
  hotkeyToDisplayKeys,
  isDefaultHotkey,
  normalizeHotkeyCombo,
  type HotkeyBinding,
  type Shortcut,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import { useSettingsStore } from "@/stores/settingsStore"
import Fuse from "fuse.js"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()
const isFullscreen = useIsFullscreen()

const settingsStore = useSettingsStore()
const { shortcutOverrides, hasCustomShortcuts, isShortcutsLoading } =
  storeToRefs(settingsStore)
const {
  updateShortcutOverride,
  resetShortcutOverride,
  resetAllShortcutOverrides,
} = settingsStore

const openShortcuts = ref(false)

emitter.on("Dialog.Shortcuts.Open", () => {
  openShortcuts.value = !openShortcuts.value
})

const search = ref("")

const filterOptions = computed(() => ({
  context: "shortcuts" as const,
  isDesktop: isTauri.value,
}))

// Fuse instances recreated when platform changes
const fuseCategory = computed(
  () =>
    new Fuse(getFilteredShortcuts(filterOptions.value), {
      keys: ["shortcuts.description", "shortcuts.tags"],
    })
)

const fuseShortcut = computed(
  () =>
    new Fuse(getFlatShortcuts(filterOptions.value), {
      keys: ["description", "tags"],
    })
)

const filteredShortcuts = computed(() => {
  const baseShortcuts = getFilteredShortcuts(filterOptions.value)

  if (!search.value) {
    return baseShortcuts
  }

  const categoryResults = new Set(
    fuseCategory.value.search(search.value).map((result) => result.item)
  )
  const shortcutResults = new Set(
    fuseShortcut.value.search(search.value).map((result) => result.item)
  )

  return (Array.from(categoryResults) as ShortcutCategory[])
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter((s) => shortcutResults.has(s)),
    }))
    .filter((category) => category.shortcuts.length > 0)
})

// ──────────────────────────────────────────────────────────────────────────
// Custom shortcut editing
// ──────────────────────────────────────────────────────────────────────────

const editingShortcutId = ref<string | null>(null)

/** Get the effective hotkeys binding for a shortcut (override or default) */
const getEffectiveHotkeys = (
  shortcut: Shortcut
): HotkeyBinding | HotkeyBinding[] | undefined =>
  shortcutOverrides.value[getShortcutId(shortcut)] ?? shortcut.hotkeys

/** Get display keys for a shortcut, using override if present */
const getDisplayKeys = (shortcut: Shortcut): string[] => {
  const primaryCombo = getHotkeyCombos(getEffectiveHotkeys(shortcut))[0]
  return primaryCombo ? hotkeyToDisplayKeys(primaryCombo) : []
}

/** Check if a shortcut has a custom override */
const isCustomized = (shortcut: Shortcut): boolean =>
  getShortcutId(shortcut) in shortcutOverrides.value

/**
 * Conflict detection: check if a hotkey combo is used by another shortcut.
 * Returns the description of the conflicting shortcut, or null.
 */
const getConflict = (
  candidateHotkeys: string,
  excludeShortcutId: string
): string | null => {
  const candidateCombos = getHotkeyCombos(candidateHotkeys).map((combo) =>
    normalizeHotkeyCombo(combo)
  )

  const allShortcuts = getFlatShortcuts(filterOptions.value)
  for (const shortcut of allShortcuts) {
    if (getShortcutId(shortcut) === excludeShortcutId) continue
    const effective = getEffectiveHotkeys(shortcut)
    if (!effective) continue
    const existingCombos = getHotkeyCombos(effective).map((combo) =>
      normalizeHotkeyCombo(combo)
    )
    for (const combo of candidateCombos) {
      if (existingCombos.includes(combo)) {
        return shortcut.description.join(" > ")
      }
    }
  }
  return null
}

const shortcutRecorderRefs = new Map<string, ShortcutRecorderTarget>()

const {
  isRecording,
  startRecording,
  stopRecording,
  handleRecorderFocus,
  handleRecorderClick,
  handleRecorderKeydown,
} = useShortcutRecorder({
  onRecord: (hotkeys) => {
    const shortcutId = editingShortcutId.value
    if (!shortcutId) return

    const shortcut = getFlatShortcuts(filterOptions.value).find(
      (candidate) => getShortcutId(candidate) === shortcutId
    )
    const currentCombo = shortcut
      ? getHotkeyCombos(getEffectiveHotkeys(shortcut))[0]
      : undefined

    // No-op if the user re-recorded the combo already in effect.
    if (
      currentCombo &&
      normalizeHotkeyCombo(currentCombo) === normalizeHotkeyCombo(hotkeys)
    ) {
      stopRecording()
      editingShortcutId.value = null
      return
    }

    const conflict = getConflict(hotkeys, shortcutId)
    if (conflict) {
      toast.error(
        t("components.global.shortcuts.conflict", { shortcut: conflict })
      )
      stopRecording()
      editingShortcutId.value = null
      return
    }

    if (isDefaultHotkey(shortcutId, hotkeys)) {
      resetShortcutOverride(shortcutId)
    } else {
      updateShortcutOverride(shortcutId, hotkeys)
    }

    stopRecording()
    editingShortcutId.value = null
  },
})

const setShortcutRecorderRef = (
  shortcutId: string,
  el: ShortcutRecorderTarget
) => {
  if (el) {
    shortcutRecorderRefs.set(shortcutId, el)
    return
  }

  shortcutRecorderRefs.delete(shortcutId)
}

const focusShortcutRecorder = (shortcutId: string) => {
  void nextTick(() => {
    startRecording(shortcutRecorderRefs.get(shortcutId))
  })
}

const startEditing = (shortcut: Shortcut) => {
  const shortcutId = getShortcutId(shortcut)
  editingShortcutId.value = shortcutId
  focusShortcutRecorder(shortcutId)
}

const handleShortcutGroupClick = (shortcut: Shortcut, event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  if (target?.closest("button")) {
    return
  }

  if (isEditing(shortcut)) {
    focusShortcutRecorder(getShortcutId(shortcut))
    return
  }

  startEditing(shortcut)
}

const stopEditing = () => {
  stopRecording()
  editingShortcutId.value = null
}

const handleRestore = (shortcut: Shortcut) => {
  if (isEditing(shortcut)) {
    stopEditing()
  }

  resetShortcutOverride(getShortcutId(shortcut))
}

const isEditing = (shortcut: Shortcut): boolean =>
  editingShortcutId.value === getShortcutId(shortcut)
</script>

<template>
  <Sheet v-model:open="openShortcuts">
    <SheetContent
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-xl border"
      :class="{ 'mt-12': isTauri && !isFullscreen }"
    >
      <SheetHeader class="gap-4">
        <SheetTitle>{{ t("components.global.shortcuts.title") }}</SheetTitle>
        <SheetDescription>
          <InputGroup>
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              v-model="search"
              :placeholder="t('components.global.shortcuts.search')"
            />
          </InputGroup>
        </SheetDescription>
      </SheetHeader>
      <OverlayScrollbarsWrapper>
        <div class="flex grow flex-col px-4">
          <Accordion
            collapsible
            type="multiple"
            :default-value="filteredShortcuts.map((category) => category.id)"
          >
            <AccordionItem
              v-for="category in filteredShortcuts"
              :key="category.id"
              :value="category.id"
            >
              <AccordionTrigger>
                {{ category.title }}
              </AccordionTrigger>
              <AccordionContent>
                <Item
                  v-for="(shortcut, shortcutIndex) in category.shortcuts"
                  :key="shortcutIndex"
                  size="xs"
                >
                  <ItemContent>
                    <ItemDescription>
                      <span class="grid grid-cols-1">
                        <span class="truncate">
                          <span
                            v-for="(step, stepIndex) in shortcut.description"
                            :key="stepIndex"
                            class="inline-flex min-w-0 items-center"
                          >
                            <IconChevronRight
                              v-if="stepIndex > 0"
                              class="text-muted-foreground mx-1 shrink-0"
                            />
                            {{ step }}
                          </span>
                        </span>
                      </span>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <!-- Editable shortcut: inline InputGroup recorder -->
                    <template v-if="shortcut.hotkeys">
                      <InputGroup
                        class="bg-background w-min gap-1"
                        :data-disabled="isShortcutsLoading"
                        @click="handleShortcutGroupClick(shortcut, $event)"
                      >
                        <InputGroupAddon>
                          <KbdGroup>
                            <Kbd
                              v-for="key in getDisplayKeys(shortcut)"
                              :key="key"
                            >
                              {{ key }}
                            </Kbd>
                          </KbdGroup>
                        </InputGroupAddon>
                        <InputGroupInput
                          :ref="
                            (el) =>
                              setShortcutRecorderRef(
                                getShortcutId(shortcut),
                                el
                              )
                          "
                          readonly
                          :disabled="isShortcutsLoading"
                          :placeholder="
                            t('components.global.shortcuts.recording')
                          "
                          @focus="handleRecorderFocus"
                          @click="handleRecorderClick"
                          @keydown="handleRecorderKeydown"
                          @blur="stopEditing"
                        />
                        <TooltipProvider>
                          <InputGroupAddon align="inline-end" class="gap-1">
                            <Tooltip v-if="isCustomized(shortcut)">
                              <TooltipTrigger as-child>
                                <InputGroupButton
                                  size="icon-xs"
                                  :disabled="isShortcutsLoading"
                                  @mousedown.prevent
                                  @click="handleRestore(shortcut)"
                                >
                                  <IconRotateCcw />
                                </InputGroupButton>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  t(
                                    "components.global.shortcuts.restoreDefault"
                                  )
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip v-if="isEditing(shortcut) && isRecording">
                              <TooltipTrigger as-child>
                                <InputGroupButton
                                  size="icon-xs"
                                  :disabled="isShortcutsLoading"
                                >
                                  <IconCheck />
                                </InputGroupButton>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{ t("components.global.shortcuts.save") }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip v-else>
                              <TooltipTrigger as-child>
                                <InputGroupButton
                                  size="icon-xs"
                                  :disabled="isShortcutsLoading"
                                  @mousedown.prevent
                                  @click="startEditing(shortcut)"
                                >
                                  <IconSettings2 />
                                </InputGroupButton>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{ t("components.global.shortcuts.recording") }}
                              </TooltipContent>
                            </Tooltip>
                          </InputGroupAddon>
                        </TooltipProvider>
                      </InputGroup>
                    </template>
                    <!-- Non-editable shortcut: display-only keys -->
                    <template v-else>
                      <InputGroup
                        class="bg-background w-min gap-1"
                        data-disabled
                      >
                        <InputGroupAddon>
                          <KbdGroup
                            v-for="keys in shortcut.keys"
                            :key="keys.toString()"
                          >
                            <Kbd v-for="key in keys" :key="key">
                              {{ key }}
                            </Kbd>
                          </KbdGroup>
                        </InputGroupAddon>
                        <InputGroupInput readonly disabled />
                        <InputGroupAddon align="inline-end">
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <InputGroupButton size="icon-xs" disabled>
                                <IconKeyboard />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t("components.global.shortcuts.uneditable") }}
                            </TooltipContent>
                          </Tooltip>
                        </InputGroupAddon>
                      </InputGroup>
                    </template>
                  </ItemActions>
                </Item>
              </AccordionContent>
            </AccordionItem>
            <Empty v-if="filteredShortcuts.length === 0" class="p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconKeyboard />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("components.global.shortcuts.noShortcuts") }}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          </Accordion>
        </div>
      </OverlayScrollbarsWrapper>
      <SheetFooter>
        <Button
          v-if="hasCustomShortcuts"
          variant="secondary"
          class="justify-start"
          @click="resetAllShortcutOverrides"
        >
          <IconRotateCcw />
          {{ t("components.global.shortcuts.resetAll") }}
        </Button>
        <Button variant="secondary" class="justify-start">
          <IconMessageCircle />
          {{ t("components.global.shortcuts.getSupport") }}
        </Button>
        <Button variant="secondary" class="justify-start">
          <IconBookOpen />
          {{ t("components.global.shortcuts.documentation") }}
          <IconArrowUpRight />
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
