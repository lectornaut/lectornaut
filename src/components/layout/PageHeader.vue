<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { IconArrowLeft, IconLogOut } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const isFullscreen = useIsFullscreen()
const currentUser = useCurrentUser()
</script>

<template>
  <div
    data-tauri-drag-region="deep"
    class="grid grid-cols-2 gap-2 self-stretch p-2"
    :class="{ 'pl-22': isTauri && !isFullscreen }"
  >
    <div class="flex items-center justify-start gap-2">
      <Button variant="ghost" size="icon" as-child>
        <RouterLink to="/start">
          <IconArrowLeft />
        </RouterLink>
      </Button>
    </div>
    <div class="flex items-center justify-end">
      <DropdownMenu v-if="currentUser">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost">
            <AppAvatar
              class="size-4"
              :src="currentUser.photoURL"
              :name="currentUser.displayName"
            />
            {{ currentUser.displayName }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <Item class="group" size="xs">
              <ItemMedia>
                <AppAvatar
                  :src="currentUser.photoURL"
                  :name="currentUser.displayName"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {{ currentUser.displayName }}
                </ItemTitle>
                <ItemDescription class="text-xs">
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
