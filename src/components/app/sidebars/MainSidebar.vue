<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconBell, IconGift } from "@/data/icons"
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
        class="inset-y-12 h-[calc(100vh-var(--spacing-12)-var(--spacing-12))] overflow-clip rounded-r-2xl border-y border-r"
      >
        <SidebarHeader
          :class="{ 'mt-10': isTauri && isMobile && !isFullscreen }"
        >
          <SidebarMenu>
            <SidebarMenuItem>
              <TeamSwitcher />
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
        <SidebarRail class="my-13.5" />
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
