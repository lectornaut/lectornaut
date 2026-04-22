<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconChevronRight, IconGift, IconX } from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { storeToRefs } from "pinia"

const { t } = useI18n()
const { setOpen, isMobile, setOpenMobile } = useSidebar()
const authStore = useAuthStore()
const { onboarding } = storeToRefs(authStore)

const isFullscreen = useIsFullscreen()

function closeSidebarOnMobile() {
  if (isMobile.value) setOpenMobile(false)
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="offcanvas"
        variant="inset"
        class="shadow-muted-foreground/5 relative w-full"
      >
        <SidebarHeader
          data-tauri-drag-region
          :class="{ 'mt-13': isTauri && isMobile && !isFullscreen }"
        >
          <div
            class="flex items-center justify-between gap-2"
            :class="{ 'pl-20': isTauri && !isFullscreen }"
          >
            <div class="flex gap-2">
              <SyncIndicator />
              <Notifications />
              <CommandKTrigger />
            </div>
            <div class="flex gap-2">
              <BackForth />
            </div>
          </div>
          <TeamSwitcher />
          <WorkspaceSwitcher />
        </SidebarHeader>
        <SidebarContent @click.capture="closeSidebarOnMobile">
          <OverlayScrollbarsWrapper data-tauri-drag-region>
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
        <SidebarFooter data-tauri-drag-region>
          <Agents />
          <Separator />
          <Support />
          <SettingsMenu />
          <CreateMenu />
          <AccountMenu />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-46">
      <ContextMenuItem @click="setOpen(false)">
        <IconX /> {{ t("layouts.app.sidebar.close") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
