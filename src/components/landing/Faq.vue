<script setup lang="ts">
import { DrawerTrigger, DrawerClose } from "@/components/ui/drawer"

const accordionItems = [
  {
    value: "item-1",
    title: "Is it accessible?",
    content: "Yes. It adheres to the WAI-ARIA design pattern.",
  },
  {
    value: "item-2",
    title: "Is it unstyled?",
    content:
      "Yes. It's unstyled by default, giving you freedom over the look and feel.",
  },
  {
    value: "item-3",
    title: "Can it be animated?",
    content: "Yes! You can use the transition prop to configure the animation.",
  },
]
</script>

<template>
  <Drawer>
    <DrawerTrigger as-child>
      <Button variant="secondary" class="rounded-2xl" size="lg"> FAQ </Button>
    </DrawerTrigger>
    <DrawerContent class="outline-hidden">
      <div class="mx-auto flex w-full max-w-sm flex-col">
        <DrawerHeader class="sr-only">
          <DrawerTitle> Frequently Asked Questions </DrawerTitle>
          <DrawerDescription>
            Get answers to common questions.
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
          <Button class="w-full" as-child>
            <RouterLink to="/enter" class="w-full"> Enter </RouterLink>
          </Button>
          <DrawerClose as-child>
            <Button variant="outline"> Close </Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>
