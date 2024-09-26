<script setup lang="ts">
import { DrawerTrigger } from "@/components/ui/drawer"
</script>

<template>
  <Drawer>
    <DrawerTrigger as-child>
      <slot />
    </DrawerTrigger>
    <DrawerContent class="outline-none">
      <div class="mx-auto flex w-full max-w-sm flex-col">
        <DrawerHeader class="sr-only">
          <DrawerTitle>Enter Hyperjump</DrawerTitle>
          <DrawerDescription>
            Create an account or sign in to continue.
          </DrawerDescription>
        </DrawerHeader>
        <EnterContent />
        <DrawerFooter class="mb-safe-bottom">
          <EnterFooter />
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
</template>
