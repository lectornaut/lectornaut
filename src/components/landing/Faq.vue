<script lang="ts" setup>
import { IconCircleHelp } from "@/data/icons"

const { t } = useI18n()

const accordionItems = computed(() => [
  {
    value: "item-1",
    title: t("landing.faq.items.accessible.title"),
    content: t("landing.faq.items.accessible.content"),
  },
  {
    value: "item-2",
    title: t("landing.faq.items.unstyled.title"),
    content: t("landing.faq.items.unstyled.content"),
  },
  {
    value: "item-3",
    title: t("landing.faq.items.animated.title"),
    content: t("landing.faq.items.animated.content"),
  },
])
</script>

<template>
  <Tooltip>
    <Drawer>
      <DrawerTrigger as-child>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon">
            <IconCircleHelp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ t("landing.faq.tooltip") }}
        </TooltipContent>
      </DrawerTrigger>
      <DrawerContent class="outline-hidden">
        <div class="mx-auto flex w-full max-w-sm flex-col">
          <DrawerHeader class="sr-only">
            <DrawerTitle> {{ t("landing.faq.title") }} </DrawerTitle>
            <DrawerDescription>
              {{ t("landing.faq.description") }}
            </DrawerDescription>
          </DrawerHeader>
          <Accordion type="single" collapsible class="p-4">
            <AccordionItem
              v-for="item in accordionItems"
              :key="item.value"
              :value="item.value"
            >
              <AccordionTrigger>
                {{ item.title }}
              </AccordionTrigger>
              <AccordionContent>
                {{ item.content }}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <DrawerFooter class="mb-safe-bottom">
            <Button as-child>
              <RouterLink to="/enter">
                {{ t("landing.faq.enter") }}
              </RouterLink>
            </Button>
            <DrawerClose as-child>
              <Button variant="outline"> {{ t("actions.close") }} </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  </Tooltip>
</template>
