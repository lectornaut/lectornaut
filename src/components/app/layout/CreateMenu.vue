<script setup lang="ts">
import { IconChevronDown, IconPlus } from "@/data/icons"
import { defaultCreateMenu } from "@/helpers/defaults"

const { t } = useI18n()
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-new-menu">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            :tooltip="t('mainSidebar.createNew')"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <div
              class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square items-center justify-center rounded-md"
            >
              <IconPlus />
            </div>
            {{ t("mainSidebar.createNew") }}
            <SidebarMenuBadge>
              <IconChevronDown />
            </SidebarMenuBadge>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-48" align="end" side="right">
          <DropdownMenuLabel class="text-muted-foreground text-xs">
            {{ t("mainSidebar.createNew") }}
          </DropdownMenuLabel>
          <DropdownMenuItem
            v-for="item in defaultCreateMenu"
            :key="item.id"
            @click="item.action"
          >
            <Component :is="item.icon" />
            {{ item.title }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
