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
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Balance </CardTitle>
          <icon-lucide-dollar-sign class="text-muted-foreground" />
        </div>
        <div class="truncate font-geist text-2xl font-bold">
          $<AnimatedCounter :value="45231.89" />
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end pb-0">
        <VisXYContainer height="80" :data="data">
          <VisStackedBar
            :x="lineX"
            :y="(d: Data) => d.subscription"
            :bar-padding="0.25"
            :rounded-corners="100"
            color="hsl(var(--primary))"
          />
        </VisXYContainer>
      </CardContent>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Income </CardTitle>
          <icon-lucide-arrow-down-left class="text-muted-foreground" />
        </div>
        <div class="truncate font-geist text-2xl font-bold">
          $<AnimatedCounter :value="2.35" />
        </div>
        <CardDescription>
          +180.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end pb-0">
        <VisXYContainer height="80" :data="data">
          <VisStackedBar
            :x="lineX"
            :y="(d: Data) => d.subscription"
            :bar-padding="0.25"
            :rounded-corners="100"
            color="hsl(var(--primary))"
          />
        </VisXYContainer>
      </CardContent>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Expenses </CardTitle>
          <icon-lucide-arrow-up-right class="text-muted-foreground" />
        </div>
        <div class="truncate font-geist text-2xl font-bold">
          $<AnimatedCounter :value="12234" />
        </div>
        <CardDescription>
          +19% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end pb-0">
        <VisXYContainer height="80" :data="data">
          <VisStackedBar
            :x="lineX"
            :y="(d: Data) => d.subscription"
            :bar-padding="0.25"
            :rounded-corners="100"
            color="hsl(var(--primary))"
          />
        </VisXYContainer>
      </CardContent>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Transactions </CardTitle>
          <icon-lucide-arrow-left-right class="text-muted-foreground" />
        </div>
        <div class="truncate font-geist text-2xl font-bold">
          <AnimatedCounter :value="57" />
        </div>
        <CardDescription>
          -21 since last hour
          <icon-lucide-trending-down class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end pb-0">
        <VisXYContainer height="80" :data="data">
          <VisStackedBar
            :x="lineX"
            :y="(d: Data) => d.subscription"
            :bar-padding="0.25"
            :rounded-corners="100"
            color="hsl(var(--primary))"
          />
        </VisXYContainer>
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
