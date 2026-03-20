<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconChevronRight, IconGift } from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { storeToRefs } from "pinia"

const { open, setOpen, isMobile, setOpenMobile } = useSidebar()
const authStore = useAuthStore()
const { onboarding } = storeToRefs(authStore)

const iconDisplay = computed({
  get: () => (open.value ? "text" : "icon"),
  set: (val) => setOpen(val === "text"),
})

const isFullscreen = useIsFullscreen()

function closeSidebarOnMobile() {
  if (isMobile.value) setOpenMobile(false)
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="icon"
        class="shadow-muted-foreground/5 inset-y-12 h-[calc(100vh-var(--spacing-12)-var(--spacing-12))] overflow-clip rounded-r-lg border border-l-0 p-0 shadow"
      >
        <SidebarHeader
          data-tauri-drag-region
          :class="{ 'mt-12': isTauri && isMobile && !isFullscreen }"
        >
          <TeamSwitcher />
        </SidebarHeader>
        <Separator />
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
        <Separator />
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
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        Appearance
      </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="iconDisplay">
        <ContextMenuRadioItem value="icon"> Icons only </ContextMenuRadioItem>
        <ContextMenuRadioItem value="text">
          Icons and text
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
