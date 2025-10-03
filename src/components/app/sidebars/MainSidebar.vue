<script setup lang="ts">
const iconDisplay = ref<"icon" | "text">("icon")
import { menu } from "@/helpers/defaults"
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="none"
        class="shadow-border relative z-40 w-[calc(var(--sidebar-width-icon))] shadow-[1px_0px]"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem class="flex h-9 items-center justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <SidebarMenuButton id="tour-apps-menu" tooltip="Menu">
                    <icon-lucide-grid-2-x-2 />
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
            <Navigation :icon-display="iconDisplay" />
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
      </Sidebar>
    </ContextMenuTrigger>
    <ContextMenuContent align="end" side="bottom">
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
