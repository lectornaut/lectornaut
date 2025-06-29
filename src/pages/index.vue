<script setup lang="ts">
definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Landing",
})
</script>

<template>
  <div class="mx-auto my-32 grid max-w-4xl gap-32">
    <Tabs default-value="you" class="grid w-full">
      <TabsList class="mx-auto">
        <TabsTrigger value="you"> For you </TabsTrigger>
        <TabsTrigger value="team"> For team </TabsTrigger>
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
            <RouterLink
              to="/enter"
              class="group relative flex items-stretch rounded-lg"
            >
              <Alert
                class="flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>Personal</span>
                  </div>
                  <Badge variant="secondary">
                    <span class="text-primary"> Free for everyone </span>
                  </Badge>
                </AlertTitle>
                <AlertDescription
                  class="flex grow flex-col justify-between gap-4"
                >
                  <ul class="flex flex-col gap-2.5">
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Unlimited notes, upto 10MB per note.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Basic AI model and features.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        100MB storage.
                      </p>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </RouterLink>
            <RouterLink
              to="/enter"
              class="group relative flex items-stretch rounded-lg after:absolute after:-inset-0.5 after:-z-10 after:rounded-xl after:bg-linear-to-r after:from-lime-500 after:via-amber-500 after:to-pink-500 after:opacity-20 after:blur-2xl"
            >
              <Alert
                class="flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>Professional</span>
                    <Badge>
                      <icon-mingcute-ai-fill />
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
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Unlimited notes.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Smarter AI with more features.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Limitless storage for images and files.
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
              class="group relative flex items-stretch rounded-lg after:absolute after:-inset-0.5 after:-z-10 after:rounded-xl after:bg-linear-to-r after:from-lime-500 after:via-amber-500 after:to-pink-500 after:opacity-20 after:blur-2xl"
            >
              <Alert
                class="flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>Business</span>
                    <Badge>
                      <icon-mingcute-ai-fill />
                      AI
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
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Unlimited notes, upto 100MB per note.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Smarter AI with more features.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        1GB storage.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Team collaboration features.
                      </p>
                    </li>
                  </ul>
                </AlertDescription>
              </Alert>
            </RouterLink>
            <RouterLink
              to="/enter"
              class="group relative flex items-stretch rounded-lg"
            >
              <Alert
                class="flex flex-col items-stretch gap-4 p-4 shadow-md transition group-hover:shadow-lg"
              >
                <AlertTitle class="flex justify-between gap-2">
                  <div class="flex items-center gap-1.5 font-semibold">
                    <span>Enterprise</span>
                    <Badge>
                      <icon-mingcute-ai-fill />
                      AI
                    </Badge>
                  </div>
                  <Badge variant="secondary">
                    <span class="text-primary"> Contact us </span>
                  </Badge>
                </AlertTitle>
                <AlertDescription
                  class="flex grow flex-col justify-between gap-4"
                >
                  <ul class="flex flex-col gap-2.5">
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Unlimited notes.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Smarter AI with more features.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Limitless storage for images and files.
                      </p>
                    </li>
                    <li class="flex items-start gap-2">
                      <icon-lucide-check />
                      <p
                        class="text-muted-foreground leading-loose first-line:leading-none"
                      >
                        Team collaboration features.
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
</template>
