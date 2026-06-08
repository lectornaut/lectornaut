<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconChevronRight,
  IconGift,
  IconMinus,
  IconPin,
  IconPinOff,
  IconPlus,
  IconX,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { storeToRefs } from "pinia"

const props = withDefaults(
  defineProps<{
    preview?: boolean
  }>(),
  {
    preview: false,
  }
)

const { t } = useI18n()
const { open, isMobile, setOpenMobile, toggleSidebar } = useSidebar()
const authStore = useAuthStore()
const { onboarding } = storeToRefs(authStore)
const layoutStore = useLayoutStore()
const { agentsSidebarVisible, sidebarPinned } = storeToRefs(layoutStore)

const isFullscreen = useIsFullscreen()

// In preview mode (e.g. settings preview) the sidebar must stay fully open and
// non-collapsible; otherwise pin → icon rail, unpin → slide-out offcanvas.
const collapsibleMode = computed<"none" | "icon" | "offcanvas">(() => {
  if (props.preview) return "none"
  return sidebarPinned.value ? "icon" : "offcanvas"
})

function closeSidebarOnMobile() {
  if (isMobile.value) setOpenMobile(false)
}

function togglePinned() {
  sidebarPinned.value = !sidebarPinned.value
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        :collapsible="collapsibleMode"
        variant="inset"
        class="shadow-muted-foreground/5 relative w-full p-1.25 pt-0 transition-none"
        data-tauri-drag-region="deep"
      >
        <!-- <Separator
          orientation="vertical"
          class="absolute left-3 h-full bg-red-400"
        />
        <Separator
          orientation="vertical"
          class="absolute right-3 h-full bg-red-400"
        /> -->
        <div
          v-if="open || props.preview"
          v-motion-fade-visible
          class="flex items-center justify-between gap-2 px-2 pt-2"
          :class="[{ 'pl-22': !props.preview && isTauri && !isFullscreen }]"
        >
          <!-- <Separator class="absolute -translate-x-full bg-red-400" /> -->
          <div class="flex items-center gap-2">
            <Notifications />
            <CommandKTrigger />
          </div>
          <div class="flex items-center gap-2">
            <BackForth />
          </div>
        </div>
        <SidebarHeader :class="[{ 'mt-10': !open && !props.preview }]">
          <TeamSwitcher />
          <WorkspaceSwitcher />
        </SidebarHeader>
        <SidebarContent @click.capture="closeSidebarOnMobile">
          <OverlayScrollbarsWrapper>
            <Navigation />
          </OverlayScrollbarsWrapper>
        </SidebarContent>
        <SidebarFooter v-if="onboarding">
          <SidebarMenu id="tour-onboarding">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Complete your onboarding"
                class="bg-primary text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground active:bg-destructive active:text-destructive-foreground"
                as-child
              >
                <RouterLink to="/welcome">
                  <IconGift />
                  <span class="truncate"> Complete onboarding </span>
                  <SidebarMenuBadge>
                    <IconChevronRight />
                  </SidebarMenuBadge>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarFooter>
          <Agents v-if="agentsSidebarVisible" />
          <Support />
          <SettingsMenu />
          <CreateMenu />
          <AccountMenu />
        </SidebarFooter>
      </Sidebar>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <template v-if="!isMobile">
        <ContextMenuItem @click="togglePinned">
          <IconPinOff v-if="sidebarPinned" />
          <IconPin v-else />
          {{
            sidebarPinned
              ? t("layouts.app.sidebar.unpin")
              : t("layouts.app.sidebar.pin")
          }}
        </ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <!--
        Single toggle item whose label depends on (a) which dimension is
        being toggled — desktop `open` vs mobile `openMobile` — and (b) the
        pin state, since closing-while-pinned just collapses to the icon
        rail rather than sliding the sidebar offscreen. `toggleSidebar`
        from shadcn's `useSidebar()` already routes to the right setter for
        the platform, so all this branch picks is the wording + icon.
      -->
      <ContextMenuItem @click="toggleSidebar">
        <IconPlus v-if="!isMobile && !open" />
        <IconMinus v-else-if="!isMobile && sidebarPinned" />
        <IconX v-else />
        {{
          !isMobile && !open
            ? t("layouts.app.sidebar.expand")
            : !isMobile && sidebarPinned
              ? t("layouts.app.sidebar.minimize")
              : t("layouts.app.sidebar.close")
        }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
