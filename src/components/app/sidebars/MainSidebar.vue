<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconApps, IconBell, IconChevronsUpDown, IconGift } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
import { collection, doc } from "firebase/firestore"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

const { open, setOpen, isMobile } = useSidebar()

const db = useFirestore()
const user = useCurrentUser()

const userDocRef = computed(() => {
  if (!user.value?.uid) return null
  return doc(collection(db, "users"), user.value.uid)
})

const { data: userData } = useDocument(userDocRef)

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
        <SidebarHeader
          :class="{ 'mt-13': isTauri && isMobile && !isFullscreen }"
        >
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <SidebarMenuButton
                    id="tour-apps-menu"
                    tooltip="Menu"
                    size="lg"
                    class="data-[state=open]:bg-accent"
                  >
                    <div
                      class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md"
                    >
                      <IconApps />
                    </div>
                    <div class="grid flex-1 text-left text-sm leading-tight">
                      <span class="truncate font-semibold"> Go to </span>
                      <span class="truncate text-xs"> My apps </span>
                    </div>
                    <IconChevronsUpDown />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="right"
                  class="grid w-40 grid-cols-1 gap-1 p-1"
                >
                  <div
                    v-for="(item, index) in defaultMenu"
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
        <SidebarFooter v-if="userData?.onboarding">
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
                    <Badge variant="destructive" size="sm">
                      <IconBell />
                    </Badge>
                  </SidebarMenuBadge>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
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
