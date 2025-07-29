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
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="bg-sidebar/50 w-full"> </Sidebar>
  </Teleport>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="teams" :columns="columns" />
  </div>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="bg-sidebar/50 w-full"> </Sidebar>
  </Teleport>
</template>
