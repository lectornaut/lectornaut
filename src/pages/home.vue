<script setup lang="ts">
import { VisStackedBar, VisXYContainer } from "@unovis/vue"

useHead({
  title: "Home",
})

type Data = { revenue: number; subscription: number }

const data = computed(() => [
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
  {
    revenue: Math.floor(Math.random() * 2000) + 500,
    subscription: Math.floor(Math.random() * 2000) + 500,
  },
])

const lineX = (d: Data, i: number) => i
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-y-auto p-2">
    <Tabs default-value="today">
      <div class="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="today"> Today </TabsTrigger>
          <TabsTrigger value="week"> Week </TabsTrigger>
          <TabsTrigger value="month"> Month </TabsTrigger>
          <TabsTrigger value="year"> Year </TabsTrigger>
        </TabsList>
        <DateRangePicker />
      </div>
      <TabsContent
        value="today"
        class="transition duration-300 animate-in fade-in"
      >
        <div class="grid gap-2">
          <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <Card class="flex flex-col">
              <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
              >
                <CardTitle class="text-sm"> Balance </CardTitle>
                <icon-lucide-dollar-sign class="text-muted-foreground" />
              </CardHeader>
              <CardContent class="flex grow flex-col pb-0">
                <div class="truncate text-2xl font-bold">$45,231.89</div>
                <p class="mb-auto text-muted-foreground">
                  +20.1% from last month
                </p>
                <div class="mt-4">
                  <VisXYContainer height="80" :data="data">
                    <VisStackedBar
                      :x="lineX"
                      :y="(d: Data) => d.subscription"
                      :bar-padding="0.25"
                      :rounded-corners="100"
                      color="hsl(var(--primary))"
                    />
                  </VisXYContainer>
                </div>
              </CardContent>
            </Card>
            <Card class="flex flex-col">
              <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
              >
                <CardTitle class="text-sm"> Income </CardTitle>
                <icon-lucide-arrow-down-left class="text-muted-foreground" />
              </CardHeader>
              <CardContent class="flex grow flex-col pb-0">
                <div class="truncate text-2xl font-bold">$2.350</div>
                <p class="mb-auto text-muted-foreground">
                  +180.1% from last month
                </p>
                <div class="mt-4">
                  <VisXYContainer height="80" :data="data">
                    <VisStackedBar
                      :x="lineX"
                      :y="(d: Data) => d.subscription"
                      :bar-padding="0.25"
                      :rounded-corners="100"
                      color="hsl(var(--primary))"
                    />
                  </VisXYContainer>
                </div>
              </CardContent>
            </Card>
            <Card class="flex flex-col">
              <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
              >
                <CardTitle class="text-sm"> Expenses </CardTitle>
                <icon-lucide-arrow-up-right class="text-muted-foreground" />
              </CardHeader>
              <CardContent class="flex grow flex-col pb-0">
                <div class="truncate text-2xl font-bold">$12,234</div>
                <p class="mb-auto text-muted-foreground">
                  +19% from last month
                </p>
                <div class="mt-4">
                  <VisXYContainer height="80" :data="data">
                    <VisStackedBar
                      :x="lineX"
                      :y="(d: Data) => d.subscription"
                      :bar-padding="0.25"
                      :rounded-corners="100"
                      color="hsl(var(--primary))"
                    />
                  </VisXYContainer>
                </div>
              </CardContent>
            </Card>
            <Card class="flex flex-col">
              <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
              >
                <CardTitle class="text-sm"> Transactions </CardTitle>
                <icon-lucide-arrow-left-right class="text-muted-foreground" />
              </CardHeader>
              <CardContent class="flex grow flex-col pb-0">
                <div class="truncate text-2xl font-bold">573</div>
                <p class="mb-auto text-muted-foreground">
                  +201 since last hour
                </p>
                <div class="mt-4">
                  <VisXYContainer height="80" :data="data">
                    <VisStackedBar
                      :x="lineX"
                      :y="(d: Data) => d.subscription"
                      :bar-padding="0.25"
                      :rounded-corners="100"
                      color="hsl(var(--primary))"
                    />
                  </VisXYContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          <div class="grid gap-2 md:grid-cols-4 lg:grid-cols-8">
            <Card class="md:col-span-4 lg:col-span-8">
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent class="flex grow flex-col">
                <Overview />
              </CardContent>
            </Card>
            <Card class="md:col-span-4 lg:col-span-8">
              <CardHeader>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>
                  You made 265 sales this month.
                </CardDescription>
              </CardHeader>
              <CardContent class="flex grow flex-col">
                <Recent />
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>
      <TabsContent
        value="week"
        class="transition duration-300 animate-in fade-in"
      >
        Content
      </TabsContent>
      <TabsContent
        value="month"
        class="transition duration-300 animate-in fade-in"
      >
        Content
      </TabsContent>
      <TabsContent
        value="year"
        class="transition duration-300 animate-in fade-in"
      >
        Content
      </TabsContent>
    </Tabs>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "layout": "app"
  }
}
</route>
<!-- "requiresUser": true -->
