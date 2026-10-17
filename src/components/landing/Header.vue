<script lang="ts" setup>
import { navigationMenuTriggerStyle } from "@/components/ui/navigation-menu"
import {
  IconAi,
  IconArrowLeft,
  IconChevronRight,
  IconDownload,
  IconMenu,
  IconSignature,
  IconX,
} from "@/data/icons"
import {
  companyMenu,
  productsMenu,
  resourcesMenu,
  solutionsMenu,
} from "@/helpers/defaults"
import { useMacOSWindowControls } from "@/composables/useMacOSWindowControls"
import { useMacOSTrafficLightsVisible } from "@/composables/usePlatform"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()
const { t } = useI18n()
const macOSTrafficLightsVisible = useMacOSTrafficLightsVisible()
const windowControlsHeader = useTemplateRef<HTMLElement>("windowControlsHeader")
useMacOSWindowControls(windowControlsHeader)

const mobileSections = [
  "products",
  "solutions",
  "resources",
  "company",
] as const
type MobileSection = (typeof mobileSections)[number]

const mobileMenuOpen = ref(false)
const mobileSection = ref<MobileSection | null>(null)
const mobileNav = useTemplateRef<HTMLElement>("mobileNav")
const mobileBack = useTemplateRef<HTMLButtonElement>("mobileBack")
const route = useRoute()

const mobileTitle = computed(() =>
  mobileSection.value
    ? t(`landing.menu.${mobileSection.value}`)
    : t("landing.header.menu")
)

const mobileGroups = computed(() => {
  if (mobileSection.value === "solutions") {
    return solutionsMenu.map((group) => ({
      id: group.id,
      title: t(`landing.menu.solutionGroups.${group.id}`),
      items: group.items,
    }))
  }

  const items =
    mobileSection.value === "products"
      ? productsMenu
      : mobileSection.value === "resources"
        ? resourcesMenu
        : mobileSection.value === "company"
          ? companyMenu
          : []

  return [{ id: "links", title: "", items }]
})

const selectMobileSection = async (section: MobileSection | null) => {
  const previousSection = mobileSection.value
  mobileSection.value = section
  await nextTick()
  if (section) {
    mobileBack.value?.focus()
  } else {
    mobileNav.value
      ?.querySelector<HTMLElement>(`[data-section="${previousSection}"]`)
      ?.focus()
  }
}

watch(mobileMenuOpen, (open) => {
  if (open) mobileSection.value = null
})

watch(
  () => route.fullPath,
  () => (mobileMenuOpen.value = false)
)
</script>

<template>
  <div
    class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top fixed z-20 flex w-full shrink-0"
  >
    <div class="mx-auto flex w-full max-w-6xl items-center justify-center">
      <div
        ref="windowControlsHeader"
        data-tauri-drag-region="deep"
        class="bg-background/25 grid w-full grid-cols-3 gap-2 p-2 backdrop-blur-2xl"
        :class="{ 'pl-macos-window-controls': macOSTrafficLightsVisible }"
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
                <IconAi />
                {{ t("landing.header.copyIcon") }}
              </ContextMenuItem>
              <ContextMenuItem>
                <IconSignature />
                {{ t("landing.header.copyWordmark") }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>
                <IconDownload />
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
            <Drawer v-model:open="mobileMenuOpen" swipe-direction="right">
              <TooltipProvider>
                <Tooltip>
                  <DrawerTrigger as-child>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="size-11"
                        :aria-label="t('landing.header.menu')"
                      >
                        <IconMenu />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("landing.header.menu") }}
                    </TooltipContent>
                  </DrawerTrigger>
                  <DrawerContent class="items-center outline-hidden">
                    <DrawerHeader class="w-full max-w-sm shrink-0">
                      <div class="flex items-center gap-2">
                        <Button
                          v-if="mobileSection"
                          variant="ghost"
                          size="icon"
                          class="size-11"
                          as-child
                        >
                          <button
                            ref="mobileBack"
                            :aria-label="t('actions.goBack')"
                            @click="selectMobileSection(null)"
                          >
                            <IconArrowLeft />
                          </button>
                        </Button>
                        <DrawerTitle class="grow">{{
                          mobileTitle
                        }}</DrawerTitle>
                        <DrawerClose as-child>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-11"
                            :aria-label="t('actions.close')"
                          >
                            <IconX />
                          </Button>
                        </DrawerClose>
                      </div>
                      <DrawerDescription class="sr-only">
                        {{ t("landing.header.menuDescription") }}
                      </DrawerDescription>
                    </DrawerHeader>
                    <ScrollContainer
                      :key="mobileSection ?? 'menu'"
                      class="w-full max-w-sm overscroll-none scroll-smooth p-2"
                    >
                      <nav
                        ref="mobileNav"
                        :aria-label="mobileTitle"
                        class="flex shrink-0 flex-col gap-1"
                      >
                        <template v-if="!mobileSection">
                          <Button
                            v-for="section in mobileSections"
                            :key="section"
                            variant="ghost"
                            class="h-auto min-h-11 justify-between rounded-xl px-4 py-3"
                            :data-section="section"
                            @click="selectMobileSection(section)"
                          >
                            {{ t(`landing.menu.${section}`) }}
                            <IconChevronRight data-icon="inline-end" />
                          </Button>
                          <Button
                            variant="ghost"
                            class="h-auto min-h-11 justify-start rounded-xl px-4 py-3"
                            as-child
                          >
                            <RouterLink
                              to="/pricing"
                              @click="mobileMenuOpen = false"
                            >
                              {{ t("landing.menu.pricing") }}
                            </RouterLink>
                          </Button>
                        </template>
                        <template v-else>
                          <div
                            v-for="group in mobileGroups"
                            :key="group.id"
                            class="flex shrink-0 flex-col gap-1"
                          >
                            <p
                              v-if="group.title"
                              class="text-muted-foreground px-4 pt-4 pb-2 text-xs"
                            >
                              {{ group.title }}
                            </p>
                            <Button
                              v-for="item in group.items"
                              :key="item.id"
                              variant="ghost"
                              class="h-auto min-h-11 justify-start rounded-xl px-4 py-3 whitespace-normal"
                              as-child
                            >
                              <a
                                :href="item.url"
                                @click="mobileMenuOpen = false"
                              >
                                <Component
                                  :is="item.icon"
                                  data-icon="inline-start"
                                />
                                {{ t(`landing.menu.items.${item.id}.title`) }}
                              </a>
                            </Button>
                          </div>
                        </template>
                      </nav>
                    </ScrollContainer>
                    <DrawerFooter class="mb-safe-bottom w-full max-w-sm">
                      <div class="flex items-center justify-between gap-2">
                        <ColorMode />
                        <LanguageSwitcher />
                      </div>
                    </DrawerFooter>
                  </DrawerContent>
                </Tooltip>
              </TooltipProvider>
            </Drawer>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
