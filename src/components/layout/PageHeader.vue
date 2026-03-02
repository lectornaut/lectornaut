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
      class="flex items-center justify-start transition-all"
      :class="{ 'pl-20': isTauri && !isFullscreen }"
    >
      <Button variant="ghost" size="icon-sm" as-child>
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
          <Button variant="ghost" size="sm">
            <Avatar class="size-5 rounded">
              <AvatarImage
                class="size-5 rounded"
                :src="currentUser.photoURL || ''"
                :alt="currentUser.displayName || ''"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="size-5 rounded">
                {{ getInitials(currentUser.displayName || "") }}
              </AvatarFallback>
            </Avatar>
            {{ currentUser.displayName }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="emitter.emit('Dialog.Exit.Open')">
            <IconLogOut />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
