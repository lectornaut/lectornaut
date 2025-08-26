<script setup lang="ts">
import { columns } from "@/components/table/columns"
import runs from "@/data/runs.json"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Runs",
    breadcrumb: "Runs",
  },
})

useHead({
  title: "Runs",
})

const tree = [
  {
    name: "app",
    children: [
      {
        name: "api",
        children: [
          {
            name: "hello",
            children: [{ name: "route.ts" }],
          },
          { name: "page.tsx" },
          { name: "layout.tsx" },
          {
            name: "blog",
            children: [{ name: "page.tsx" }],
          },
        ],
      },
    ],
  },
  {
    name: "components",
    children: [
      {
        name: "ui",
        children: [{ name: "button.tsx" }, { name: "card.tsx" }],
      },
      { name: "header.tsx" },
      { name: "footer.tsx" },
    ],
  },
  {
    name: "lib",
    children: [{ name: "util.ts" }],
  },
  {
    name: "public",
    children: [{ name: "favicon.ico" }, { name: "vercel.svg" }],
  },
  { name: ".eslintrc.json" },
  { name: ".gitignore" },
  { name: "next.config.js" },
  { name: "tailwind.config.js" },
  { name: "package.json" },
  { name: "README.md" },
]
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <SidebarGroupLabel>Files</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <Tree v-for="(item, index) in tree" :key="index" :node="item" />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <DataTable :data="runs" :columns="columns" />
  </div>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
