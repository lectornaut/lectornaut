<script setup lang="ts">
import { useCreateActions } from "@/composables/useCreateActions"
import { IconChevronUp, IconPlus } from "@/data/icons"

const { t } = useI18n()
const { groups } = useCreateActions()
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
              <IconChevronUp />
            </SidebarMenuBadge>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            {{ t("mainSidebar.createNew") }}
          </DropdownMenuLabel>
          <TooltipProvider>
            <template v-for="(group, index) in groups" :key="group.id">
              <DropdownMenuSeparator v-if="index > 0" />
              <DropdownMenuGroup>
                <template v-for="action in group.actions" :key="action.id">
                  <!-- Gated intent: disabled item + a tooltip explaining why.
                       The wrapper div keeps hover working while disabled. -->
                  <Tooltip v-if="action.disabled">
                    <TooltipTrigger as-child>
                      <div>
                        <DropdownMenuItem disabled>
                          <Component
                            :is="action.icon"
                            :class="action.iconClass"
                          />
                          {{ action.label }}
                        </DropdownMenuItem>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent v-if="action.disabledReason" side="right">
                      {{ action.disabledReason }}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuItem
                    v-else
                    :data-hotkey="action.hotkey"
                    @click="action.run()"
                  >
                    <Component :is="action.icon" :class="action.iconClass" />
                    {{ action.label }}
                    <DropdownMenuShortcut>
                      {{ action.hotkey.toUpperCase() }}
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </template>
              </DropdownMenuGroup>
            </template>
          </TooltipProvider>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
