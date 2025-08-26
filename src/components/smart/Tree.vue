<script setup lang="ts">
type TreeData = {
  name: string
  children?: TreeData[]
}

defineProps<{ node: TreeData }>()
</script>

<template>
  <SidebarMenuItem v-if="node.children">
    <Collapsible class="[&[data-state=open]>button>svg:first-child]:rotate-90">
      <CollapsibleTrigger as-child>
        <SidebarMenuButton>
          <icon-lucide-chevron-right class="transition-transform" />
          <icon-lucide-folder />
          <span class="truncate">
            {{ node.name }}
          </span>
        </SidebarMenuButton>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub class="mr-0 pr-0">
          <Tree
            v-for="(subItem, index) in node.children"
            :key="index"
            :node="subItem"
          />
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>
  <SidebarMenuButton v-else>
    <icon-lucide-file />
    <span class="truncate">
      {{ node.name }}
    </span>
  </SidebarMenuButton>
</template>
