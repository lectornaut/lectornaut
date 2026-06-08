<script lang="ts" setup>
import {
  IconChevronsUpDown,
  IconLogOut,
  IconUserCog,
  IconUserRound,
  IconUserRoundPlus,
} from "@/data/icons"
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
                <AppAvatar :src="user?.photoURL" :name="user?.displayName" />
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
                    <AppAvatar
                      :src="user?.photoURL"
                      :name="user?.displayName"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {{ user?.displayName }}
                    </ItemTitle>
                    <ItemDescription class="text-xs">
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
        <ContextMenuContent>
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
