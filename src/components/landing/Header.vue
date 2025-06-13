<script setup lang="ts">
import { navigationMenuTriggerStyle } from "@/components/ui/navigation-menu"
import { menu } from "@/helpers/defaults"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()
</script>

<template>
  <div
    class="fixed inset-x-0 top-0 z-20 mx-auto flex max-w-6xl items-center justify-center p-2"
  >
    <div class="grid grid-cols-3 gap-2 rounded-full p-2 backdrop-blur-lg">
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
          <NavigationMenuList class="gap-1">
            <NavigationMenuItem>
              <NavigationMenuTrigger class="bg-transparent">
                Products
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div class="grid w-lg grid-cols-3 gap-2">
                  <NavigationMenuLink
                    v-for="(item, index) in menu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="flex aspect-square size-full flex-col items-center justify-center gap-2 p-2"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <component
                          :is="item.icon"
                          class="size-8 rounded-full p-2"
                          :class="item.color"
                        />
                        {{ item.title }}
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
                <div class="grid w-lg grid-cols-3 gap-2">
                  <NavigationMenuLink
                    v-for="(item, index) in menu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="flex aspect-square size-full flex-col items-center justify-center gap-2 p-2"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <component
                          :is="item.icon"
                          class="size-8 rounded-full p-2"
                          :class="item.color"
                        />
                        {{ item.title }}
                      </RouterLink>
                    </Button>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger class="bg-transparent">
                Resources
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div class="grid w-lg grid-cols-3 gap-2">
                  <NavigationMenuLink
                    v-for="(item, index) in menu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="flex aspect-square size-full flex-col items-center justify-center gap-2 p-2"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <component
                          :is="item.icon"
                          class="size-8 rounded-full p-2"
                          :class="item.color"
                        />
                        {{ item.title }}
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
                    v-for="(item, index) in menu"
                    :key="index"
                    as-child
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      class="flex aspect-square size-full flex-col items-center justify-center gap-2 p-2"
                      as-child
                    >
                      <RouterLink :to="item.url">
                        <component
                          :is="item.icon"
                          class="size-8 rounded-full p-2"
                          :class="item.color"
                        />
                        {{ item.title }}
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
                href="/pricing"
              >
                Pricing
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </div>
      <div class="flex grow items-center justify-end gap-2">
        <ColorMode />
        <LanguageSwitcher />
        <Button v-if="!isUserLoaded" variant="ghost" disabled>
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
