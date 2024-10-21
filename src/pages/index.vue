<script setup lang="ts">
useHead({
  title: "Landing",
})
</script>

<template>
  <div class="flex grow flex-col">
    <Header />
    <div
      class="mx-auto mb-44 mt-12 flex w-full max-w-2xl grow flex-col items-center"
    >
      <Tabs default-value="personal" class="flex flex-col items-center">
        <TabsList class="m-4 rounded-xl">
          <TabsTrigger class="rounded-lg px-3 py-2" value="personal">
            Personal
          </TabsTrigger>
          <TabsTrigger class="rounded-lg px-3 py-2" value="team">
            <div class="flex items-center gap-1.5">Team</div>
          </TabsTrigger>
        </TabsList>
        <div class="flex h-full w-full grow flex-col items-center">
          <div class="mx-auto w-full max-w-2xl px-8 py-4">
            <svg
              preserveAspectRatio="xMinYMin"
              width="100%"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 100 14"
            >
              <text
                xmlns="http://www.w3.org/2000/svg"
                x="50%"
                y="50%"
                fill="transparent"
                dominant-baseline="middle"
                text-anchor="middle"
                text-rendering="geometricPrecision"
                stroke-width="0"
                class="fill-primary font-instrument tracking-tighter"
              >
                You can't
                <tspan alignment-baseline="middle" class="italic">
                  improve
                </tspan>
              </text>
            </svg>
            <svg
              preserveAspectRatio="xMinYMin"
              width="100%"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 100 14"
            >
              <text
                xmlns="http://www.w3.org/2000/svg"
                x="50%"
                y="50%"
                fill="transparent"
                dominant-baseline="middle"
                text-anchor="middle"
                text-rendering="geometricPrecision"
                stroke-width="0"
                class="fill-primary font-instrument tracking-tighter"
              >
                what you can't
                <tspan alignment-baseline="middle" class="italic">
                  measure
                </tspan>
              </text>
            </svg>
          </div>
        </div>
        <TabsContent
          value="personal"
          class="transition duration-200 animate-in fade-in"
          tabindex="-1"
        >
          <div class="max-w-d mt-0 w-full rounded-2xl px-8 py-4">
            <Features />
            <div class="mt-12 flex w-full flex-col gap-4 sm:flex-row">
              <RouterLink
                to="/enter"
                class="relative flex w-full rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Alert
                  class="z-10 flex flex-col gap-2 rounded-xl shadow-lg transition hover:shadow-xl"
                >
                  <AlertTitle class="flex justify-between gap-2">
                    <span class="flex items-center gap-1.5 font-semibold">
                      <span class="text-sm">Free</span>
                    </span>
                  </AlertTitle>
                  <AlertDescription class="flex flex-col gap-4">
                    <ul class="flex flex-col gap-2.5">
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Unlimited notes, upto 10MB per note.
                        </p>
                      </li>
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Basic AI model and features.
                        </p>
                      </li>
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
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
                class="relative flex w-full rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div
                  className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-lime-500 opacity-35 via-amber-500 to-pink-500 blur-2xl"
                ></div>
                <Alert
                  class="z-10 flex flex-col gap-2 rounded-xl shadow-lg transition hover:shadow-xl"
                >
                  <AlertTitle class="flex justify-between gap-2">
                    <span class="flex items-center gap-1.5 font-semibold">
                      <span class="text-sm">Pro</span>
                      <Badge class="gap-0.5 rounded-sm px-1 py-0">
                        <icon-mingcute-ai-fill />
                        AI
                      </Badge>
                    </span>
                    <Badge
                      variant="secondary"
                      class="gap-1 truncate rounded-sm px-1 py-0 font-medium"
                    >
                      <span class="truncate text-muted-foreground line-through">
                        $10/mo
                      </span>
                      <span class="truncate text-primary">$50/one-time</span>
                    </Badge>
                  </AlertTitle>
                  <AlertDescription class="flex flex-col gap-4">
                    <ul class="flex flex-col gap-2.5">
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Unlimited notes.
                        </p>
                      </li>
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Smarter AI with more features.
                        </p>
                      </li>
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
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
          class="transition duration-200 animate-in fade-in"
          tabindex="-1"
        >
          <div class="max-w-d mt-0 w-full rounded-2xl px-8 py-4">
            <div
              class="mx-auto mb-16 flex w-full max-w-sm flex-col gap-4 sm:flex-row"
            >
              <RouterLink
                to="/enter"
                class="relative flex w-full rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div
                  className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-lime-500 opacity-35 via-amber-500 to-pink-500 blur-2xl"
                ></div>
                <Alert
                  class="z-10 flex flex-col gap-2 rounded-xl shadow-lg transition hover:shadow-xl"
                >
                  <AlertTitle class="flex justify-between gap-2">
                    <span class="flex items-center gap-1.5 font-semibold">
                      <span class="text-sm">Team</span>
                      <Badge class="gap-0.5 rounded-sm px-1 py-0">
                        <icon-mingcute-ai-fill />
                        AI
                      </Badge>
                    </span>
                    <Badge
                      variant="secondary"
                      class="gap-1 truncate rounded-sm px-1 py-0 font-medium"
                    >
                      <span class="truncate text-muted-foreground line-through">
                        $8/user/mo
                      </span>
                      <span class="truncate text-primary">$5/user/mo</span>
                    </Badge>
                  </AlertTitle>
                  <AlertDescription class="flex flex-col gap-4">
                    <ul class="flex flex-col gap-2.5">
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Unlimited notes.
                        </p>
                      </li>
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Smarter AI with more features.
                        </p>
                      </li>
                      <li class="flex items-start gap-2 leading-none">
                        <icon-lucide-check />
                        <p
                          class="leading-loose text-muted-foreground first-line:leading-none"
                        >
                          Limitless storage for images and files.
                        </p>
                      </li>
                    </ul>
                    <Button class="rounded-lg">
                      Get Template App for Teams
                    </Button>
                  </AlertDescription>
                </Alert>
              </RouterLink>
            </div>
            <Features />
          </div>
        </TabsContent>
      </Tabs>
    </div>
    <Footer />
  </div>
</template>

<route lang="json">
{
  "meta": {
    "requiresGuest": true
  }
}
</route>
