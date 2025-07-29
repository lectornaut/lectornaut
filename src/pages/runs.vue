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
  [
    "app",
    [
      "api",
      ["hello", ["route.ts"]],
      "page.tsx",
      "layout.tsx",
      ["blog", ["page.tsx"]],
    ],
  ],
  ["components", ["ui", "button.tsx", "card.tsx"], "header.tsx", "footer.tsx"],
  ["lib", ["util.ts"]],
  ["public", "favicon.ico", "vercel.svg"],
  ".eslintrc.json",
  ".gitignore",
  "next.config.js",
  "tailwind.config.js",
  "package.json",
  "README.md",
]
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="bg-sidebar/50 w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <SidebarGroupLabel>Files</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <Tree v-for="(item, index) in tree" :key="index" :item="item" />
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
    <Sidebar collapsible="none" class="bg-sidebar/50 w-full"> </Sidebar>
  </Teleport>
</template>
