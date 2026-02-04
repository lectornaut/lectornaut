<script lang="ts" setup>
import { columns } from "@/components/table/columns"
import _runs from "@/data/runs.json"

const { t } = useI18n()

const runs = _runs

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
            <SidebarGroupLabel>{{ t("pages.runs.files") }}</SidebarGroupLabel>
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
  <DataTable :data="runs" :columns="columns" />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
