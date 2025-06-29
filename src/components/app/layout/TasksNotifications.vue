<script setup lang="ts">
const isDocked = ref(false)
</script>

<template>
  <NavigationMenu id="tour-tasks-notifications">
    <NavigationMenuList class="gap-2">
      <NavigationMenuItem>
        <NavigationMenuTrigger class="px-3">
          <icon-lucide-inbox />
          <!-- <span> Tasks </span> -->
        </NavigationMenuTrigger>
        <NavigationMenuContent class="p-0">
          <Tabs default-value="saved">
            <div class="w-80">
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <h3 class="flex items-center gap-2 font-semibold">
                  <Button
                    variant="ghost"
                    size="icon"
                    @click="isDocked = !isDocked"
                  >
                    <icon-lucide-pin v-if="!isDocked" />
                    <icon-lucide-pin-off v-else />
                  </Button>
                  Tasks
                </h3>
                <TabsList>
                  <TabsTrigger value="saved">
                    <icon-lucide-bookmark />
                    <!-- Saved -->
                  </TabsTrigger>
                  <TabsTrigger value="done">
                    <icon-lucide-check />
                    <!-- Done -->
                  </TabsTrigger>
                </TabsList>
              </div>
              <Separator />
              <div class="flex h-80 flex-col overflow-y-auto">
                <Tasks />
              </div>
              <Separator />
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <Button variant="outline" size="sm">
                  <icon-lucide-plus />
                  New task
                </Button>
                <div>
                  <TabsContent value="saved">
                    <Button variant="ghost" size="sm">
                      <icon-lucide-check-check />
                      Mark all as done
                    </Button>
                  </TabsContent>
                  <TabsContent value="done">
                    <Button variant="ghost" size="sm">
                      <icon-lucide-bookmark-check />
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
        <NavigationMenuTrigger class="px-3">
          <icon-lucide-bell />
          <!-- <span> Notifications </span> -->
        </NavigationMenuTrigger>
        <NavigationMenuContent class="p-0">
          <Tabs default-value="saved">
            <div class="w-80">
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <h3 class="flex items-center gap-2 font-semibold">
                  <Button
                    variant="ghost"
                    size="icon"
                    @click="isDocked = !isDocked"
                  >
                    <icon-lucide-pin v-if="!isDocked" />
                    <icon-lucide-pin-off v-else />
                  </Button>
                  Notifications
                </h3>
                <TabsList>
                  <TabsTrigger value="saved">
                    <icon-lucide-bookmark />
                    <!-- Saved -->
                  </TabsTrigger>
                  <TabsTrigger value="done">
                    <icon-lucide-check />
                    <!-- Done -->
                  </TabsTrigger>
                </TabsList>
              </div>
              <Separator />
              <div class="flex h-80 flex-col overflow-y-auto">
                <Notifications />
              </div>
              <Separator />
              <div
                class="bg-background sticky top-0 z-10 flex items-center justify-between p-2"
              >
                <Button variant="outline" size="sm">
                  <icon-lucide-plus />
                  New task
                </Button>
                <div>
                  <TabsContent value="saved">
                    <Button variant="ghost" size="sm">
                      <icon-lucide-check-check />
                      Mark all as done
                    </Button>
                  </TabsContent>
                  <TabsContent value="done">
                    <Button variant="ghost" size="sm">
                      <icon-lucide-bookmark-check />
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
        <Tasks class="shadow-border z-10 shadow-[1px_0px_0px]" />
      </Teleport>
    </NavigationMenuList>
  </NavigationMenu>
</template>
