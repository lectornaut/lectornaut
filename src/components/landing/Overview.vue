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

const { t } = useI18n()
</script>

<template>
  <ul class="flex flex-col gap-2">
    <li class="flex items-center gap-3">
      <IconDisc />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold">
          {{ t("landing.overview.agentsTitle") }}
        </span>
        <span class="text-muted-foreground">
          {{ t("landing.overview.agentsDescription") }}
        </span>
      </p>
    </li>
    <li class="flex items-center gap-3">
      <IconPencil />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold">
          {{ t("landing.overview.createTitle") }}
        </span>
        <span class="text-muted-foreground">
          {{ t("landing.overview.createDescription") }}
        </span>
      </p>
    </li>
    <li class="flex items-center gap-3">
      <IconMessageCircleMore />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold">
          {{ t("landing.overview.communicateTitle") }}
        </span>
        <span class="text-muted-foreground">
          {{ t("landing.overview.communicateDescription") }}
        </span>
      </p>
    </li>
    <li class="flex items-center gap-3">
      <IconLeaf />
      <p class="leading-loose first-line:leading-none">
        <span class="text-muted-foreground">
          {{ t("landing.overview.commitmentPrefix") }}
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.privacy") }}
            </HoverCardTrigger>
            <HoverCardContent class="px-3 py-2">
              {{ t("landing.overview.privacyTooltip") }}
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.longevity") }}
            </HoverCardTrigger>
            <HoverCardContent class="px-3 py-2">
              {{ t("landing.overview.longevityTooltip") }}
            </HoverCardContent>
          </HoverCard>
          , and
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.beauty") }}
            </HoverCardTrigger>
            <HoverCardContent class="px-3 py-2">
              {{ t("landing.overview.beautyTooltip") }}
            </HoverCardContent>
          </HoverCard>
          . {{ t("landing.overview.watchBackstory") }}
        </span>
      </p>
    </li>
    <li class="flex items-center gap-3">
      <IconHeart />
      <p class="leading-loose first-line:leading-none">
        <span class="text-muted-foreground">
          {{ t("landing.overview.availableOn") }}
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.mac") }}
            </HoverCardTrigger>
            <HoverCardContent class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconApple class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">
                    {{ t("landing.overview.downloadOnThe") }}
                  </p>
                  <span class="text-xl font-medium tracking-tight">{{
                    t("landing.overview.appStore")
                  }}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.windows") }}
            </HoverCardTrigger>
            <HoverCardContent class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconMicrosoftIcon class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">
                    {{ t("landing.overview.getItFrom") }}
                  </p>
                  <span class="text-xl font-medium tracking-tight">{{
                    t("landing.overview.microsoft")
                  }}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.linux") }}
            </HoverCardTrigger>
            <HoverCardContent class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconFlathub class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">
                    {{ t("landing.overview.downloadOn") }}
                  </p>
                  <span class="text-xl font-medium tracking-tight">{{
                    t("landing.overview.flathub")
                  }}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.ios") }}
            </HoverCardTrigger>
            <HoverCardContent class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconAppleAppStore class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">
                    {{ t("landing.overview.downloadOnThe") }}
                  </p>
                  <span class="text-xl font-medium tracking-tight">{{
                    t("landing.overview.appStore")
                  }}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          ,
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.android") }}
            </HoverCardTrigger>
            <HoverCardContent class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconGooglePlayIcon class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">
                    {{ t("landing.overview.getItOn") }}
                  </p>
                  <span class="text-xl font-medium tracking-tight">{{
                    t("landing.overview.googlePlay")
                  }}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          and
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.web") }}
            </HoverCardTrigger>
            <HoverCardContent class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <IconCircleSolid class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">
                    {{ t("landing.overview.open") }}
                  </p>
                  <span class="text-xl font-medium tracking-tight">
                    {{ t("landing.overview.templateApp") }}
                  </span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
          . {{ t("landing.overview.lovedBy") }}
          <HoverCard :open-delay="0" :close-delay="0">
            <HoverCardTrigger class="cursor-help underline">
              {{ t("landing.overview.users") }}</HoverCardTrigger
            >
            <HoverCardContent class="w-auto">
              <WallOfLove />
            </HoverCardContent>
          </HoverCard>
          .
        </span>
      </p>
    </li>
  </ul>
</template>
