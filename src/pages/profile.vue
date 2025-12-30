<script lang="ts" setup>
import { IconSettings } from "@/data/icons"
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

const user = useCurrentUser()
const db = useFirestore()
const userDocRef = computed(() =>
  user.value ? doc(db, "users", user.value.uid) : null
)
const { data: userData } = useDocument(userDocRef)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-8 p-6">
    <div class="flex items-center gap-6">
      <Avatar class="border-accent size-24 rounded-full border-4 shadow-xl">
        <AvatarImage :src="user?.photoURL!" :alt="user?.displayName!" />
        <AvatarFallback class="text-2xl">{{
          getInitials(user?.displayName!)
        }}</AvatarFallback>
      </Avatar>
      <div class="space-y-1">
        <h1 class="text-3xl font-bold tracking-tight">
          {{ user?.displayName }}
        </h1>
        <p class="text-muted-foreground flex items-center gap-2">
          <span v-if="userData?.username" class="text-primary font-mono text-lg"
            >@{{ userData.username }}</span
          >
          <span v-else class="text-sm italic">No username set</span>
        </p>
        <p class="text-muted-foreground text-sm">{{ user?.email }}</p>
      </div>
    </div>
    <Separator />
    <div class="flex justify-end">
      <Button
        variant="secondary"
        @click="emitter.emit('Dialog.Settings.Open', 'account')"
      >
        <IconSettings class="mr-2 size-4" />
        Account Settings
      </Button>
    </div>
  </div>
</template>
