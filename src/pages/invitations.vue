<script lang="ts" setup>
import { IconAlertTriangle, IconUserRoundPlus } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useAuthStore } from "@/stores/authStore"
import { useInvitationStore, type IInvitation } from "@/stores/invitationStore"
import { storeToRefs } from "pinia"
import { useRoute, useRouter } from "vue-router"
import { toast } from "vue-sonner"

definePage({
  meta: {
    requiresUser: true,
    layout: false,
  },
})

useHead({
  title: "Join",
})

const { t } = useI18n()
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

// Get invitation code from URL
const code = computed(() => route.query.code as string)

const selectedCode = computed({
  get: () => code.value,
  set: (val: string) => router.push({ query: { code: val } }),
})

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
      error.value = null
    } else {
      error.value = t("pages.join.errors.invalidLink")
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
      error.value = t("pages.join.errors.notFoundOrExpired")
    } else {
      // Check if the current user is the intended recipient
      const currentUserEmail = authStore.currentUser?.email?.toLowerCase()
      if (currentUserEmail && invite.email.toLowerCase() !== currentUserEmail) {
        error.value = t("pages.join.errors.emailMismatch", {
          email: currentUserEmail,
        })
        isEmailMismatch.value = true
        // Ensure we don't show the erroneous invitation
        invitation.value = null
      } else {
        invitation.value = invite
      }
    }
  } catch (e) {
    console.error(e)
    error.value = t("pages.join.errors.loadFailed")
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

  if (invitation.value.status !== "pending") {
    toast.error(t("pages.join.errors.onlyPending"))
    return
  }

  isLoading.value = true
  try {
    await invitationStore.acceptInvitation(invitation.value)
    toast.success(t("pages.join.success.joined"))
    router.push("/")
  } catch (e) {
    console.error(e)
    toast.error(t("pages.join.errors.joinFailed"), {
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
    toast.info(t("pages.join.info.declined"))
    // Update local state by reloading or re-fetching?
    // userInvitations is reactive via the TanStack Query listener, so the list updates automatically.
    // Update current view:
    if (invitation.value) invitation.value.status = "declined"
  } catch (e) {
    console.error(e)
    toast.error(t("pages.join.errors.declineFailed"))
  } finally {
    isLoading.value = false
  }
}

const handleDelete = async (inviteId: string) => {
  if (!confirm(t("pages.join.confirm.delete"))) return

  try {
    await invitationStore.cancelInvitation(inviteId) // Reuse delete logic
    toast.success(t("pages.join.success.removed"))
    if (invitation.value?.id === inviteId) {
      invitation.value = null
      error.value = t("pages.join.info.deleted")
      router.replace({ query: {} }) // Clear URL
    }
  } catch (e) {
    console.error(e)
    toast.error(t("pages.join.errors.deleteFailed"))
  }
}

const handleIgnore = () => {
  router.push("/")
}

const handleLogout = () => {
  emitter.emit("Dialog.Exit.Open")
}

const formatInvitationTimestamp = (
  value: IInvitation["createdAt"] | null | undefined
) => {
  const date = value?.toDate?.()
  return date ? useDateFormat(date, "MMM D, YYYY · h:mm A").value : "—"
}
</script>

<template>
  <div class="flex grow flex-col items-center">
    <PageHeader />
    <div class="grid w-full max-w-md gap-2 px-2">
      <Label for="team-select">
        {{ $t("pages.join.labels.findInvite") }}
      </Label>
      <Select id="team-select" v-model="selectedCode">
        <SelectTrigger
          class="bg-background w-full truncate **:data-desc:hidden"
        >
          <SelectValue
            :placeholder="$t('pages.join.placeholders.selectInvitation')"
          />
        </SelectTrigger>
        <SelectContent>
          <template v-if="isAuthenticated">
            <SelectGroup v-if="pendingInvitations.length > 0">
              <SelectLabel>{{ $t("pages.join.labels.pending") }}</SelectLabel>
              <TooltipProvider>
                <Tooltip v-for="invite in pendingInvitations" :key="invite.id">
                  <TooltipTrigger as-child>
                    <SelectItem :value="invite.code">
                      <span class="font-semibold">
                        {{ invite.teamName }}
                        <span class="text-muted-foreground/50 text-xs">
                          [{{ invite.role }}]
                          {{ $t("pages.join.labels.invitedBy") }}
                          {{ invite.inviterName }}
                        </span>
                      </span>
                    </SelectItem>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {{ invite.inviterEmail }} on
                    {{ formatInvitationTimestamp(invite.createdAt) }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </SelectGroup>
            <SelectGroup v-else>
              <SelectLabel>
                {{ $t("pages.join.empty.noPending") }}
              </SelectLabel>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup v-if="declinedInvitations.length > 0">
              <SelectLabel>{{ $t("pages.join.labels.declined") }}</SelectLabel>
              <TooltipProvider>
                <Tooltip v-for="invite in declinedInvitations" :key="invite.id">
                  <TooltipTrigger as-child>
                    <SelectItem :value="invite.code">
                      <span class="font-semibold">
                        {{ invite.teamName }}
                        <span class="text-muted-foreground/50 text-xs">
                          [{{ invite.role }}] invited by
                          {{ invite.inviterName }}
                        </span>
                      </span>
                    </SelectItem>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {{ invite.inviterEmail }} on
                    {{ formatInvitationTimestamp(invite.createdAt) }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </SelectGroup>
            <SelectGroup v-else>
              <SelectLabel>
                {{ $t("pages.join.empty.noDeclined") }}
              </SelectLabel>
            </SelectGroup>
          </template>
        </SelectContent>
      </Select>
    </div>
    <OverlayScrollbarsWrapper
      class="w-full max-w-md items-center justify-between p-2"
    >
      <div
        class="bg-sidebar flex size-full flex-col items-center justify-between p-2"
      >
        <div class="m-auto grid grow flex-col items-center justify-center">
          <LoadingState
            v-if="isLoading"
            :label="$t('pages.join.states.loading')"
          />
          <Empty v-else-if="error">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconAlertTriangle />
              </EmptyMedia>
              <EmptyTitle>{{ $t("pages.join.states.error") }}</EmptyTitle>
              <EmptyDescription>{{ error }}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div class="flex gap-2">
                <Button
                  v-if="isEmailMismatch"
                  variant="default"
                  @click="handleLogout"
                >
                  {{ $t("actions.logout") }}
                </Button>
                <Button variant="outline" @click="handleIgnore">{{
                  $t("pages.join.buttons.goHome")
                }}</Button>
              </div>
            </EmptyContent>
          </Empty>
          <Empty v-else-if="invitation">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUserRoundPlus />
              </EmptyMedia>
              <EmptyTitle>
                {{
                  $t("pages.join.labels.joinTeam", {
                    teamName: invitation.teamName,
                  })
                }}
              </EmptyTitle>
              <EmptyDescription>
                {{
                  $t("pages.join.labels.invitedAs", {
                    inviterName: invitation.inviterName,
                    role: invitation.role,
                  })
                }}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <span>
                {{ invitation.inviterEmail }} sent this invitation on
                {{ formatInvitationTimestamp(invitation.createdAt) }}
              </span>
              <Badge
                v-if="invitation.status === 'declined'"
                variant="secondary"
              >
                {{ $t("pages.join.labels.hasDeclined") }}
              </Badge>
            </EmptyContent>
          </Empty>
          <Empty v-else>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUserRoundPlus />
              </EmptyMedia>
              <EmptyTitle>
                {{ $t("pages.join.placeholders.selectInvitation") }}
              </EmptyTitle>
              <EmptyDescription>
                {{ $t("pages.join.labels.findInvite") }}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
        <div
          v-if="invitation"
          class="bg-background flex w-full max-w-md flex-col items-center gap-2 p-2"
        >
          <div class="grid w-full gap-2">
            <template v-if="invitation.status === 'pending'">
              <Button size="lg" @click="handleAccept">
                {{ $t("pages.join.buttons.accept") }}
              </Button>
              <Button
                variant="outline"
                class="shadow-none"
                @click="handleDecline"
              >
                {{ $t("pages.join.buttons.decline") }}
              </Button>
            </template>
            <Button
              v-else
              variant="secondary"
              @click="handleDelete(invitation.id!)"
            >
              {{ $t("actions.delete") }}
            </Button>
          </div>
        </div>
      </div>
    </OverlayScrollbarsWrapper>
  </div>
</template>
