<script lang="ts" setup>
import { IconArrowRight } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
</script>

<template>
  <OverlayScrollbarsWrapper>
    <ItemGroup class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2">
      <Item
        v-for="(item, itemIdx) in defaultMenu"
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
            <IconArrowRight />
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  </OverlayScrollbarsWrapper>
</template>
