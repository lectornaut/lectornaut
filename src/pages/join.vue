<script lang="ts" setup>
import { IconTrash } from "@/data/icons"
import { logout } from "@/modules/auth"
import { useAuthStore } from "@/stores/authStore"
import { useInvitationStore, type IInvitation } from "@/stores/invitationStore"
import { storeToRefs } from "pinia"
import { useRoute, useRouter } from "vue-router"
import { toast } from "vue-sonner"

definePage({
  meta: {
    requiresUser: true,
    layout: "empty",
  },
})

useHead({
  title: "Join",
})

const route = useRoute()
const router = useRouter()
const invitationStore = useInvitationStore()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)
const { userInvitations } = storeToRefs(invitationStore)

const isLoading = ref(true)
const invitation = ref<IInvitation | null>(null)
const error = ref<string | null>(null)
const isEmailMismatch = ref(false)
const showInvitationsList = ref(false)

// Get invitation code from URL
const code = computed(() => route.query.code as string)

// Computed lists
const pendingInvitations = computed(
  () => userInvitations.value?.filter((i) => i.status === "pending") || []
)
const declinedInvitations = computed(
  () => userInvitations.value?.filter((i) => i.status === "declined") || []
)

// Watch code changes to reload main view
watch(
  () => route.query.code,
  async (newCode) => {
    if (newCode) {
      await loadInvitation(newCode as string)
    } else {
      invitation.value = null
      error.value = null
      isEmailMismatch.value = false
    }
  }
)

onMounted(async () => {
  if (code.value) {
    await loadInvitation(code.value)
  } else {
    // If no code but authenticated, maybe just show list if exists?
    isLoading.value = false
    if (userInvitations.value?.length) {
      showInvitationsList.value = true
      error.value = null
    } else {
      error.value = "Invalid invitation link."
    }
  }
})

const loadInvitation = async (invitationCode: string) => {
  isLoading.value = true
  error.value = null
  isEmailMismatch.value = false
  try {
    const invite = await invitationStore.getInvitationByCode(invitationCode)
    if (!invite) {
      error.value = "Invitation not found or has expired."
    } else {
      // Check if the current user is the intended recipient
      const currentUserEmail = authStore.currentUser?.email
      if (currentUserEmail && invite.email !== currentUserEmail) {
        error.value = `Invalid invitation, you are logged in as ${currentUserEmail}.`
        isEmailMismatch.value = true
        // Ensure we don't show the erroneous invitation
        invitation.value = null
      } else {
        invitation.value = invite
      }
    }
  } catch (e) {
    console.error(e)
    error.value = "Failed to load invitation."
  } finally {
    isLoading.value = false
  }
}

const handleAccept = async () => {
  if (!isAuthenticated.value) {
    router.push({
      path: "/enter",
      query: { redirect: route.fullPath },
    })
    return
  }

  if (!invitation.value) return

  isLoading.value = true
  try {
    await invitationStore.acceptInvitation(invitation.value)
    toast.success("Joined team successfully!")
    router.push("/")
  } catch (e) {
    console.error(e)
    toast.error("Failed to join team", {
      description: (e as Error).message,
    })
  } finally {
    isLoading.value = false
  }
}

const handleDecline = async () => {
  if (!invitation.value?.id) return

  isLoading.value = true
  try {
    await invitationStore.declineInvitation(invitation.value.id)
    toast.info("Invitation declined")
    // Update local state by reloading or re-fetching?
    // userInvitations is reactive via VueFire, so list updates auto.
    // Update current view:
    if (invitation.value) invitation.value.status = "declined"
  } catch (e) {
    console.error(e)
    toast.error("Failed to decline invitation")
  } finally {
    isLoading.value = false
  }
}

const handleDelete = async (inviteId: string) => {
  if (!confirm("Delete this invitation notification?")) return

  try {
    await invitationStore.cancelInvitation(inviteId) // Reuse delete logic
    toast.success("Invitation removed")
    if (invitation.value?.id === inviteId) {
      invitation.value = null
      error.value = "Invitation deleted."
      router.replace({ query: {} }) // Clear URL
    }
  } catch (e) {
    console.error(e)
    toast.error("Failed to delete invitation")
  }
}

const handleIgnore = () => {
  router.push("/")
}

const handleLogout = async () => {
  await logout()
}

const selectInvitation = (code: string) => {
  router.push({ query: { code: code } })
}
</script>

<template>
  <div
    class="flex min-h-screen w-full flex-col items-center justify-center bg-gray-50 p-4 dark:bg-zinc-950"
  >
    <div class="w-full max-w-md space-y-4">
      <!-- Toggle List Button -->
      <div
        v-if="
          isAuthenticated &&
          (pendingInvitations.length > 0 || declinedInvitations.length > 0)
        "
        class="flex justify-end"
      >
        <Button
          variant="ghost"
          size="sm"
          @click="showInvitationsList = !showInvitationsList"
        >
          {{
            showInvitationsList ? "Hide Invitations" : "Show All Invitations"
          }}
        </Button>
      </div>

      <!-- Invitations List/Drawer -->
      <div
        v-if="showInvitationsList"
        class="bg-card animate-in slide-in-from-top-2 space-y-4 rounded-lg border p-4 shadow-sm"
      >
        <h2 class="text-sm font-semibold">Your Invitations</h2>

        <div v-if="pendingInvitations.length > 0" class="space-y-2">
          <h3
            class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
          >
            Pending
          </h3>
          <div
            v-for="invite in pendingInvitations"
            :key="invite.id"
            class="hover:bg-secondary/50 group flex cursor-pointer items-center justify-between rounded-md border p-2"
            :class="{
              'border-primary ring-primary ring-1': invite.code === code,
            }"
            @click="selectInvitation(invite.code)"
          >
            <div class="flex flex-col">
              <span class="text-sm font-medium">{{ invite.teamName }}</span>
              <span class="text-muted-foreground text-xs"
                >Invited by {{ invite.inviteeName }}</span
              >
            </div>
            <div class="flex items-center gap-2">
              <div
                class="bg-primary/10 text-primary rounded-full px-2 py-1 text-xs uppercase"
              >
                Pending
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                @click.stop="handleDelete(invite.id!)"
              >
                <IconTrash class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <div v-if="declinedInvitations.length > 0" class="space-y-2">
          <h3
            class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
          >
            Declined
          </h3>
          <div
            v-for="invite in declinedInvitations"
            :key="invite.id"
            class="hover:bg-secondary/50 group flex cursor-pointer items-center justify-between rounded-md border p-2"
            :class="{
              'border-primary ring-primary ring-1': invite.code === code,
            }"
            @click="selectInvitation(invite.code)"
          >
            <div class="flex flex-col">
              <span
                class="text-muted-foreground text-sm font-medium line-through"
                >{{ invite.teamName }}</span
              >
              <span class="text-muted-foreground text-xs">Declined</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              @click.stop="handleDelete(invite.id!)"
            >
              <IconTrash class="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <div
        v-if="invitation || isLoading || error"
        class="bg-card w-full max-w-md space-y-8 rounded-lg border p-8 shadow-sm"
      >
        <div class="flex flex-col items-center text-center">
          <h1 class="text-2xl font-bold tracking-tight">Team Invitation</h1>
          <p class="text-muted-foreground mt-2">
            You have been invited to join a team.
          </p>
        </div>

        <div v-if="isLoading" class="flex justify-center py-8">
          <Spinner />
        </div>

        <div v-else-if="error" class="flex flex-col items-center gap-4 py-6">
          <div
            class="rounded-full bg-red-100 p-3 text-red-600 dark:bg-red-900/30 dark:text-red-400"
          >
            <!-- IconX / -->
            <span class="text-xl">⚠️</span>
          </div>
          <p class="text-center font-medium">{{ error }}</p>
          <div class="flex gap-2">
            <Button variant="outline" @click="handleIgnore">Go Home</Button>
            <Button
              v-if="isEmailMismatch"
              variant="default"
              @click="handleLogout"
            >
              Log out
            </Button>
          </div>
        </div>

        <div v-else-if="invitation" class="space-y-6">
          <div class="bg-secondary/50 rounded-md p-4">
            <div class="grid gap-1 text-center">
              <p class="text-muted-foreground text-sm">
                {{
                  invitation.status === "pending"
                    ? "You have been invited to join"
                    : "You declined the invitation to"
                }}
              </p>
              <p class="text-lg font-bold">{{ invitation.teamName }}</p>
              <div v-if="invitation.status === 'pending'">
                <p class="text-muted-foreground mt-2 text-sm">Invited by</p>
                <p class="font-medium">{{ invitation.inviteeName }}</p>
                <p class="text-muted-foreground text-xs">
                  ({{ invitation.inviteeEmail }})
                </p>
                <p class="text-muted-foreground mt-2 text-sm">Role</p>
                <p class="font-medium capitalize">
                  {{ invitation.role }}
                </p>
              </div>
              <div v-else class="mt-4">
                <p class="text-destructive text-sm font-medium">Declined</p>
              </div>
            </div>
          </div>

          <div
            v-if="invitation.status === 'pending'"
            class="flex flex-col gap-3"
          >
            <Button class="w-full" size="lg" @click="handleAccept">
              Accept Invitation
            </Button>
            <div class="grid grid-cols-2 gap-3">
              <Button variant="outline" @click="handleDecline">Decline</Button>
              <Button
                variant="destructive"
                @click="handleDelete(invitation.id!)"
              >
                Delete
              </Button>
            </div>
          </div>

          <div v-else class="flex flex-col gap-3">
            <Button
              variant="destructive"
              class="w-full"
              @click="handleDelete(invitation.id!)"
            >
              Delete Invitation
            </Button>
            <Button variant="ghost" @click="handleIgnore">Go Home</Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
