<script lang="ts" setup>
import { IconArrowRight } from "@/data/icons"
import { defaultMenu } from "@/helpers/defaults"
</script>

<template>
  <ItemGroup class="grid grid-cols-1 gap-2 p-2 md:grid-cols-2">
    <Item
      v-for="(item, itemIdx) in defaultMenu"
      :key="itemIdx"
      variant="muted"
      size="xs"
    >
      <ItemMedia variant="icon">
        <Button
          variant="outline"
          size="icon"
          :class="item.style.bg"
          class="pointer-events-none"
          tabindex="-1"
        >
          <Component :is="item.icon" :class="item.style.text" />
        </Button>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{{ item.action }}</ItemTitle>
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
