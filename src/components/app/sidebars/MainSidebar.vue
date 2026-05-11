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
        class="shadow-muted-foreground/5 relative w-full p-0 transition-none!"
      >
        <div
          data-tauri-drag-region="deep"
          class="flex items-center justify-between gap-2 px-2 pt-2"
          :class="[{ 'pl-22': isTauri && !isFullscreen }]"
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
        <SidebarHeader>
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
          <Agents />
          <Separator />
          <Support />
          <SettingsMenu />
          <CreateMenu />
          <AccountMenu />
        </SidebarFooter>
      </Sidebar>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-50">
      <ContextMenuItem
        @click="isMobile ? setOpenMobile(false) : setOpen(false)"
      >
        <IconX /> {{ t("layouts.app.sidebar.close") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
