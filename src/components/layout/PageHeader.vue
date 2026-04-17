<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconArrowLeft, IconLogOut } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const isFullscreen = useIsFullscreen()
const currentUser = useCurrentUser()
</script>

<template>
  <div data-tauri-drag-region class="grid grid-cols-2 gap-2 self-stretch p-2">
    <div
      data-tauri-drag-region
      class="flex items-center justify-start gap-2 transition-all"
      :class="{ 'pl-22': isTauri && !isFullscreen }"
    >
      <Logo class="size-8 shrink-0 p-2" />
      <Button variant="ghost" size="icon" as-child>
        <RouterLink to="/start">
          <IconArrowLeft />
        </RouterLink>
      </Button>
    </div>
    <div
      data-tauri-drag-region
      class="flex items-center justify-end transition-all"
    >
      <DropdownMenu v-if="currentUser">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost">
            <Avatar class="size-4">
              <AvatarImage
                class="size-4"
                :src="currentUser.photoURL || ''"
                :alt="currentUser.displayName || ''"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="size-4">
                {{ getInitials(currentUser.displayName || "") }}
              </AvatarFallback>
            </Avatar>
            {{ currentUser.displayName }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <Item class="group w-full gap-2">
              <ItemMedia>
                <Avatar>
                  <AvatarImage
                    :src="currentUser.photoURL || ''"
                    :alt="currentUser.displayName || ''"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback>
                    {{ getInitials(currentUser.displayName || "") }}
                  </AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent class="gap-0.5 truncate">
                <ItemTitle class="truncate">
                  {{ currentUser.displayName }}
                </ItemTitle>
                <ItemDescription class="truncate text-xs">
                  {{ currentUser.email }}
                </ItemDescription>
              </ItemContent>
            </Item>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="emitter.emit('Dialog.Exit.Open')">
            <IconLogOut />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
