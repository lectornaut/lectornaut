<script lang="ts" setup>
import { usePopout } from "@/composables/usePopout"
import {
  IconGripHorizontal,
  IconMinus,
  IconPanelRight,
  IconPictureInPicture2,
  IconPlus,
  IconX,
} from "@/data/icons"
import { UseDraggable as Draggable } from "@vueuse/components"
import { unrefElement, usePreferredReducedMotion } from "@vueuse/core"
import { Motion, MotionConfig, motion } from "motion-v"
import type { ComponentPublicInstance } from "vue"

const { t } = useI18n()

const innerWidth = window.innerWidth
const innerHeight = window.innerHeight
const draggableContainer = ref<HTMLElement | null>(null)
const draggableEl = ref<ComponentPublicInstance | null>(null)
const draggableHandleEl = ref<ComponentPublicInstance | null>(null)
const draggableHandle = computed(() => unrefElement(draggableHandleEl))
// Window chrome lives here; the content is teleported into
// `#popout-dock` by whoever opened it (see `usePopout`).
const {
  isDocked,
  openAiAsk,
  isPoppedOut,
  isChatWindowOpen,
  isPoppedOutMinimized,
  poppedOutTitle,
  closeChatWindow,
} = usePopout()
const observedSize = useLocalStorage("popout-size", { width: 300, height: 400 })
const observedPosition = useLocalStorage("popout-position", { x: 0.5, y: 0.5 })
const reducedMotion = usePreferredReducedMotion()
const isChatWindowMorphing = ref(false)
const layoutDependency = computed(() =>
  [isDocked.value, isPoppedOutMinimized.value, reducedMotion.value].join(":")
)
const windowTransition = computed(() => ({
  type: "spring" as const,
  duration: reducedMotion.value === "reduce" ? 0 : 0.4,
  bounce: 0,
}))

watch([isChatWindowOpen, reducedMotion], () => {
  if (!isChatWindowOpen.value || reducedMotion.value === "reduce") {
    isChatWindowMorphing.value = false
  }
})

watch([isPoppedOut, openAiAsk], ([pinnedOpen, askOpen]) => {
  if (pinnedOpen || askOpen) {
    isPoppedOutMinimized.value = false
  }
})

watch(isDocked, async () => {
  const focusedElement = document.activeElement
  const restoreFocus =
    focusedElement instanceof HTMLElement &&
    unrefElement(draggableEl)?.contains(focusedElement)

  isChatWindowMorphing.value = false
  await nextTick()
  if (restoreFocus && focusedElement.isConnected) {
    focusedElement.focus({ preventScroll: true })
  }
})

useResizeObserver(draggableEl, (entries) => {
  const entry = entries[0]
  if (!entry) return
  if (
    isDocked.value ||
    isPoppedOutMinimized.value ||
    isChatWindowMorphing.value
  )
    return

  const target = entry.target as HTMLElement
  observedSize.value = {
    width: target.offsetWidth,
    height: target.offsetHeight,
  }
})
</script>

<template>
  <!-- Apply reduced motion via the reactive duration, including mid-animation changes. -->
  <MotionConfig reduced-motion="never">
    <div
      id="right-dock"
      class="bg-background flex size-full min-h-0 min-w-0 flex-col overflow-clip rounded-3xl"
    ></div>
    <!-- Teleport moves the existing frame without remounting its chat content. -->
    <Teleport defer to="#right-dock" :disabled="!isDocked">
      <Transition
        :css="!isDocked && reducedMotion !== 'reduce'"
        enter-active-class="transition-opacity duration-200 ease-in-out"
        leave-active-class="transition-opacity duration-200 ease-in-out"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isChatWindowOpen"
          ref="draggableContainer"
          class="min-h-0 min-w-0"
          :class="
            isDocked
              ? 'size-full'
              : 'pointer-events-none fixed top-12 right-2 bottom-12 left-14 z-50'
          "
        >
          <ContextMenu>
            <ContextMenuTrigger as-child>
              <Motion
                ref="draggableEl"
                as-child
                :layout="!isDocked"
                :layout-dependency="layoutDependency"
                :initial="false"
                :transition="windowTransition"
                :style="{ borderRadius: '24px' }"
                @layout-animation-start="isChatWindowMorphing = true"
                @layout-animation-complete="isChatWindowMorphing = false"
              >
                <Draggable
                  prevent-default
                  :disabled="isDocked || isChatWindowMorphing"
                  :handle="draggableHandle"
                  :initial-value="{
                    x: observedPosition.x * (innerWidth - observedSize.width),
                    y: observedPosition.y * (innerHeight - observedSize.height),
                  }"
                  storage-key="popout-position"
                  storage-type="local"
                  :container-element="draggableContainer"
                  :style="
                    isDocked
                      ? {
                          position: 'relative',
                          left: '0px',
                          top: '0px',
                          width: '100%',
                          height: '100%',
                          touchAction: 'auto',
                        }
                      : isPoppedOutMinimized
                        ? {
                            width: 'auto',
                            height: 'auto',
                          }
                        : {
                            width: `${observedSize.width}px`,
                            height: `${observedSize.height}px`,
                          }
                  "
                  class="bg-background pointer-events-auto flex min-w-0 flex-col overflow-clip rounded-3xl"
                  :class="
                    isDocked
                      ? 'size-full'
                      : [
                          'absolute min-w-64 border backdrop-blur-2xl will-change-transform',
                          isPoppedOutMinimized
                            ? 'border-foreground ring-1'
                            : 'min-h-64 resize shadow-lg',
                        ]
                  "
                >
                  <motion.div
                    ref="draggableHandleEl"
                    :layout="isDocked ? false : 'position'"
                    :layout-dependency="layoutDependency"
                    :transition="windowTransition"
                    class="flex shrink-0 items-center justify-between gap-2 p-2"
                    :class="{
                      'cursor-move': !isDocked,
                      'bg-sidebar': !isDocked && isPoppedOutMinimized,
                    }"
                    @dblclick="
                      !isDocked &&
                      (isPoppedOutMinimized = !isPoppedOutMinimized)
                    "
                  >
                    <span
                      class="ml-2 flex min-w-0 flex-1 items-center gap-2 font-medium"
                    >
                      <IconGripHorizontal v-if="!isDocked" class="shrink-0" />
                      <span
                        class="min-w-0 truncate"
                        :title="
                          isPoppedOut
                            ? poppedOutTitle || t('layouts.app.popout.title')
                            : t('pages.start.askAi')
                        "
                      >
                        {{
                          isPoppedOut
                            ? poppedOutTitle || t("layouts.app.popout.title")
                            : t("pages.start.askAi")
                        }}
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-2">
                      <!-- Actions belonging to whatever is docked -->
                      <!-- inside (e.g. PoppedOutChat's "open in a -->
                      <!-- native window"), teleported in beside -->
                      <!-- the window controls. -->
                      <span
                        id="popout-actions"
                        class="flex items-center empty:hidden"
                      ></span>
                      <!-- <ButtonGroup> -->
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <InputGroupButton
                              variant="ghost"
                              size="icon-sm"
                              @click="isDocked = !isDocked"
                            >
                              <IconPictureInPicture2 v-if="isDocked" />
                              <IconPanelRight v-else />
                            </InputGroupButton>
                          </TooltipTrigger>
                          <TooltipContent>{{
                            t(
                              isDocked
                                ? "layouts.app.popout.undock"
                                : "layouts.app.popout.dock"
                            )
                          }}</TooltipContent>
                        </Tooltip>
                        <Tooltip v-if="!isDocked">
                          <TooltipTrigger as-child>
                            <InputGroupButton
                              variant="ghost"
                              size="icon-sm"
                              @click="
                                isPoppedOutMinimized = !isPoppedOutMinimized
                              "
                            >
                              <IconPlus v-if="isPoppedOutMinimized" />
                              <IconMinus v-else />
                            </InputGroupButton>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              isPoppedOutMinimized
                                ? t("layouts.app.popout.expand")
                                : t("layouts.app.popout.minimize")
                            }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <InputGroupButton
                              variant="ghost"
                              size="icon-sm"
                              @click="closeChatWindow"
                            >
                              <IconX />
                            </InputGroupButton>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              t(
                                isDocked
                                  ? "layouts.app.sidebar.close"
                                  : "layouts.app.popout.close"
                              )
                            }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <!-- </ButtonGroup> -->
                    </span>
                  </motion.div>
                  <motion.div
                    v-show="isDocked || !isPoppedOutMinimized"
                    id="popout-dock"
                    :layout="isDocked ? false : 'position'"
                    :layout-dependency="layoutDependency"
                    :transition="windowTransition"
                    class="flex min-h-0 min-w-0 grow flex-col overflow-clip"
                  ></motion.div>
                </Draggable>
              </Motion>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @click="isDocked = !isDocked">
                <IconPictureInPicture2 v-if="isDocked" />
                <IconPanelRight v-else />
                {{
                  t(
                    isDocked
                      ? "layouts.app.popout.undock"
                      : "layouts.app.popout.dock"
                  )
                }}
              </ContextMenuItem>
              <ContextMenuItem
                v-if="!isDocked"
                @click="isPoppedOutMinimized = !isPoppedOutMinimized"
              >
                <IconMinus v-if="!isPoppedOutMinimized" />
                <IconPlus v-else />
                {{
                  isPoppedOutMinimized
                    ? t("layouts.app.popout.expand")
                    : t("layouts.app.popout.minimize")
                }}
              </ContextMenuItem>
              <ContextMenuItem @click="closeChatWindow">
                <IconX />
                {{
                  t(
                    isDocked
                      ? "layouts.app.sidebar.close"
                      : "layouts.app.popout.close"
                  )
                }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </Transition>
    </Teleport>
  </MotionConfig>
</template>
