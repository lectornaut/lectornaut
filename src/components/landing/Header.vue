<script lang="ts" setup>
import { navigationMenuTriggerStyle } from "@/components/ui/navigation-menu"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconAiFill,
  IconDownloadFill,
  IconMenu,
  IconSignatureFill,
} from "@/data/icons"
import {
  companyMenu,
  productsMenu,
  resourcesMenu,
  solutionsMenu,
} from "@/helpers/defaults"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const isFullscreen = useIsFullscreen()

const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()
const { t } = useI18n()
</script>

<template>
  <div
    class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top fixed z-20 flex w-full shrink-0"
  >
    <div class="mx-auto flex w-full max-w-6xl items-center justify-center">
      <div
        class="bg-background/25 grid w-full grid-cols-3 gap-2 p-2 backdrop-blur-lg"
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
                <IconAiFill />
                {{ t("landing.header.copyIcon") }}
              </ContextMenuItem>
              <ContextMenuItem>
                <IconSignatureFill />
                {{ t("landing.header.copyWordmark") }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>
                <IconDownloadFill />
                {{ t("landing.header.downloadBrandKit") }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
        <div class="flex grow items-center justify-center gap-2">
          <NavigationMenu class="hidden md:flex">
            <NavigationMenuList class="gap-0.5">
              <NavigationMenuItem>
                <NavigationMenuTrigger class="bg-transparent">
                  {{ t("landing.menu.products") }}
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
                        class="h-full items-start gap-0"
                        :class="item.style.grid"
                        as-child
                      >
                        <RouterLink :to="item.url">
                          <div
                            class="flex size-full items-start justify-start p-4"
                            :class="item.style.bg"
                          >
                            <Component
                              :is="item.icon"
                              :class="item.style.text"
                            />
                          </div>
                          <div class="bg-accent/50 flex w-full flex-col p-4">
                            <span>
                              {{
                                t("landing.menu.items." + item.id + ".title")
                              }}
                            </span>
                            <span>
                              {{
                                t(
                                  "landing.menu.items." +
                                    item.id +
                                    ".description"
                                )
                              }}
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
                  {{ t("landing.menu.solutions") }}
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
                        {{ t("landing.menu.solutionGroups." + solution.id) }}
                      </span>
                      <div class="grid grid-cols-2 gap-2">
                        <NavigationMenuLink
                          v-for="(item, index) in solution.items"
                          :key="index"
                          as-child
                        >
                          <Button
                            variant="ghost"
                            class="h-full items-start gap-0"
                            :class="item.style.grid"
                            as-child
                          >
                            <RouterLink :to="item.url">
                              <div
                                class="flex size-full items-start justify-start p-4"
                                :class="item.style.bg"
                              >
                                <Component
                                  :is="item.icon"
                                  :class="item.style.text"
                                />
                              </div>
                              <div
                                class="bg-accent/50 flex w-full flex-col p-4"
                              >
                                <span>
                                  {{ item.title }}
                                </span>
                                <span>
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
                  {{ t("landing.menu.resources") }}
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
                        class="h-full items-start gap-0"
                        :class="item.style.grid"
                        as-child
                      >
                        <RouterLink :to="item.url">
                          <div
                            class="flex size-full items-start justify-start p-4"
                            :class="item.style.bg"
                          >
                            <Component
                              :is="item.icon"
                              :class="item.style.text"
                            />
                          </div>
                          <div class="bg-accent/50 flex w-full flex-col p-4">
                            <span>
                              {{ item.title }}
                            </span>
                            <span>
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
                  {{ t("landing.menu.company") }}
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
                        class="h-full items-start gap-0"
                        :class="item.style.grid"
                        as-child
                      >
                        <RouterLink :to="item.url">
                          <div
                            class="flex size-full items-start justify-start p-4"
                            :class="item.style.bg"
                          >
                            <Component
                              :is="item.icon"
                              :class="item.style.text"
                            />
                          </div>
                          <div class="bg-accent/50 flex w-full flex-col p-4">
                            <span>
                              {{ item.title }}
                            </span>
                            <span>
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
                  <RouterLink to="/pricing">
                    {{ t("landing.menu.pricing") }}
                  </RouterLink>
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
            <Spinner />
          </Button>
          <Button v-else-if="user" as-child>
            <RouterLink to="/start">
              {{ t("landing.header.openApp") }}
            </RouterLink>
          </Button>
          <EnterTrigger v-else>
            <Button variant="destructive" as-child>
              <RouterLink to="/enter">
                {{ t("landing.header.getStarted") }}
              </RouterLink>
            </Button>
          </EnterTrigger>
          <div class="flex md:hidden">
            <Sheet>
              <TooltipProvider>
                <Tooltip>
                  <SheetTrigger as-child>
                    <TooltipTrigger as-child>
                      <Button variant="ghost" size="icon">
                        <IconMenu />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("landing.header.menu") }}
                    </TooltipContent>
                  </SheetTrigger>
                  <SheetContent
                    class="m-2 mt-[calc(var(--spacing-titlebar-height,0)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-xl border"
                    :class="{ 'mt-12': isTauri && !isFullscreen }"
                  >
                    <SheetHeader>
                      <SheetTitle> {{ t("landing.header.menu") }} </SheetTitle>
                      <SheetDescription>
                        {{ t("landing.header.menuDescription") }}
                      </SheetDescription>
                    </SheetHeader>
                    <Separator />
                    <OverlayScrollbarsWrapper>
                      <div
                        class="flex grow flex-col overflow-auto overscroll-none scroll-smooth"
                      >
                        <Accordion collapsible type="multiple" class="p-4">
                          <AccordionItem value="products">
                            <AccordionTrigger>
                              {{ t("landing.menu.products") }}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div class="flex flex-col gap-2 p-2">
                                <Item
                                  v-for="item in productsMenu"
                                  :key="item.id"
                                  class="p-2"
                                  as-child
                                >
                                  <RouterLink :to="item.url">
                                    <ItemMedia>
                                      <div
                                        class="flex size-10 shrink-0 items-center justify-center"
                                        :class="item.style.bg"
                                      >
                                        <Component
                                          :is="item.icon"
                                          :class="item.style.text"
                                        />
                                      </div>
                                    </ItemMedia>
                                    <ItemContent>
                                      <ItemTitle>
                                        {{
                                          t(
                                            "landing.menu.items." +
                                              item.id +
                                              ".title"
                                          )
                                        }}
                                      </ItemTitle>
                                      <ItemDescription class="text-xs">
                                        {{
                                          t(
                                            "landing.menu.items." +
                                              item.id +
                                              ".description"
                                          )
                                        }}
                                      </ItemDescription>
                                    </ItemContent>
                                  </RouterLink>
                                </Item>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="solutions">
                            <AccordionTrigger>
                              {{ t("landing.menu.solutions") }}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div class="flex flex-col gap-4">
                                <div
                                  v-for="group in solutionsMenu"
                                  :key="group.id"
                                  class="flex flex-col gap-2 p-2"
                                >
                                  <span
                                    class="text-muted-foreground px-2 text-xs font-medium tracking-wider uppercase"
                                  >
                                    {{
                                      t(
                                        "landing.menu.solutionGroups." +
                                          group.id
                                      )
                                    }}
                                  </span>
                                  <Item
                                    v-for="item in group.items"
                                    :key="item.id"
                                    class="p-2"
                                    as-child
                                  >
                                    <RouterLink :to="item.url">
                                      <ItemMedia>
                                        <div
                                          class="flex size-10 shrink-0 items-center justify-center"
                                          :class="item.style.bg"
                                        >
                                          <Component
                                            :is="item.icon"
                                            :class="item.style.text"
                                          />
                                        </div>
                                      </ItemMedia>
                                      <ItemContent>
                                        <ItemTitle>
                                          {{ item.title }}
                                        </ItemTitle>
                                        <ItemDescription class="text-xs">
                                          {{ item.description }}
                                        </ItemDescription>
                                      </ItemContent>
                                    </RouterLink>
                                  </Item>
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="resources">
                            <AccordionTrigger>
                              {{ t("landing.menu.resources") }}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div class="flex flex-col gap-2 p-2">
                                <Item
                                  v-for="item in resourcesMenu"
                                  :key="item.id"
                                  class="p-2"
                                  as-child
                                >
                                  <RouterLink :to="item.url">
                                    <ItemMedia>
                                      <div
                                        class="flex size-10 shrink-0 items-center justify-center"
                                        :class="item.style.bg"
                                      >
                                        <Component
                                          :is="item.icon"
                                          :class="item.style.text"
                                        />
                                      </div>
                                    </ItemMedia>
                                    <ItemContent>
                                      <ItemTitle>
                                        {{ item.title }}
                                      </ItemTitle>
                                      <ItemDescription class="text-xs">
                                        {{ item.description }}
                                      </ItemDescription>
                                    </ItemContent>
                                  </RouterLink>
                                </Item>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="company">
                            <AccordionTrigger>
                              {{ t("landing.menu.company") }}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div class="flex flex-col gap-2 p-2">
                                <Item
                                  v-for="item in companyMenu"
                                  :key="item.id"
                                  class="p-2"
                                  as-child
                                >
                                  <RouterLink :to="item.url">
                                    <ItemMedia>
                                      <div
                                        class="flex size-10 shrink-0 items-center justify-center"
                                        :class="item.style.bg"
                                      >
                                        <Component
                                          :is="item.icon"
                                          :class="item.style.text"
                                        />
                                      </div>
                                    </ItemMedia>
                                    <ItemContent>
                                      <ItemTitle>
                                        {{ item.title }}
                                      </ItemTitle>
                                      <ItemDescription class="text-xs">
                                        {{ item.description }}
                                      </ItemDescription>
                                    </ItemContent>
                                  </RouterLink>
                                </Item>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <Item as-child>
                            <RouterLink to="/pricing">
                              <ItemTitle>
                                {{ t("landing.menu.pricing") }}
                              </ItemTitle>
                            </RouterLink>
                          </Item>
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
