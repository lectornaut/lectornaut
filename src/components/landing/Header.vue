<script setup lang="ts">
import { navigationMenuTriggerStyle } from "@/components/ui/navigation-menu"
import {
  companyMenu,
  productsMenu,
  resourcesMenu,
  solutionsMenu,
} from "@/helpers/defaults"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()
</script>

<template>
  <div
    class="fixed inset-x-0 top-0 z-20 mx-auto flex max-w-6xl items-center justify-center p-2"
  >
    <div
      class="bg-background/5 grid grid-cols-3 gap-2 rounded-full p-2 backdrop-blur-lg"
    >
      <div class="flex grow items-center justify-start gap-2">
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <Button variant="ghost" as-child>
              <RouterLink to="/">
                <icon-mingcute-apple-intelligence-line />
                Hyperjump
              </RouterLink>
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              <icon-mingcute-ai-fill />
              Copy icon as .SVG
            </ContextMenuItem>
            <ContextMenuItem>
              <icon-mingcute-signature-fill />
              Copy wordmark as .SVG
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>
              <icon-mingcute-download-fill />
              Download brand kit as .ZIP
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <div class="flex grow items-center justify-center gap-2">
        <NavigationMenu>
          <NavigationMenuList class="gap-0.5">
            <NavigationMenuItem>
              <NavigationMenuTrigger class="bg-transparent">
                Products
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div class="grid w-lg grid-cols-2 gap-2">
                  <NavigationMenuLink
                    v-for="(item, index) in productsMenu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      class="h-full items-start gap-0 !p-0"
                      :class="item.style.grid"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <div
                          class="flex size-full items-start justify-start rounded-t-md p-4"
                          :class="item.style.bg"
                        >
                          <Component :is="item.icon" :class="item.style.text" />
                        </div>
                        <div
                          class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                        >
                          <span class="">
                            {{ item.title }}
                          </span>
                          <span class="text-muted-foreground text-xs">
                            {{ item.description }}
                          </span>
                        </div>
                      </RouterLink>
                    </Button>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger class="bg-transparent">
                Solutions
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div class="grid w-lg grid-cols-1 gap-2">
                  <div
                    v-for="(solution, idx) in solutionsMenu"
                    :key="idx"
                    class="flex flex-col gap-2"
                  >
                    <span
                      class="text-secondary-foreground px-2 pt-2 text-xs font-semibold"
                    >
                      {{ solution.title }}
                    </span>
                    <div class="grid grid-cols-2 gap-2">
                      <NavigationMenuLink
                        v-for="(item, index) in solution.items"
                        :key="index"
                        as-child
                      >
                        <Button
                          variant="ghost"
                          class="h-full items-start gap-0 !p-0"
                          :class="item.style.grid"
                          as-child
                        >
                          <RouterLink :to="item.url">
                            <div
                              class="flex size-full items-start justify-start rounded-t-md p-4"
                              :class="item.style.bg"
                            >
                              <Component
                                :is="item.icon"
                                :class="item.style.text"
                              />
                            </div>
                            <div
                              class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                            >
                              <span class="">
                                {{ item.title }}
                              </span>
                              <span class="text-muted-foreground text-xs">
                                {{ item.description }}
                              </span>
                            </div>
                          </RouterLink>
                        </Button>
                      </NavigationMenuLink>
                    </div>
                  </div>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger class="bg-transparent">
                Resources
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div class="grid w-lg grid-cols-2 gap-2">
                  <NavigationMenuLink
                    v-for="(item, index) in resourcesMenu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      class="h-full items-start gap-0 !p-0"
                      :class="item.style.grid"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <div
                          class="flex size-full items-start justify-start rounded-t-md p-4"
                          :class="item.style.bg"
                        >
                          <Component :is="item.icon" :class="item.style.text" />
                        </div>
                        <div
                          class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                        >
                          <span class="">
                            {{ item.title }}
                          </span>
                          <span class="text-muted-foreground text-xs">
                            {{ item.description }}
                          </span>
                        </div>
                      </RouterLink>
                    </Button>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger class="bg-transparent">
                Company
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div class="grid w-lg grid-cols-3 gap-2">
                  <NavigationMenuLink
                    v-for="(item, index) in companyMenu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      class="h-full items-start gap-0 !p-0"
                      :class="item.style.grid"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <div
                          class="flex size-full items-start justify-start rounded-t-md p-4"
                          :class="item.style.bg"
                        >
                          <Component :is="item.icon" :class="item.style.text" />
                        </div>
                        <div
                          class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                        >
                          <span class="">
                            {{ item.title }}
                          </span>
                          <span class="text-muted-foreground text-xs">
                            {{ item.description }}
                          </span>
                        </div>
                      </RouterLink>
                    </Button>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                :class="navigationMenuTriggerStyle()"
                class="bg-transparent"
                as-child
              >
                <RouterLink to="/pricing"> Pricing </RouterLink>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </div>
      <div class="flex grow items-center justify-end gap-2">
        <ColorMode />
        <LanguageSwitcher />
        <Button v-if="!isUserLoaded" variant="ghost" size="icon" disabled>
          <icon-lucide-loader class="animate-spin" />
        </Button>
        <Button v-else-if="user" variant="destructive" as-child>
          <RouterLink to="/home">Open app</RouterLink>
        </Button>
        <EnterTrigger v-else>
          <Button variant="destructive" as-child>
            <RouterLink to="/enter">Get started</RouterLink>
          </Button>
        </EnterTrigger>
      </div>
    </div>
  </div>
</template>
