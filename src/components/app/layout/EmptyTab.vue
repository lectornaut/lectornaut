<script lang="ts" setup>
import { IconArrowRight } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
</script>

<template>
  <ItemGroup class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2">
    <Item v-for="(item, itemIdx) in defaultMenu" :key="itemIdx" variant="muted">
      <ItemMedia variant="icon" :class="[item.style.bg, item.style.text]">
        <Component :is="item.icon" />
      </ItemMedia>
      <ItemContent class="gap-0.5 truncate">
        <ItemTitle class="truncate">{{ item.action }}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="icon" as-child>
          <RouterLink :to="item.url">
            <IconArrowRight />
          </RouterLink>
        </Button>
      </ItemActions>
    </Item>
  </ItemGroup>
</template>
