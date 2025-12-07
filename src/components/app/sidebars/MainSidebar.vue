<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { useIsFullscreen } from "@/composables/usePlatform"
import { IconGrid2X2 } from "@/data/icons"
import { menu } from "@/helpers/defaults"

const { open, setOpen, isMobile } = useSidebar()

const iconDisplay = computed({
  get: () => (open.value ? "text" : "icon"),
  set: (val) => setOpen(val === "text"),
})

const isFullscreen = useIsFullscreen()
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="icon"
        class="top-13 bottom-8 h-[calc(100vh-var(--spacing-14)-var(--spacing-8))]"
      >
        <SidebarHeader :class="{ 'mt-13': isMobile && !isFullscreen }">
          <SidebarMenu>
            <SidebarMenuItem class="flex h-9 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <SidebarMenuButton id="tour-apps-menu" tooltip="Menu">
                    <IconGrid2X2 />
                    Apps
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="right"
                  class="grid w-40 grid-cols-1 gap-1 p-1"
                >
                  <div
                    v-for="(item, index) in menu"
                    :key="index"
                    class="group/nav"
                  >
                    <DropdownMenuItem
                      class="group-has-[.router-link-active]/nav:bg-accent group-has-[.router-link-active]/nav:text-accent-foreground text-secondary-foreground size-full justify-start"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <Component :is="item.icon" :class="item.textColor" />
                        {{ item.title }}
                        <DropdownMenuShortcut>
                          {{ item.shortcut }}
                        </DropdownMenuShortcut>
                      </RouterLink>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <OverlayScrollbarsWrapper>
            <Navigation />
          </OverlayScrollbarsWrapper>
        </SidebarContent>
        <Separator />
        <SidebarFooter>
          <Agents />
          <Separator />
          <Support />
          <SettingsMenu />
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
