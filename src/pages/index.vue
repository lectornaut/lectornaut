<script lang="ts" setup>
import { IconAiFill, IconCheck } from "@/data/icons"

definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Landing",
})

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto my-32 flex max-w-4xl flex-col gap-32">
    <Tabs default-value="you" class="grid w-full">
      <TabsList class="mx-auto">
        <TabsTrigger value="you"> {{ t("pages.home.forYou") }} </TabsTrigger>
        <TabsTrigger value="team"> {{ t("pages.home.forTeam") }} </TabsTrigger>
      </TabsList>
      <HeroText />
      <TabsContent
        value="you"
        class="animate-in fade-in transition"
        tabindex="-1"
      >
        <div class="mx-auto flex max-w-3xl flex-col gap-16 px-8 py-4">
          <Overview />
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <RouterLink to="/enter" class="group relative flex items-stretch">
              <Alert
                class="bg-background flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>{{ t("pages.home.personal") }}</span>
                  </div>
                  <Badge variant="secondary">
                    <span class="text-primary">
                      {{ t("pages.home.free") }}
                    </span>
                  </Badge>
                </AlertTitle>
                <AlertDescription
                  class="flex grow flex-col justify-between gap-4"
                >
                  <ul class="flex flex-col gap-2.5">
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.personal.notes") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.personal.ai") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.personal.storage") }}
                      </p>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </RouterLink>
            <RouterLink
              to="/enter"
              class="group after: relative flex items-stretch after:absolute after:-inset-0.5 after:-z-10 after:bg-linear-to-r after:from-lime-500 after:via-amber-500 after:to-pink-500 after:opacity-20 after:blur-2xl"
            >
              <Alert
                class="bg-background flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>{{ t("pages.home.professional") }}</span>
                    <Badge>
                      <IconAiFill />
                      AI
                    </Badge>
                  </div>
                  <Badge variant="secondary">
                    <span class="text-muted-foreground line-through">
                      $10/mo
                    </span>
                    <span class="text-primary">$8/mo</span>
                  </Badge>
                </AlertTitle>
                <AlertDescription
                  class="flex grow flex-col justify-between gap-4"
                >
                  <ul class="flex flex-col gap-2.5">
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.professional.notes") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.professional.ai") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.professional.storage") }}
                      </p>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </RouterLink>
          </div>
        </div>
      </TabsContent>
      <TabsContent
        value="team"
        class="animate-in fade-in transition"
        tabindex="-1"
      >
        <div class="mx-auto flex max-w-3xl flex-col gap-16 px-8 py-4">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <RouterLink
              to="/enter"
              class="group after: relative flex items-stretch after:absolute after:-inset-0.5 after:-z-10 after:bg-linear-to-r after:from-lime-500 after:via-amber-500 after:to-pink-500 after:opacity-20 after:blur-2xl"
            >
              <Alert
                class="bg-background flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>{{ t("pages.home.business") }}</span>
                    <Badge>
                      <IconAiFill />
                      {{ t("pages.home.ai") }}
                    </Badge>
                  </div>
                  <Badge variant="secondary">
                    <span class="text-muted-foreground line-through">
                      $16/user/mo
                    </span>
                    <span class="text-primary"> $14/user/mo </span>
                  </Badge>
                </AlertTitle>
                <AlertDescription
                  class="flex grow flex-col justify-between gap-4"
                >
                  <ul class="flex flex-col gap-2.5">
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.business.notes") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.business.ai") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.business.storage") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.business.team") }}
                      </p>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </RouterLink>
            <RouterLink to="/enter" class="group relative flex items-stretch">
              <Alert
                class="bg-background flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>{{ t("pages.home.enterprise") }}</span>
                    <Badge>
                      <IconAiFill />
                      {{ t("pages.home.ai") }}
                    </Badge>
                  </div>
                  <Badge variant="secondary">
                    <span class="text-primary">
                      {{ t("pages.home.contactUs") }}
                    </span>
                  </Badge>
                </AlertTitle>
                <AlertDescription
                  class="flex grow flex-col justify-between gap-4"
                >
                  <ul class="flex flex-col gap-2.5">
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.enterprise.notes") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.enterprise.ai") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.enterprise.storage") }}
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <IconCheck />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        {{ t("pages.home.features.enterprise.team") }}
                      </p>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </RouterLink>
          </div>
          <Overview />
        </div>
      </TabsContent>
    </Tabs>
    <Users />
  </div>
  <HeroImage />
</template>
