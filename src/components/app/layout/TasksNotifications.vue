<script lang="ts" setup>
import {
  IconBell,
  IconBookmark,
  IconBookmarkCheck,
  IconCheck,
  IconCheckCheck,
  IconInbox,
  IconPin,
  IconPinOff,
  IconPlus,
} from "@/data/icons"
defineProps<{
  iconDisplay?: "icon" | "text"
}>()

const isDocked = ref(false)
</script>

<template>
  <NavigationMenu id="tour-tasks-notifications">
    <NavigationMenuList class="gap-2">
      <NavigationMenuItem>
        <NavigationMenuTrigger
          class="bg-transparent px-3"
          :class="{ 'gap-2': iconDisplay === 'text' }"
        >
          <IconInbox />
          <template v-if="iconDisplay === 'text'"> Tasks </template>
        </NavigationMenuTrigger>
        <NavigationMenuContent class="p-0">
          <Tabs default-value="inbox">
            <div class="w-96">
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <h3 class="flex items-center gap-2 font-semibold">
                  <Button
                    variant="ghost"
                    size="icon"
                    @click="isDocked = !isDocked"
                  >
                    <IconPin v-if="!isDocked" />
                    <IconPinOff v-else />
                  </Button>
                  Tasks
                </h3>
                <TabsList>
                  <TabsTrigger value="inbox">
                    <IconInbox />
                    Inbox
                  </TabsTrigger>
                  <TabsTrigger value="saved">
                    <IconBookmark />
                    Saved
                  </TabsTrigger>
                  <TabsTrigger value="done">
                    <IconCheck />
                    Done
                  </TabsTrigger>
                </TabsList>
              </div>
              <Separator />
              <div class="flex h-96 flex-col overflow-y-auto">
                <Tasks />
              </div>
              <Separator />
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <Button variant="outline" size="sm">
                  <IconPlus />
                  New task
                </Button>
                <div>
                  <TabsContent value="inbox">
                    <Button variant="ghost" size="sm">
                      <IconCheckCheck />
                      Mark all as done
                    </Button>
                  </TabsContent>
                  <TabsContent value="saved">
                    <Button variant="ghost" size="sm">
                      <IconCheckCheck />
                      Mark all as done
                    </Button>
                  </TabsContent>
                  <TabsContent value="done">
                    <Button variant="ghost" size="sm">
                      <IconBookmarkCheck />
                      Mark all as saved
                    </Button>
                  </TabsContent>
                </div>
              </div>
            </div>
          </Tabs>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuTrigger
          class="bg-transparent px-3"
          :class="{ 'gap-2': iconDisplay === 'text' }"
        >
          <IconBell />
          <template v-if="iconDisplay === 'text'"> Notifications </template>
        </NavigationMenuTrigger>
        <NavigationMenuContent class="p-0">
          <Tabs default-value="inbox">
            <div class="w-96">
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <h3 class="flex items-center gap-2 font-semibold">
                  <Button
                    variant="ghost"
                    size="icon"
                    @click="isDocked = !isDocked"
                  >
                    <IconPin v-if="!isDocked" />
                    <IconPinOff v-else />
                  </Button>
                  Notifications
                </h3>
                <TabsList>
                  <TabsTrigger value="inbox">
                    <IconInbox />
                    Inbox
                  </TabsTrigger>
                  <TabsTrigger value="saved">
                    <IconBookmark />
                    Saved
                  </TabsTrigger>
                  <TabsTrigger value="done">
                    <IconCheck />
                    Done
                  </TabsTrigger>
                </TabsList>
              </div>
              <Separator />
              <div class="flex h-96 flex-col overflow-y-auto">
                <Notifications />
              </div>
              <Separator />
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <Button variant="outline" size="sm">
                  <IconPlus />
                  New task
                </Button>
                <div>
                  <TabsContent value="inbox">
                    <Button variant="ghost" size="sm">
                      <IconCheckCheck />
                      Mark all as done
                    </Button>
                  </TabsContent>
                  <TabsContent value="saved">
                    <Button variant="ghost" size="sm">
                      <IconCheckCheck />
                      Mark all as done
                    </Button>
                  </TabsContent>
                  <TabsContent value="done">
                    <Button variant="ghost" size="sm">
                      <IconBookmarkCheck />
                      Mark all as saved
                    </Button>
                  </TabsContent>
                </div>
              </div>
            </div>
          </Tabs>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <Teleport v-if="isDocked" defer to="#left-dock" :disabled="!isDocked">
        <Tasks class="shadow-border relative shadow-[1px_0px]" />
      </Teleport>
    </NavigationMenuList>
  </NavigationMenu>
</template>
