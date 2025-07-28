<script setup lang="ts">
import AutoScroll from "embla-carousel-auto-scroll"
import DiscordIcon from "~icons/logos/discord"
import GoogleIcon from "~icons/logos/google"
import LinkedInIcon from "~icons/logos/linkedin"
import MetaIcon from "~icons/logos/meta"
import MicrosoftIcon from "~icons/logos/microsoft-windows"
import NetflixIcon from "~icons/logos/netflix"
import PinterestIcon from "~icons/logos/pinterest"
import RedditIcon from "~icons/logos/reddit"
import SlackIcon from "~icons/logos/slack"
import SpotifyIcon from "~icons/logos/spotify"
import TwitterIcon from "~icons/logos/twitter"
import ZoomIcon from "~icons/logos/zoom"

const users = [
  {
    logo: GoogleIcon,
    name: "Google",
  },
  {
    logo: MetaIcon,
    name: "Meta",
  },
  {
    logo: MicrosoftIcon,
    name: "Microsoft",
  },
  {
    logo: NetflixIcon,
    name: "Netflix",
  },
  {
    logo: LinkedInIcon,
    name: "LinkedIn",
  },
  {
    logo: PinterestIcon,
    name: "Pinterest",
  },
  {
    logo: RedditIcon,
    name: "Reddit",
  },
  {
    logo: DiscordIcon,
    name: "Discord",
  },
  {
    logo: TwitterIcon,
    name: "Twitter",
  },
  {
    logo: SlackIcon,
    name: "Slack",
  },
  {
    logo: ZoomIcon,
    name: "Zoom",
  },
  {
    logo: SpotifyIcon,
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
      :plugins="[
        AutoScroll({
          speed: 0.5,
          startDelay: 0,
          stopOnInteraction: false,
          stopOnMouseEnter: false,
        }),
      ]"
    >
      <CarouselContent class="-ml-16">
        <CarouselItem
          v-for="(user, index) in users"
          :key="index"
          class="basis-auto pl-16"
        >
          <Component
            :is="user.logo"
            class="h-5 w-auto opacity-50 contrast-0 grayscale-100 invert-100"
          />
        </CarouselItem>
      </CarouselContent>
    </Carousel>
  </div>
</template>
