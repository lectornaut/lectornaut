<script lang="ts" setup>
import { useKeychain } from "@/composables/useKeychain"
import {
  IconCheck,
  IconChevronDown,
  IconCirclePlus,
  IconCircleUser,
  IconCreditCard,
  IconLogOut,
  IconUserRound,
  IconX,
} from "@/data/icons"
import { logout, switchAccount } from "@/modules/auth"
import { emitter } from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const { accounts, removeAccount } = useKeychain()

const handleAddAccount = async () => {
  await logout()
}

const handleSwitchAccount = async (uid: string) => {
  await switchAccount(uid)
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-account-menu">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            tooltip="Account"
            size="lg"
            class="data-[state=open]:bg-accent"
          >
            <Avatar class="rounded-md">
              <AvatarImage
                class="rounded-md"
                :src="user?.photoURL!"
                :alt="user?.displayName!"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="rounded-md">
                {{ user?.displayName?.charAt(0) }}
              </AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold">
                {{ user?.displayName }}
              </span>
              <span class="truncate text-xs">{{ user?.email }}</span>
            </div>
            <IconChevronDown />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-56"
          align="end"
          side="right"
          :side-offset="4"
        >
          <DropdownMenuLabel as-child>
            <Item size="sm" class="p-0.5">
              <ItemMedia>
                <Avatar class="rounded-md">
                  <AvatarImage
                    class="rounded-md"
                    :src="user?.photoURL!"
                    :alt="user?.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded-md">
                    {{ user?.displayName?.charAt(0) }}
                  </AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent class="gap-0.5">
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
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'account')"
            >
              <IconCircleUser />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'billing')"
            >
              <IconCreditCard />
              Billing
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuItem as-child>
                <DropdownMenuSubTrigger>
                  <IconUserRound />
                  Switch account
                </DropdownMenuSubTrigger>
              </DropdownMenuItem>
              <DropdownMenuSubContent class="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Accounts
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="account in accounts"
                    :key="account.uid"
                    @click="handleSwitchAccount(account.uid)"
                  >
                    <Item size="sm" class="group w-full gap-2 p-0">
                      <ItemMedia>
                        <Avatar class="rounded-md">
                          <AvatarImage
                            class="rounded-md"
                            :src="account?.photoURL!"
                            :alt="account?.displayName!"
                            referrerpolicy="no-referrer"
                          />
                          <AvatarFallback class="rounded-md">
                            {{ account.displayName?.charAt(0) }}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent class="gap-0.5">
                        <ItemTitle>
                          {{ account.displayName }}
                        </ItemTitle>
                        <ItemDescription class="text-xs">
                          {{ account.email }}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          v-if="account.uid === user?.uid"
                          variant="ghost"
                          size="icon-sm"
                          class="rounded-full"
                        >
                          <IconCheck class="text-primary" />
                        </Button>
                        <Button
                          v-else
                          variant="secondary"
                          size="icon-sm"
                          class="hidden rounded-full group-hover:inline-flex"
                          @click.stop="removeAccount(account.uid)"
                        >
                          <IconX />
                        </Button>
                      </ItemActions>
                    </Item>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem @click="handleAddAccount">
                    <IconCirclePlus />
                    Add account
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem @click="emitter.emit('Dialog.Exit.Open')">
              <IconLogOut />
              Log out
              <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
