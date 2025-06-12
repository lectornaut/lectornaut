<script setup lang="ts">
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const user = useCurrentUser()
const isUserLoaded = useIsCurrentUserLoaded()
</script>
<template>
  <div
    class="before:from-background fixed inset-x-0 top-0 z-20 flex items-center justify-center gap-2 p-2 before:absolute before:inset-0 before:bg-linear-to-b before:backdrop-blur-lg before:[mask:linear-gradient(black_50%,_transparent)]"
  >
    <div class="z-50 grid grid-cols-3 gap-2 p-2">
      <div class="flex grow items-center justify-start gap-2">
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <Button variant="ghost" as-child>
              <RouterLink to="/">
                <icon-material-symbols-circle />
                Hyperjump
              </RouterLink>
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              <icon-mingcute-ai-fill />
              Copy icon as .SVG
            </ContextMenuItem>
            <ContextMenuItem>
              <icon-mingcute-signature-fill />
              Copy wordmark as .SVG
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>
              <icon-mingcute-download-fill />
              Download brand kit as .ZIP
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <div class="flex grow items-center justify-center gap-2">
        <Button variant="ghost" as-child>
          <RouterLink to="/pricing"> Pricing </RouterLink>
        </Button>
        <Button variant="ghost" as-child>
          <RouterLink to="/documentation"> Documentation </RouterLink>
        </Button>
        <Button variant="ghost" as-child>
          <RouterLink to="/blog"> Blog </RouterLink>
        </Button>
      </div>
      <div class="flex grow items-center justify-end gap-2">
        <ColorMode />
        <LanguageSwitcher />
        <Button v-if="!isUserLoaded" variant="ghost" disabled>
          <icon-lucide-loader class="animate-spin" />
        </Button>
        <Button v-else-if="user" variant="outline">
          <RouterLink to="/home">Open app</RouterLink>
        </Button>
        <EnterTrigger v-else auth-mode="sign-in">
          <Button variant="outline">Get started</Button>
        </EnterTrigger>
      </div>
    </div>
  </div>
</template>
