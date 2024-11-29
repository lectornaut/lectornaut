<template>
  <ul class="flex flex-col gap-5">
    <li class="flex items-start gap-3 leading-none">
      <icon-lucide-disc />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold">Record</span>
        <span class="text-muted-foreground">
          your expenses, income, transactions and never lose track of your
          money.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3 leading-none">
      <icon-lucide-message-circle-more />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold">Ask AI</span>
        <span class="text-muted-foreground">
          to categorize your transactions, track your spending, and more.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3 leading-none">
      <icon-lucide-pencil />
      <p class="leading-loose first-line:leading-none">
        <span class="font-semibold">Create</span>
        <span class="text-muted-foreground">
          your own categories, tags, and notes to keep your finances organized.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3 leading-none">
      <icon-lucide-leaf />
      <p class="leading-loose first-line:leading-none">
        <span class="text-muted-foreground">
          Commitment to
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >privacy</HoverCardTrigger
            ><HoverCardContent side="top" class="px-3 py-2">
              We don't sell your data. We don't show ads. We don't have
              investors. We are 100% bootstrapped.
            </HoverCardContent></HoverCard
          >,
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >longevity</HoverCardTrigger
            ><HoverCardContent side="top" class="px-3 py-2">
              We've been around since 2017. We are a small team of passionate
              people. We are profitable. We are indie. We are here to stay.
            </HoverCardContent></HoverCard
          >, and
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >beauty</HoverCardTrigger
            ><HoverCardContent side="top" class="px-3 py-2">
              We care about design. We care about user experience. We care about
              you. We are not a faceless corporation. We are committed to your
              happiness.
            </HoverCardContent></HoverCard
          >. Watch our backstory.
        </span>
      </p>
    </li>
    <li class="flex items-start gap-3 leading-none">
      <icon-lucide-heart />
      <p class="leading-loose first-line:leading-none">
        <span class="text-muted-foreground">
          Available on the
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >Mac</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <icon-bi-apple class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Download on the</p>
                  <span class="text-xl font-medium tracking-tight"
                    >App Store</span
                  >
                </div>
              </div>
            </HoverCardContent></HoverCard
          >,
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >Windows</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <icon-logos-microsoft-icon class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Get it from</p>
                  <span class="text-xl font-medium tracking-tight"
                    >Microsoft</span
                  >
                </div>
              </div>
            </HoverCardContent></HoverCard
          >,
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >Linux</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <icon-simple-icons-flathub class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Download on</p>
                  <span class="text-xl font-medium tracking-tight"
                    >Flathub</span
                  >
                </div>
              </div>
            </HoverCardContent></HoverCard
          >,
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >iOS</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <icon-logos-apple-app-store class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Download on the</p>
                  <span class="text-xl font-medium tracking-tight"
                    >App Store</span
                  >
                </div>
              </div>
            </HoverCardContent></HoverCard
          >,
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >Android</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <icon-logos-google-play-icon class="h-8 w-8" />
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
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >Web</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto px-3 py-2">
              <div class="flex items-center gap-3">
                <icon-material-symbols-circle class="h-8 w-8" />
                <div class="flex flex-col">
                  <p class="text-muted-foreground">Open</p>
                  <span class="text-xl font-medium tracking-tight">
                    template.app
                  </span>
                </div>
              </div>
            </HoverCardContent></HoverCard
          >. Loved by
          <HoverCard :open-delay="0" :close-delay="0"
            ><HoverCardTrigger class="cursor-help underline"
              >100K+ users</HoverCardTrigger
            ><HoverCardContent side="top" class="w-auto p-0">
              <WallOfLove />
            </HoverCardContent>
          </HoverCard>
          .
        </span>
      </p>
    </li>
  </ul>
</template>
