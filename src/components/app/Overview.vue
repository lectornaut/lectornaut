<script setup lang="ts">
const data = [
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
]
</script>

<template>
  <BarChart
    :data="data"
    index="Name"
    :categories="['Income', 'Expenses']"
    :show-grid-line="false"
    :rounded-corners="4"
    :y-formatter="
      (tick, i) => {
        return typeof tick === 'number'
          ? `$${new Intl.NumberFormat('us').format(tick).toString()}`
          : ''
      }
    "
  />
</template>
