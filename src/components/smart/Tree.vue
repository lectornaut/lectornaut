<script setup lang="ts">
const props = defineProps<{
  item: string | string[]
}>()

const [name, ...items] = Array.isArray(props.item) ? props.item : [props.item]
</script>

<template>
  <SidebarMenuButton v-if="!items.length">
    <icon-lucide-file />
    <span class="truncate">
      {{ name }}
    </span>
  </SidebarMenuButton>
  <SidebarMenuItem v-else>
    <Collapsible class="[&[data-state=open]>button>svg:first-child]:rotate-90">
      <CollapsibleTrigger as-child>
        <SidebarMenuButton>
          <icon-lucide-chevron-right class="transition-transform" />
          <icon-lucide-folder />
          <span class="truncate">
            {{ name }}
          </span>
        </SidebarMenuButton>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub class="mr-0 pr-0">
          <Tree
            v-for="(subItem, index) in items"
            :key="index"
            :item="subItem"
          />
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>
</template>
