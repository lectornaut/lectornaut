<script setup lang="ts">
import { VisStackedBar, VisXYContainer } from "@unovis/vue"

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
  <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
    <Card class="col-span-1 flex flex-col">
      <CardHeader
        class="flex flex-row items-center justify-between space-y-0 pb-2"
      >
        <CardTitle class="text-sm"> Balance </CardTitle>
        <icon-lucide-dollar-sign class="text-muted-foreground" />
      </CardHeader>
      <CardContent class="flex grow flex-col pb-0">
        <div class="truncate font-geist text-2xl font-bold">
          $<AnimatedCounter :value="45231.89" />
        </div>
        <p class="mb-auto text-muted-foreground">
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
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
    <Card class="col-span-1 flex flex-col">
      <CardHeader
        class="flex flex-row items-center justify-between space-y-0 pb-2"
      >
        <CardTitle class="text-sm"> Income </CardTitle>
        <icon-lucide-arrow-down-left class="text-muted-foreground" />
      </CardHeader>
      <CardContent class="flex grow flex-col pb-0">
        <div class="truncate font-geist text-2xl font-bold">
          $<AnimatedCounter :value="2.35" />
        </div>
        <p class="mb-auto text-muted-foreground">
          +180.1% from last month
          <icon-lucide-trending-up class="ml-2" />
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
    <Card class="col-span-1 flex flex-col">
      <CardHeader
        class="flex flex-row items-center justify-between space-y-0 pb-2"
      >
        <CardTitle class="text-sm"> Expenses </CardTitle>
        <icon-lucide-arrow-up-right class="text-muted-foreground" />
      </CardHeader>
      <CardContent class="flex grow flex-col pb-0">
        <div class="truncate font-geist text-2xl font-bold">
          $<AnimatedCounter :value="12234" />
        </div>
        <p class="mb-auto text-muted-foreground">
          +19% from last month <icon-lucide-trending-up class="ml-2" />
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
    <Card class="col-span-1 flex flex-col">
      <CardHeader
        class="flex flex-row items-center justify-between space-y-0 pb-2"
      >
        <CardTitle class="text-sm"> Transactions </CardTitle>
        <icon-lucide-arrow-left-right class="text-muted-foreground" />
      </CardHeader>
      <CardContent class="flex grow flex-col pb-0">
        <div class="truncate font-geist text-2xl font-bold">
          <AnimatedCounter :value="57" />
        </div>
        <p class="mb-auto text-muted-foreground">
          -21 since last hour
          <icon-lucide-trending-down class="ml-2" />
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
    <Card class="flex flex-col md:col-span-2 lg:col-span-4">
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <Overview />
      </CardContent>
    </Card>
    <Card class="flex flex-col md:col-span-2 lg:col-span-2">
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription> You made 265 sales this month. </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <Recent />
      </CardContent>
    </Card>
    <Card class="flex flex-col md:col-span-2 lg:col-span-2">
      <CardHeader>
        <CardTitle>Goals</CardTitle>
        <CardDescription> You have 3 goals to achieve. </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <Goals />
      </CardContent>
    </Card>
  </div>
</template>
