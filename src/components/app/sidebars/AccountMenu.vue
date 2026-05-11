<script lang="ts" setup>
import {
  IconChevronsUpDown,
  IconLogOut,
  IconUserCog,
  IconUserRound,
  IconUserRoundPlus,
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
                class="data-[state=open]:bg-accent"
              >
                <Avatar>
                  <AvatarImage
                    :src="user?.photoURL!"
                    :alt="user?.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback>
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
            <DropdownMenuContent>
              <DropdownMenuLabel>
                <Item class="group" size="xs">
                  <ItemMedia>
                    <Avatar>
                      <AvatarImage
                        :src="user?.photoURL!"
                        :alt="user?.displayName"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback>
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
                  <IconUserCog />
                  {{ t("accountMenu.account") }}
                </DropdownMenuItem>
                <DropdownMenuItem as-child>
                  <RouterLink to="/invitations">
                    <IconUserRoundPlus />
                    Invitations
                  </RouterLink>
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
        <ContextMenuContent class="w-50">
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
              <IconUserCog />
              {{ t("accountMenu.account") }}
            </ContextMenuItem>
            <ContextMenuItem as-child>
              <RouterLink to="/invitations">
                <IconUserRoundPlus />
                Invitations
              </RouterLink>
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
