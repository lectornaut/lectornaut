<script lang="ts" setup>
import {
  IconLogosDiscord,
  IconLogosGoogle,
  IconLogosLinkedin,
  IconLogosMeta,
  IconLogosMicrosoftWindows,
  IconLogosNetflix,
  IconLogosPinterest,
  IconLogosReddit,
  IconLogosSlack,
  IconLogosSpotify,
  IconLogosTwitter,
  IconLogosZoom,
} from "@/data/icons"

const users = [
  {
    icon: IconLogosGoogle,
    name: "Google",
  },
  {
    icon: IconLogosMeta,
    name: "Meta",
  },
  {
    icon: IconLogosMicrosoftWindows,
    name: "Microsoft",
  },
  {
    icon: IconLogosNetflix,
    name: "Netflix",
  },
  {
    icon: IconLogosLinkedin,
    name: "LinkedIn",
  },
  {
    icon: IconLogosPinterest,
    name: "Pinterest",
  },
  {
    icon: IconLogosReddit,
    name: "Reddit",
  },
  {
    icon: IconLogosDiscord,
    name: "Discord",
  },
  {
    icon: IconLogosTwitter,
    name: "Twitter",
  },
  {
    icon: IconLogosSlack,
    name: "Slack",
  },
  {
    icon: IconLogosZoom,
    name: "Zoom",
  },
  {
    icon: IconLogosSpotify,
    name: "Spotify",
  },
]
</script>

<template>
  <div class="mx-8 my-4 grid grid-cols-1">
    <p class="text-muted-foreground mx-auto mb-16 max-w-4xl text-center">
      Powering the world's best teams, from startups to Fortune 500 companies.
    </p>
    <Carousel
      class="before:from-background after:from-background relative w-full before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-16 before:bg-gradient-to-r after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-16 after:bg-gradient-to-l focus-visible:outline-none"
      :opts="{
        align: 'start',
        loop: true,
      }"
    >
      <CarouselContent class="-ml-16">
        <CarouselItem
          v-for="(user, index) in users"
          :key="index"
          class="basis-auto pl-16"
        >
          <Component
            :is="user.icon"
            class="h-5 w-auto opacity-50 contrast-0 grayscale-100 invert-100"
          />
        </CarouselItem>
      </CarouselContent>
    </Carousel>
  </div>
</template>
