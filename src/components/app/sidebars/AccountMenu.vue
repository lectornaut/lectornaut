<script lang="ts" setup>
import {
  IconChevronsUpDown,
  IconCircleUser,
  IconLogOut,
  IconUserRound,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const { t } = useI18n()
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-account-menu">
      <ContextMenu>
        <ContextMenuTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                :tooltip="t('accountMenu.account')"
                size="lg"
                class="data-[state=open]:bg-accent rounded"
              >
                <Avatar class="rounded">
                  <AvatarImage
                    class="rounded"
                    :src="user?.photoURL!"
                    :alt="user?.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded">
                    {{ getInitials(user?.displayName!) }}
                  </AvatarFallback>
                </Avatar>
                <div class="flex grow flex-col">
                  <span
                    class="truncate text-base leading-tight font-semibold tracking-tight"
                  >
                    {{ user?.displayName }}
                  </span>
                  <span class="text-muted-foreground truncate text-xs">
                    {{ user?.email }}
                  </span>
                </div>
                <SidebarMenuBadge>
                  <IconChevronsUpDown />
                </SidebarMenuBadge>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-48" align="end" side="right">
              <DropdownMenuLabel>
                <Item size="sm" class="group w-full gap-2 rounded p-0">
                  <ItemMedia>
                    <Avatar class="rounded">
                      <AvatarImage
                        class="rounded"
                        :src="user?.photoURL!"
                        :alt="user?.displayName"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback class="rounded">
                        {{ getInitials(user?.displayName!) }}
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent class="gap-0.5 truncate">
                    <ItemTitle class="truncate">
                      {{ user?.displayName }}
                    </ItemTitle>
                    <ItemDescription class="truncate text-xs">
                      {{ user?.email }}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem as-child>
                  <RouterLink to="/profile">
                    <IconUserRound />
                    {{ t("accountMenu.profile") }}
                  </RouterLink>
                </DropdownMenuItem>
                <DropdownMenuItem
                  @click="emitter.emit('Dialog.Settings.Open', 'account')"
                >
                  <IconCircleUser />
                  {{ t("accountMenu.account") }}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem @click="emitter.emit('Dialog.Exit.Open')">
                  <IconLogOut />
                  {{ t("accountMenu.logout") }}
                  <DropdownMenuShortcut>⇧⌘L</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-48" align="end" side="right">
          <ContextMenuGroup>
            <ContextMenuItem as-child>
              <RouterLink to="/profile">
                <IconUserRound />
                {{ t("accountMenu.profile") }}
              </RouterLink>
            </ContextMenuItem>
            <ContextMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'account')"
            >
              <IconCircleUser />
              {{ t("accountMenu.account") }}
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
