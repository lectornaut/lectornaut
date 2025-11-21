<script lang="ts" setup>
import {
  IconApple,
  IconAppleAppStore,
  IconCircleSolid,
  IconDisc,
  IconFlathub,
  IconGooglePlayIcon,
  IconHeart,
  IconLeaf,
  IconMessageCircleMore,
  IconMicrosoftIcon,
  IconPencil,
} from "@/data/icons"
</script>

<template>
  <ul class="flex flex-col gap-5">
    <li class="flex items-start gap-3">
      <IconDisc />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold"> Agents </span>
        <span class="text-muted-foreground">
          are the future of work. They can automate tasks, make decisions, and
          collaborate with humans.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3">
      <IconPencil />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold"> Create </span>
        <span class="text-muted-foreground">
          tasks, assign them to your Agents, and track their progress. You can
          focus on what matters most.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3">
      <IconMessageCircleMore />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold"> Communicate </span>
        <span class="text-muted-foreground">
          with your Agents using natural language. No need to learn a new
          language or syntax.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3">
      <IconLeaf />
      <p class="leading-loose first-line:leading-none">
        <span class="text-muted-foreground">
          Commitment to
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              privacy
            </HoverCardTrigger>
            <HoverCardContent side="top" class="px-3 py-2">
              We don't sell your data. We don't show ads. We don't have
              investors. We are 100% bootstrapped.
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              longevity
            </HoverCardTrigger>
            <HoverCardContent side="top" class="px-3 py-2">
              We've been around since 2017. We are a small team of passionate
              people. We are profitable. We are indie. We are here to stay.
            </HoverCardContent>
          </HoverCard>
          , and
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              beauty
            </HoverCardTrigger>
            <HoverCardContent side="top" class="px-3 py-2">
              We care about design. We care about user experience. We care about
              you. We are not a faceless corporation. We are committed to your
              happiness.
            </HoverCardContent>
          </HoverCard>
          . Watch our backstory.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3">
      <IconHeart />
      <p class="leading-loose first-line:leading-none">
        <span class="text-muted-foreground">
          Available on the
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              Mac
            </HoverCardTrigger>
            <HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconApple class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Download on the</p>
                  <span class="text-xl font-medium tracking-tight"
                    >App Store</span
                  >
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              Windows
            </HoverCardTrigger>
            <HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconMicrosoftIcon class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Get it from</p>
                  <span class="text-xl font-medium tracking-tight"
                    >Microsoft</span
                  >
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              Linux
            </HoverCardTrigger>
            <HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconFlathub class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Download on</p>
                  <span class="text-xl font-medium tracking-tight"
                    >Flathub</span
                  >
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              iOS
            </HoverCardTrigger>
            <HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconAppleAppStore class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Download on the</p>
                  <span class="text-xl font-medium tracking-tight"
                    >App Store</span
                  >
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              Android
            </HoverCardTrigger>
            <HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconGooglePlayIcon class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Get it on</p>
                  <span class="text-xl font-medium tracking-tight"
                    >Google Play</span
                  >
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          and
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              Web
            </HoverCardTrigger>
            <HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconCircleSolid class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Open</p>
                  <span class="text-xl font-medium tracking-tight">
                    template.app
                  </span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          . Loved by
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              100K + users</HoverCardTrigger
            >
            <HoverCardContent side="top" class="w-auto p-0">
              <WallOfLove />
            </HoverCardContent>
          </HoverCard>
          .
        </span>
      </p>
    </li>
  </ul>
</template>
