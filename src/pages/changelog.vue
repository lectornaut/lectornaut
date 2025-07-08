<script setup lang="ts">
definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Changelog",
})

export type ChangelogEntry = {
  version: string
  date: string
  title: string
  description: string
  items?: string[]
  image?: string
  button?: {
    url: string
    text: string
  }
}

const entries: ChangelogEntry[] = [
  {
    version: "Version 1.3.0",
    date: "15 November 2024",
    title: "Enhanced Analytics Dashboard",
    description:
      "We've completely redesigned our analytics dashboard to provide deeper insights and improved visualizations of your data.",
    items: [
      "Interactive data visualizations with real-time updates",
      "Customizable dashboard widgets",
      "Export analytics in multiple formats (CSV, PDF, Excel)",
      "New reporting templates for common use cases",
      "Improved data filtering and segmentation options",
    ],
    image:
      "https://deifkwefumgah.cloudfront.net/shadcnblocks/block/placeholder-aspect-video-1.svg",
    button: {
      url: "https://shadcnblocks.com",
      text: "Learn more",
    },
  },
  {
    version: "Version 1.2.5",
    date: "7 October 2024",
    title: "Mobile App Launch",
    description:
      "We're excited to announce the launch of our mobile application, available now on iOS and Android platforms.",
    items: [
      "Native mobile experience for on-the-go productivity",
      "Offline mode support for working without internet connection",
      "Push notifications for important updates",
      "Biometric authentication for enhanced security",
    ],
  },
  {
    version: "Version 1.2.1",
    date: "23 September 2024",
    title: "New features and improvements",
    description:
      "Here are the latest updates and improvements to our platform. We are always working to improve our platform and your experience.",
    items: [
      "Added new feature to export data",
      "Improved performance and speed",
      "Fixed minor bugs and issues",
      "Added new feature to import data",
    ],
    image:
      "https://deifkwefumgah.cloudfront.net/shadcnblocks/block/placeholder-aspect-video-1.svg",
  },
  {
    version: "Version 1.0.0",
    date: "31 August 2024",
    title: "First version of our platform",
    description:
      "Introducing a new platform to help you manage your projects and tasks. We are excited to launch our platform and help you get started. We are always working to improve our platform and your experience.",
    image:
      "https://deifkwefumgah.cloudfront.net/shadcnblocks/block/placeholder-aspect-video-1.svg",
    button: {
      url: "https://shadcnblocks.com",
      text: "Learn more",
    },
  },
]
</script>

<template>
  <div class="mx-auto my-32 grid max-w-6xl gap-10">
    <div class="space-y-6 text-center">
      <h2 class="font-serif text-6xl font-bold">Changelog</h2>
      <p class="text-secondary-foreground">
        Stay up to date with the latest changes and improvements to our
        platform.
      </p>
    </div>
    <div v-for="(entry, index) in entries" :key="index" class="px-8 py-4">
      <div class="relative flex flex-col gap-4 md:flex-row">
        <div
          class="top-32 flex h-min w-64 shrink-0 items-center gap-4 md:sticky"
        >
          <Badge variant="secondary" class="text-xs">
            {{ entry.version }}
          </Badge>
          <span class="text-muted-foreground text-xs font-medium">
            {{ entry.date }}
          </span>
        </div>
        <div class="flex flex-col">
          <h2
            class="text-foreground mb-4 text-lg leading-tight font-bold md:text-2xl"
          >
            {{ entry.title }}
          </h2>
          <p class="text-muted-foreground text-sm md:text-base">
            {{ entry.description }}
          </p>
          <ul
            v-if="entry.items && entry.items.length > 0"
            class="text-muted-foreground mt-4 ml-4 space-y-1.5 text-sm md:text-base"
          >
            <li
              v-for="(item, itemIndex) in entry.items"
              :key="itemIndex"
              class="list-disc"
            >
              {{ item }}
            </li>
          </ul>
          <img
            v-if="entry.image"
            :src="entry.image"
            :alt="`${entry.version} visual`"
            class="mt-8 w-full rounded-lg object-cover"
          />
          <Button
            v-if="entry.button"
            variant="link"
            class="mt-4 self-end"
            as-child
          >
            <a :href="entry.button.url" target="_blank">
              {{ entry.button.text }} <icon-lucide-arrow-up-right />
            </a>
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
