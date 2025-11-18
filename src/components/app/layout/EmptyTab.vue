<script lang="ts" setup>
import { menu } from "@/helpers/defaults"
</script>

<template>
  <OverlayScrollbarsWrapper>
    <ItemGroup class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2">
      <Item
        v-for="(item, itemIdx) in menu"
        :key="itemIdx"
        size="sm"
        variant="muted"
      >
        <ItemMedia variant="icon">
          <Component :is="item.icon" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{{ item.action }}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="icon">
            <icon-lucide-arrow-right />
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  </OverlayScrollbarsWrapper>
</template>
