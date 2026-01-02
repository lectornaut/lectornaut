<script lang="ts" setup>
import { useKeychain } from "@/composables/useKeychain"
import {
  IconArrowRight,
  IconChevronDown,
  IconCirclePlus,
  IconCircleUser,
  IconCreditCard,
  IconLogOut,
  IconTrash,
  IconUserRound,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { logout, switchAccount } from "@/modules/auth"
import { emitter } from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const { accounts, removeAccount } = useKeychain()
const { t } = useI18n()

const otherAccounts = computed(() =>
  accounts.value.filter((account) => account.uid !== user.value?.uid)
)

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
            :tooltip="t('accountMenu.account')"
            size="lg"
            class="data-[state=open]:bg-accent"
          >
            <Avatar class="rounded-md">
              <AvatarImage
                v-if="user?.photoURL"
                class="rounded-md"
                :src="user.photoURL"
                :alt="user?.displayName"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="rounded-md">
                {{ getInitials(user?.displayName!) }}
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
          <DropdownMenuLabel>
            <Item size="sm" class="group w-full gap-2 p-0">
              <ItemMedia>
                <Avatar class="rounded-md">
                  <AvatarImage
                    v-if="user?.photoURL"
                    class="rounded-md"
                    :src="user.photoURL"
                    :alt="user?.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="rounded-md">
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
                View Profile
              </RouterLink>
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'account')"
            >
              <IconCircleUser />
              {{ t("accountMenu.account") }}
            </DropdownMenuItem>
            <DropdownMenuItem
              @click="emitter.emit('Dialog.Settings.Open', 'billing')"
            >
              <IconCreditCard />
              {{ t("accountMenu.billing") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuItem as-child>
                <DropdownMenuSubTrigger>
                  <IconUserRound />
                  {{ t("accountMenu.switchAccount") }}
                </DropdownMenuSubTrigger>
              </DropdownMenuItem>
              <DropdownMenuSubContent class="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    {{ t("accountMenu.accounts") }}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="account in otherAccounts"
                    :key="account.uid"
                    @click="handleSwitchAccount(account.uid)"
                  >
                    <Item size="sm" class="group w-full gap-2 p-0">
                      <ItemMedia>
                        <Avatar class="rounded-md">
                          <AvatarImage
                            v-if="account?.photoURL"
                            class="rounded-md"
                            :src="account.photoURL"
                            :alt="account?.displayName"
                            referrerpolicy="no-referrer"
                          />
                          <AvatarFallback class="rounded-md">
                            {{ getInitials(user?.displayName!) }}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent class="gap-0.5 truncate">
                        <ItemTitle class="truncate">
                          {{ account.displayName }}
                        </ItemTitle>
                        <ItemDescription class="truncate text-xs">
                          {{ account.email }}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <Button
                                variant="secondary"
                                size="icon-sm"
                                class="invisible transition group-hover:visible"
                                @click.stop="removeAccount(account.uid)"
                              >
                                <IconTrash />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t("enter.removeAccount") }}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                class="rounded-full"
                              >
                                <IconArrowRight />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t("enter.useAccount") }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </ItemActions>
                    </Item>
                  </DropdownMenuItem>
                  <DropdownMenuLabel v-if="otherAccounts.length === 0">
                    {{ t("accountMenu.noOtherAccounts") }}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem @click="handleAddAccount">
                    <IconCirclePlus />
                    {{ t("accountMenu.addAccount") }}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem @click="emitter.emit('Dialog.Exit.Open')">
              <IconLogOut />
              {{ t("accountMenu.logout") }}
              <DropdownMenuShortcut>⇧⌘L</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
