<script setup lang="ts">
import { navigationMenuTriggerStyle } from "@/components/ui/navigation-menu"
import {
  companyMenu,
  productsMenu,
  resourcesMenu,
  solutionsMenu,
} from "@/helpers/defaults"
import { isTauri } from "@/helpers/utilities"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

let unlisten: UnlistenFn | undefined

const isFullscreen = computedAsync(
  async () => (isTauri.value ? await getCurrentWindow().isFullscreen() : false),
  false
)

onMounted(async () => {
  if (isTauri.value) {
    unlisten = await getCurrentWindow().onResized(async () => {
      isFullscreen.value = await getCurrentWindow().isFullscreen()
    })
  }
})

onBeforeUnmount(() => {
  if (unlisten) {
    unlisten()
  }
})

const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()
</script>

<template>
  <div
    class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top fixed z-20 flex w-full shrink-0"
  >
    <div class="mx-auto flex w-full max-w-6xl items-center justify-center">
      <div
        class="bg-background/5 grid w-full grid-cols-3 gap-2 p-2 backdrop-blur-lg"
      >
        <div class="flex grow items-center justify-start gap-2">
          <ContextMenu>
            <ContextMenuTrigger as-child>
              <Button variant="ghost" as-child>
                <RouterLink to="/">
                  <Logo />
                  Lectornaut
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
          <NavigationMenu class="hidden md:flex">
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
                            <Component
                              :is="item.icon"
                              :class="item.style.text"
                            />
                          </div>
                          <div
                            class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                          >
                            <span>
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
                                <span>
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
                            <Component
                              :is="item.icon"
                              :class="item.style.text"
                            />
                          </div>
                          <div
                            class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                          >
                            <span>
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
                            <Component
                              :is="item.icon"
                              :class="item.style.text"
                            />
                          </div>
                          <div
                            class="bg-accent/50 flex w-full flex-col rounded-b-md p-4"
                          >
                            <span>
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
          <div class="hidden lg:flex">
            <ColorMode />
          </div>
          <div class="hidden lg:flex">
            <LanguageSwitcher />
          </div>
          <Button v-if="!isUserLoaded" variant="ghost" size="icon" disabled>
            <icon-lucide-loader class="animate-spin" />
          </Button>
          <Button v-else-if="user" as-child>
            <RouterLink to="/home">Open app</RouterLink>
          </Button>
          <EnterTrigger v-else>
            <Button variant="destructive" as-child>
              <RouterLink to="/enter">Get started</RouterLink>
            </Button>
          </EnterTrigger>
          <div class="flex md:hidden">
            <Sheet>
              <TooltipProvider>
                <Tooltip>
                  <SheetTrigger as-child>
                    <TooltipTrigger as-child>
                      <Button variant="ghost" size="icon">
                        <icon-lucide-menu />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent> Menu </TooltipContent>
                  </SheetTrigger>
                  <SheetContent
                    class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
                    :class="{ 'mt-13': isTauri && !isFullscreen }"
                  >
                    <SheetHeader>
                      <SheetTitle> Menu </SheetTitle>
                      <SheetDescription>
                        Access all the features and settings of Lectornaut.
                      </SheetDescription>
                    </SheetHeader>
                    <Separator />
                    <OverlayScrollbarsWrapper>
                      <div
                        class="flex grow flex-col overflow-auto overscroll-none"
                      >
                        <Accordion collapsible type="multiple" class="px-4">
                          <AccordionItem value="products">
                            <AccordionTrigger> Products </AccordionTrigger>
                            <AccordionContent>
                              <Button
                                v-for="item in productsMenu"
                                :key="item.id"
                              >
                                {{ item.title }}
                              </Button>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="solutions">
                            <AccordionTrigger> Solutions </AccordionTrigger>
                            <AccordionContent>
                              <div v-for="menu in solutionsMenu" :key="menu.id">
                                <Button
                                  v-for="item in menu.items"
                                  :key="item.id"
                                >
                                  {{ item.title }}
                                </Button>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="resources">
                            <AccordionTrigger> Resources </AccordionTrigger>
                            <AccordionContent>
                              <Button
                                v-for="item in resourcesMenu"
                                :key="item.id"
                              >
                                {{ item.title }}
                              </Button>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="company">
                            <AccordionTrigger> Company </AccordionTrigger>
                            <AccordionContent>
                              <Button
                                v-for="item in companyMenu"
                                :key="item.id"
                              >
                                {{ item.title }}
                              </Button>
                            </AccordionContent>
                          </AccordionItem>
                          <Button variant="ghost" as-child>
                            <RouterLink to="/pricing"> Pricing </RouterLink>
                          </Button>
                        </Accordion>
                      </div>
                    </OverlayScrollbarsWrapper>
                    <Separator />
                    <SheetFooter>
                      <div class="flex items-center justify-between gap-2">
                        <ColorMode />
                        <LanguageSwitcher />
                      </div>
                    </SheetFooter>
                  </SheetContent>
                </Tooltip>
              </TooltipProvider>
            </Sheet>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
