<route lang="json">
{
  "meta": {
    "layout": "app",
    "requiresUser": true,
    "title": "Teams"
  }
}
</route>

<script setup lang="ts">
import { columns } from "@/components/table/columns"
import teams from "@/data/teams.json"

useHead({
  title: "Teams",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="teams" :columns="columns" />
  </div>
</template>
