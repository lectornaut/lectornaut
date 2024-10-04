<script setup lang="ts">
const data = [
  {
    name: "Jan",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Feb",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Mar",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Apr",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "May",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
  {
    name: "Jun",
    total: Math.floor(Math.random() * 2000) + 500,
    predicted: Math.floor(Math.random() * 2000) + 500,
  },
]
</script>

<template>
  <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
    <Card class="col-span-1 flex flex-col">
      <CardHeader class="flex items-center justify-center">
        <CardTitle class="text-sm"> Balance </CardTitle>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <DonutChart
          index="name"
          :category="'total'"
          :data="data"
          :show-legend="false"
        />
      </CardContent>
      <CardFooter
        class="flex items-center justify-center text-muted-foreground"
      >
        20.1% from last month
        <icon-lucide-trending-up class="ml-2" />
      </CardFooter>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader class="flex items-center justify-center">
        <CardTitle class="text-sm"> Income </CardTitle>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <DonutChart
          index="name"
          :category="'total'"
          :data="data"
          :show-legend="false"
        />
      </CardContent>
      <CardFooter
        class="flex items-center justify-center text-muted-foreground"
      >
        180.1% from last month
        <icon-lucide-trending-up class="ml-2" />
      </CardFooter>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader class="flex items-center justify-center">
        <CardTitle class="text-sm"> Expenses </CardTitle>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <DonutChart
          index="name"
          :category="'total'"
          :data="data"
          :show-legend="false"
        />
      </CardContent>
      <CardFooter
        class="flex items-center justify-center text-muted-foreground"
      >
        19% from last month
        <icon-lucide-trending-up class="ml-2" />
      </CardFooter>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader class="flex items-center justify-center">
        <CardTitle class="text-sm"> Transactions </CardTitle>
      </CardHeader>
      <CardContent class="flex grow flex-col">
        <DonutChart
          index="name"
          :category="'total'"
          :data="data"
          :show-legend="false"
        />
      </CardContent>
      <CardFooter
        class="flex items-center justify-center text-muted-foreground"
      >
        21 since last hour
        <icon-lucide-trending-down class="ml-2" />
      </CardFooter>
    </Card>
  </div>
</template>
