<script setup lang="ts">
import { footerSections } from "@/helpers/defaults"
</script>

<template>
  <footer>
    <div class="mx-auto my-16 max-w-6xl p-4">
      <div
        class="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7"
      >
        <div class="col-span-full xl:col-span-1">
          <Button variant="ghost" size="icon" as-child>
            <RouterLink to="/">
              <Logo />
            </RouterLink>
          </Button>
        </div>
        <div
          v-for="{ title, links } in footerSections"
          :key="title"
          class="flex flex-col gap-4"
        >
          <h6 class="font-semibold">{{ title }}</h6>
          <ul class="flex flex-col gap-2">
            <li v-for="{ title: linkTitle, href } in links" :key="linkTitle">
              <RouterLink
                :to="href"
                class="text-muted-foreground hover:text-foreground"
              >
                {{ linkTitle }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <Separator />
    <FooterText class="mb-32" />
  </footer>
</template>
