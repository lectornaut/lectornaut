<route lang="json">
{
  "meta": {
    "layout": false,
    "requiresUser": true,
    "title": "Agent Network"
  }
}
</route>

<script setup lang="ts">
import Autoplay from "embla-carousel-autoplay"
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures"
import Avatar from "vue-boring-avatars"

useHead({
  title: "Agent Network",
})

const categories = [
  { id: "featured", label: "Featured" },
  { id: "writing", label: "Writing" },
  { id: "productivity", label: "Productivity" },
  { id: "design", label: "Design" },
  { id: "development", label: "Development" },
  { id: "analysis", label: "Analysis" },
  { id: "automation", label: "Automation" },
  { id: "education", label: "Education" },
  { id: "communication", label: "Communication" },
  { id: "entertainment", label: "Entertainment" },
  { id: "finance", label: "Finance" },
  { id: "health", label: "Health" },
  { id: "travel", label: "Travel" },
  { id: "shopping", label: "Shopping" },
  { id: "social", label: "Social" },
  { id: "gaming", label: "Gaming" },
  { id: "news", label: "News" },
  { id: "music", label: "Music" },
  { id: "food", label: "Food" },
  { id: "sports", label: "Sports" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "other", label: "Other" },
]
</script>

<template>
  <div class="mx-auto grid grid-cols-1">
    <div class="flex max-w-6xl flex-col gap-16 p-16">
      <div class="mx-auto grid max-w-lg gap-8">
        <h1 class="text-center text-5xl font-semibold tracking-tight">
          Agent Network
        </h1>
        <p class="text-muted-foreground text-center">
          From data analysis to content creation, these agents are equipped with
          advanced capabilities to enhance your productivity.
        </p>
        <Command class="bg-card rounded-md border">
          <CommandInput
            placeholder="Search agents, functionalities, or categories..."
            class="border-none p-0 focus:border-inherit focus:ring-0"
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Trending Agents">
              <CommandItem value="calendar">
                <icon-lucide-calendar />
                <span>Calendar</span>
              </CommandItem>
              <CommandItem value="search">
                <icon-lucide-smile />
                <span>Search Emoji</span>
              </CommandItem>
              <CommandItem disabled value="calculator">
                <icon-lucide-calculator />
                <span>Calculator</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
      <div class="bg-background sticky top-0 z-10 py-2">
        <Tabs default-value="featured">
          <TabsList class="h-auto w-full">
            <Carousel
              class="w-full focus-visible:outline-none"
              :opts="{
                align: 'start',
              }"
              :plugins="[WheelGesturesPlugin()]"
            >
              <CarouselContent class="-ml-2 p-1">
                <CarouselItem
                  v-for="category in categories"
                  :key="category.id"
                  class="basis-auto pl-2"
                >
                  <TabsTrigger :value="category.id">
                    {{ category.label }}
                  </TabsTrigger>
                </CarouselItem>
              </CarouselContent>
              <CarouselPrevious />
              <CarouselNext />
            </Carousel>
          </TabsList>
        </Tabs>
      </div>
      <div class="">
        <h3 class="text-2xl font-bold tracking-tight">Featured</h3>
        <p class="text-muted-foreground">
          Explore our featured agents, showcasing their capabilities and
          functionalities.
        </p>
      </div>
      <div class="">
        <Carousel
          class="focus-visible:outline-none"
          :opts="{
            align: 'start',
            loop: true,
          }"
          :plugins="[
            WheelGesturesPlugin(),
            Autoplay({
              delay: 5000,
            }),
          ]"
        >
          <CarouselContent class="-ml-6">
            <CarouselItem
              v-for="(_, index) in 6"
              :key="index"
              class="basis-full pl-6 md:basis-1/2 lg:basis-1/3"
            >
              <Card class="h-full shadow-none">
                <CardHeader class="flex items-start gap-4">
                  <div class="flex flex-col gap-2">
                    <CardTitle class="flex items-center gap-3 text-base">
                      <Avatar
                        :size="20"
                        :square="false"
                        :title="false"
                        :name="`Agent ${index + 1}`"
                        variant="beam"
                        :colors="[
                          'var(--chart-1)',
                          'var(--chart-2)',
                          'var(--chart-3)',
                          'var(--chart-4)',
                          'var(--chart-5)',
                        ]"
                        class="rounded-full"
                      />
                      Agent {{ index + 1 }}
                    </CardTitle>
                    <CardDescription class="text-xs">
                      This is a description for Agent {{ index + 1 }}. It can
                      perform various tasks.
                    </CardDescription>
                    <div class="flex items-center justify-between gap-2">
                      <div
                        class="text-secondary-foreground flex items-center text-xs font-medium"
                      >
                        Agent Network
                      </div>
                      <div
                        class="text-secondary-foreground flex items-center gap-1 text-xs"
                      >
                        <icon-lucide-star /> 4.5
                        <span class="text-muted-foreground">(35k)</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent class="mt-auto">
                  <Carousel
                    class="focus-visible:outline-none"
                    :opts="{
                      align: 'start',
                      loop: true,
                    }"
                  >
                    <CarouselContent>
                      <CarouselItem>
                        <div
                          class="aspect-video rounded-lg bg-cover bg-center bg-no-repeat"
                          style="
                            background-image: url(&quot;https://framerusercontent.com/images/FLr1IxUSg9tK6K5eLtfdnzUfkk.png&quot;);
                          "
                        ></div>
                      </CarouselItem>
                      <CarouselItem>
                        <div
                          class="aspect-video rounded-lg bg-cover bg-center bg-no-repeat"
                          style="
                            background-image: url(&quot;https://framerusercontent.com/images/W6K9ukcWFSpamfFnCjmMmyYT4w.png&quot;);
                          "
                        ></div>
                      </CarouselItem>
                      <CarouselItem>
                        <div
                          class="aspect-video rounded-lg bg-cover bg-center bg-no-repeat"
                          style="
                            background-image: url(&quot;https://framerusercontent.com/images/08IkYUqVYvZTgOrPDmYUofFh7LU.png&quot;);
                          "
                        ></div>
                      </CarouselItem>
                    </CarouselContent>
                  </Carousel>
                </CardContent>
                <CardFooter class="grid grid-cols-2 gap-2">
                  <Button variant="outline">
                    <icon-lucide-briefcase /> Recruit
                  </Button>
                  <Button variant="secondary">
                    <icon-lucide-user-round-plus /> Add to Team
                  </Button>
                </CardFooter>
              </Card>
            </CarouselItem>
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </div>
      <div class="">
        <h3 class="text-2xl font-bold tracking-tight">Trending</h3>
        <p class="text-muted-foreground">
          Discover the most popular agents in our network, each with unique
          functionalities and capabilities.
        </p>
      </div>
      <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card v-for="index in 6" :key="index" class="h-full shadow-none">
          <CardHeader class="flex items-start gap-4">
            <div class="flex flex-col gap-2">
              <CardTitle class="flex items-center gap-3 text-base">
                <Avatar
                  :size="20"
                  :square="false"
                  :title="false"
                  :name="`Agent ${index + 1}`"
                  variant="beam"
                  :colors="[
                    'var(--chart-1)',
                    'var(--chart-2)',
                    'var(--chart-3)',
                    'var(--chart-4)',
                    'var(--chart-5)',
                  ]"
                  class="rounded-full"
                />
                Agent {{ index + 1 }}
              </CardTitle>
              <CardDescription class="text-xs">
                This is a description for Agent {{ index + 1 }}. It can perform
                various tasks.
              </CardDescription>
              <div class="flex items-center justify-between gap-2">
                <div
                  class="text-secondary-foreground flex items-center text-xs font-medium"
                >
                  Agent Network
                </div>
                <div
                  class="text-secondary-foreground flex items-center gap-1 text-xs"
                >
                  <icon-lucide-star /> 4.5
                  <span class="text-muted-foreground">(35k)</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardFooter class="grid grid-cols-2 gap-2">
            <Button variant="outline">
              <icon-lucide-briefcase /> Recruit
            </Button>
            <Button variant="secondary">
              <icon-lucide-user-round-plus /> Add to Team
            </Button>
          </CardFooter>
        </Card>
      </div>
      <div class="">
        <h3 class="text-2xl font-bold tracking-tight">By Agent Network</h3>
        <p class="text-muted-foreground">
          Agents created by the Agent Network team.
        </p>
      </div>
      <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card v-for="index in 6" :key="index" class="h-full shadow-none">
          <CardHeader class="flex items-start gap-4">
            <div class="flex flex-col gap-2">
              <CardTitle class="flex items-center gap-3 text-base">
                <Avatar
                  :size="20"
                  :square="false"
                  :title="false"
                  :name="`Agent ${index + 1}`"
                  variant="beam"
                  :colors="[
                    'var(--chart-1)',
                    'var(--chart-2)',
                    'var(--chart-3)',
                    'var(--chart-4)',
                    'var(--chart-5)',
                  ]"
                  class="rounded-full"
                />
                Agent {{ index + 1 }}
              </CardTitle>
              <CardDescription class="text-xs">
                This is a description for Agent {{ index + 1 }}. It can perform
                various tasks.
              </CardDescription>
              <div class="flex items-center justify-between gap-2">
                <div
                  class="text-secondary-foreground flex items-center text-xs font-medium"
                >
                  Agent Network
                </div>
                <div
                  class="text-secondary-foreground flex items-center gap-1 text-xs"
                >
                  <icon-lucide-star /> 4.5
                  <span class="text-muted-foreground">(35k)</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardFooter class="grid grid-cols-2 gap-2">
            <Button variant="outline">
              <icon-lucide-briefcase /> Recruit
            </Button>
            <Button variant="secondary">
              <icon-lucide-user-round-plus /> Add to Team
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  </div>
</template>
