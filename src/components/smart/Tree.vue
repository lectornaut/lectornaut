<script lang="ts" setup>
import { IconChevronRight, IconFile, IconFolder } from "@/data/icons"
import { computed } from "vue"

type TreeData = {
  name: string
  children?: TreeData[]
}

type RowSlotProps = {
  node: TreeData
  open?: boolean
  loading?: boolean
}

type ChildrenSlotProps = {
  node: TreeData
}

const props = defineProps<{
  node: TreeData
  open?: boolean
  loading?: boolean
}>()

defineSlots<{
  row?(props: RowSlotProps): void
  children?(props: ChildrenSlotProps): void
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
}>()

const hasChildren = computed(() => Array.isArray(props.node.children))
const collapsibleProps = computed(() =>
  props.open === undefined ? {} : { open: props.open }
)
</script>

<template>
  <SidebarMenuItem v-if="hasChildren">
    <Collapsible
      class="[&[data-state=open]>button>svg:first-child]:rotate-90"
      v-bind="collapsibleProps"
      @update:open="(value) => emit('update:open', value)"
    >
      <CollapsibleTrigger as-child>
        <slot name="row" :node="node" :open="open" :loading="loading">
          <SidebarMenuButton>
            <IconChevronRight class="transition-transform" />
            <IconFolder />
            <span class="truncate">
              {{ node.name }}
            </span>
          </SidebarMenuButton>
        </slot>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub class="mr-0 pr-0">
          <slot name="children" :node="node">
            <Tree
              v-for="(subItem, index) in node.children"
              :key="index"
              :node="subItem"
            >
              <template #row="slotProps">
                <slot name="row" v-bind="slotProps" />
              </template>
              <template #children="slotProps">
                <slot name="children" v-bind="slotProps" />
              </template>
            </Tree>
          </slot>
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>
  <slot v-else name="row" :node="node" :open="open" :loading="loading">
    <SidebarMenuButton>
      <IconFile />
      <span class="truncate">
        {{ node.name }}
      </span>
    </SidebarMenuButton>
  </slot>
</template>
