<script lang="ts" setup>
import { IconAtSign, IconGlobe, IconLock, IconSettings } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { doc } from "firebase/firestore"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Profile",
    breadcrumb: "Profile",
  },
})

useHead({
  title: "Profile",
})

const { t } = useI18n()

const user = useCurrentUser()
const db = useFirestore()
const userDocRef = computed(() =>
  user.value ? doc(db, "users", user.value.uid) : null
)
const { data: userData } = useDocument(userDocRef)
const isPublic = computed(() => userData.value?.isPublic ?? false)
const username = computed(() => userData.value?.username ?? "")
</script>

<template>
  <OverlayScrollbarsWrapper>
    <div class="flex flex-col items-center justify-center p-2">
      <div
        class="aspect-video max-h-40 w-full rounded-md border bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] bg-fixed"
      ></div>
      <div class="bg-background mx-auto -mt-10 rounded-full border p-1">
        <Avatar class="size-20 rounded-full">
          <AvatarImage
            class="size-20 rounded-full"
            :src="user?.photoURL!"
            :alt="user?.displayName"
            referrerpolicy="no-referrer"
          />
          <AvatarFallback class="size-20 rounded-full">
            {{ getInitials(user?.displayName!) }}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
    <div
      class="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 p-4"
    >
      <h1 class="text-2xl font-bold tracking-tight">
        {{ user?.displayName }}
      </h1>
      <!-- <Badge variant="secondary" as-child> -->
      <a
        v-if="username"
        :href="`/${username}`"
        target="_blank"
        rel="noopener noreferrer"
        class="text-muted-foreground"
      >
        <IconAtSign />
        {{ username }}
      </a>
      <span v-else> {{ t("pages.profile.noUsername") }} </span>
      <!-- </Badge> -->
      <div class="flex items-center gap-2">
        <Badge variant="secondary">
          <IconGlobe v-if="isPublic" />
          <IconLock v-else />
          {{
            isPublic ? t("pages.profile.public") : t("pages.profile.private")
          }}
        </Badge>
        <Badge
          variant="outline"
          @click="emitter.emit('Dialog.Settings.Open', 'account')"
        >
          <IconSettings />
          {{ t("actions.settings") }}
        </Badge>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>
