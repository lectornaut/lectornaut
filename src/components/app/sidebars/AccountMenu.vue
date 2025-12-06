<script lang="ts" setup>
import {
  IconChevronDown,
  IconCirclePlus,
  IconCircleUser,
  IconCreditCard,
  IconLogOut,
  IconUserRound,
} from "@/data/icons"
import emitter from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()

const accounts = [
  {
    username: "shadcn",
    avatar: "https://github.com/shadcn.png",
    email: "shadcn@vercel.com",
  },
  {
    username: "maxleiter",
    avatar: "https://github.com/maxleiter.png",
    email: "maxleiter@vercel.com",
  },
  {
    username: "evilrabbit",
    avatar: "https://github.com/evilrabbit.png",
    email: "evilrabbit@vercel.com",
  },
]
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-account-menu">
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <TooltipTrigger as-child>
                <SidebarMenuButton
                  size="lg"
                  class="data-[state=open]:bg-accent"
                >
                  <Avatar class="aspect-square size-8 rounded-md">
                    <AvatarImage
                      :src="user?.photoURL!"
                      :alt="user?.displayName"
                      referrerpolicy="no-referrer"
                    />
                    <AvatarFallback class="rounded-md"> CN </AvatarFallback>
                  </Avatar>
                  <div class="grid flex-1 text-left text-sm leading-tight">
                    <span class="truncate font-semibold">{{
                      user?.displayName
                    }}</span>
                    <span class="truncate text-xs">{{ user?.email }}</span>
                  </div>
                  <IconChevronDown />
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent side="right"> Account </TooltipContent>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              class="w-56"
              align="end"
              side="right"
              :side-offset="4"
            >
              <DropdownMenuLabel class="p-0 font-normal">
                <div
                  class="flex items-center gap-2 px-1 py-1.5 text-left text-sm"
                >
                  <Avatar class="size-8 rounded-lg">
                    <AvatarImage
                      :src="user?.photoURL!"
                      :alt="user?.displayName"
                      referrerpolicy="no-referrer"
                    />
                    <AvatarFallback class="rounded-lg"> CN </AvatarFallback>
                  </Avatar>
                  <div class="grid flex-1 text-left text-sm leading-tight">
                    <span class="truncate font-semibold">{{
                      user?.displayName
                    }}</span>
                    <span class="text-muted-foreground truncate text-xs">
                      {{ user?.email }}
                    </span>
                  </div>
                </div>
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
                  <DropdownMenuSubContent class="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel class="text-muted-foreground text-xs">
                        Accounts
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        v-for="account in accounts"
                        :key="account.username"
                      >
                        <Item size="sm" class="p-0">
                          <ItemMedia>
                            <Avatar class="size-8">
                              <AvatarImage :src="account.avatar" />
                              <AvatarFallback>
                                {{ account.username.charAt(0) }}
                              </AvatarFallback>
                            </Avatar>
                          </ItemMedia>
                          <ItemContent class="gap-0">
                            <ItemTitle>{{ account.username }}</ItemTitle>
                            <ItemDescription>{{
                              account.email
                            }}</ItemDescription>
                          </ItemContent>
                        </Item>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <!-- <DialogTrigger as-child> -->
                      <DropdownMenuItem>
                        <IconCirclePlus />
                        Add account
                      </DropdownMenuItem>
                      <!-- </DialogTrigger> -->
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
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
