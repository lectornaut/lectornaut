<script lang="ts" setup>
const dataDonut = [
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

const dataBar = computed(() => [
  {
    Name: "Jan",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Feb",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Mar",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Apr",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "May",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Jun",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Jul",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Aug",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Sep",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Oct",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Nov",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
  {
    Name: "Dec",
    Income: Math.floor(Math.random() * 2000) + 500,
    Expenses: Math.floor(Math.random() * 2000) + 500,
  },
])
</script>

<template>
  <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Balance </CardTitle>
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end">
        <DonutChart
          index="name"
          :category="'total'"
          :data="dataDonut"
          :show-legend="false"
        />
      </CardContent>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Income </CardTitle>
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end">
        <DonutChart
          index="name"
          :category="'total'"
          :data="dataDonut"
          :show-legend="false"
        />
      </CardContent>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Expenses </CardTitle>
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end">
        <DonutChart
          index="name"
          :category="'total'"
          :data="dataDonut"
          :show-legend="false"
        />
      </CardContent>
    </Card>
    <Card class="col-span-1 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Transactions </CardTitle>
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end">
        <DonutChart
          index="name"
          :category="'total'"
          :data="dataDonut"
          :show-legend="false"
        />
      </CardContent>
    </Card>
    <Card class="col-span-2 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Transactions </CardTitle>
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end">
        <BarChart
          :data="dataBar"
          class="h-auto w-full"
          type="stacked"
          index="Name"
          :categories="['Income', 'Expenses']"
          :show-grid-line="false"
          :rounded-corners="100"
          :show-legend="false"
          :y-formatter="
            (tick, i) => {
              return typeof tick === 'number'
                ? `$${new Intl.NumberFormat('us').format(tick).toString()}`
                : ''
            }
          "
        />
      </CardContent>
    </Card>
    <Card class="col-span-2 flex flex-col">
      <CardHeader>
        <div class="flex grow items-center justify-between">
          <CardTitle class="text-base"> Transactions </CardTitle>
        </div>
        <CardDescription>
          +20.1% from last month
          <icon-lucide-trending-up class="ml-2" />
        </CardDescription>
      </CardHeader>
      <CardContent class="flex grow flex-col justify-end">
        <BarChart
          :data="dataBar"
          class="h-auto w-full"
          type="stacked"
          index="Name"
          :categories="['Income', 'Expenses']"
          :show-grid-line="false"
          :rounded-corners="100"
          :show-legend="false"
          :y-formatter="
            (tick, i) => {
              return typeof tick === 'number'
                ? `$${new Intl.NumberFormat('us').format(tick).toString()}`
                : ''
            }
          "
        />
      </CardContent>
    </Card>
  </div>
</template>
