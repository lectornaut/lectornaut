<script setup lang="ts">
const iconDisplay = ref<"icon" | "text">("icon")
import { menu } from "@/helpers/defaults"
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <Sidebar
        collapsible="none"
        class="shadow-border relative z-20 w-[calc(var(--sidebar-width-icon))] shadow-[1px_0px]"
      >
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem class="flex h-9 items-center justify-center">
              <Popover>
                <PopoverTrigger as-child>
                  <SidebarMenuButton id="tour-apps-menu" tooltip="Menu">
                    <icon-lucide-grid-2-x-2 />
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent align="start" side="right" class="w-40 p-2">
                  <div class="grid grid-cols-1 gap-2">
                    <div
                      v-for="(item, index) in menu"
                      :key="index"
                      class="group/nav"
                    >
                      <Button
                        variant="ghost"
                        class="group-has-[.router-link-active]/nav:bg-accent group-has-[.router-link-active]/nav:text-accent-foreground text-secondary-foreground size-full justify-start !p-2"
                        as-child
                      >
                        <RouterLink :to="item.url">
                          <Component
                            :is="item.icon"
                            class="size-8 rounded-full p-2"
                            :class="item.color"
                          />
                          {{ item.title }}
                        </RouterLink>
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
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
          <Members />
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
