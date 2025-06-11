<script setup lang="ts">
import { columns } from "@/components/table/columns"
import teams from "@/data/teams.json"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Teams",
    breadcrumb: "Teams",
  },
})

useHead({
  title: "Teams",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="teams" :columns="columns" />
  </div>
</template>
