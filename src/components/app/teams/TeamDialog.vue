<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import { BUILT_IN_AGENTS, isBuiltInAgentId } from "@/data/builtInAgents"
import {
  IconAtSign,
  IconBot,
  IconCheck,
  IconForward,
  IconPlus,
  IconTrash,
  IconUsers,
  IconX,
} from "@/data/icons"
import { defaultTeamRole } from "@/helpers/defaults"
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/helpers/username"
import { checkUsernameAvailability } from "@/queries/username"
import {
  useInvitationStore,
  useTeamInvitations,
  type IInvitation,
} from "@/stores/invitationStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import type { ITeam } from "@/types/domain"
import {
  isAgentMembership,
  isMembershipRole,
  isUserMembership,
  type IMembershipAgentSnapshot,
  type IMembershipRole,
} from "@/types/membership"
import { Capabilities, roleCan } from "@/types/permissions"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

/** Member pending invite or already on team */
interface PendingMember {
  email: string
  role: IMembershipRole
  id?: string
  originalRole?: IMembershipRole
  /** Display name of an existing member (drives the avatar + row title). */
  name?: string
  /** Avatar photo of an existing member (`null`/absent ⇒ generative fallback). */
  photoURL?: string | null
}

/**
 * An agent staged to be added as a member, or (in edit mode) one already on
 * the team. Agents are always role "member" — no role field needed.
 */
interface PendingAgentMember {
  agentId: string
  name: string
  avatarSeed: string
  description?: string
  isBuiltIn: boolean
  /** True when already a team member (loaded in edit mode) vs. newly staged. */
  existing: boolean
}

/** A selectable agent option surfaced in the invite combobox. */
interface AgentOption {
  id: string
  name: string
  description: string
  avatarSeed: string
  isBuiltIn: boolean
}

/** Result of a single invite attempt */
interface InviteResult {
  email: string
  success: boolean
  error?: Error
}

const props = defineProps<{
  open?: boolean
  mode: "create" | "invite" | "edit"
  team?: ITeam
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "success"): void
}>()

const { t } = useI18n()

// Local Invitation Query (moved up for permissions)
const targetTeamId = computed(() => {
  if (props.mode === "create") return null
  return props.team?.id
})

const {
  createTeam,
  updateTeam,
  canUpdateTeam,
  getCannotUpdateTeamReason,
  canInviteMembers,
  getCannotInviteMembersReason,
} = useTeamActions(targetTeamId)

const membershipStore = useMembershipStore()
const invitationStore = useInvitationStore()
const teamAgentsStore = useTeamAgentsStore()
const user = useCurrentUser()

// State
const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const teamName = ref("")
const teamUsername = ref("")
const teamIsPublic = ref(false)
const inviteEmail = ref("")
const inviteRole = ref<IMembershipRole>(defaultTeamRole)
const members = ref<PendingMember[]>([])
const agentMembers = ref<PendingAgentMember[]>([])
const removedAgentIds = ref<string[]>([])
const invitePickerOpen = ref(false)
const removedMemberIds = ref<string[]>([])
const originalMemberRoles = ref<Record<string, IMembershipRole>>({})
/** Staged role edits for already-sent invitations (id → role), applied on Save. */
const invitationRoleEdits = ref<Record<string, IMembershipRole>>({})
const isCheckingTeamUsername = ref(false)
const teamUsernameAvailable = ref<boolean | null>(null)
const teamUsernameError = ref<string | null>(null)

const teamInvitations = useTeamInvitations(targetTeamId)

// Computed
const activeMembers = computed(() => {
  return members.value.filter((m) => !!m.id)
})

// Emails that already have a live PENDING invitation — including the optimistic
// row `sendInvitation` adds synchronously at submit. A staged draft is hidden
// the moment its invitation appears, so the same email never renders twice
// (editable draft + pending row) during the send round-trip. If a send fails,
// its optimistic invitation rolls back and the draft reappears for retry — no
// extra bookkeeping. Emails are normalized to match `sendInvitation`'s
// trim+lowercase.
const pendingInvitationEmails = computed(
  () =>
    new Set(
      teamInvitations.value
        .filter((invite) => invite.status === "pending")
        .map((invite) => invite.email.trim().toLowerCase())
    )
)

const stagedInvites = computed(() =>
  members.value.filter(
    (m) =>
      !m.id && !pendingInvitationEmails.value.has(m.email.trim().toLowerCase())
  )
)

const userRole = computed(() => {
  if (props.mode === "create") return "owner"
  if (!props.team) return null
  const membership = membershipStore.memberships.find(
    (m) => m.teamId === props.team?.id
  )
  return membership?.role ?? null
})

const isPrivileged = computed(() => {
  return roleCan(userRole.value, Capabilities.INVITE_MEMBER)
})

const canManageOwnerRoles = computed(
  () => props.mode === "create" || userRole.value === "owner"
)
const ownerRoleManagementReason = computed(() =>
  t("components.teamDialog.errors.ownerRoleRequiresOwner")
)

const canShowTeamInvitations = computed(() => {
  return (
    (props.mode === "edit" || props.mode === "invite") && isPrivileged.value
  )
})

const visibleTeamInvitations = computed(() => {
  if (!canShowTeamInvitations.value) return []

  if (props.mode === "invite") {
    return teamInvitations.value.filter((invite) => invite.status === "pending")
  }

  return teamInvitations.value
})

const currentTeamUsername = computed(() => props.team?.username ?? "")
const currentTeamIsPublic = computed(() => props.team?.isPublic ?? false)
const hasTeamUsername = computed(() => {
  const usernameInput = teamUsername.value.trim()
  return usernameInput.length >= USERNAME_MIN_LENGTH
})
const hasValidTeamUsername = computed(() => {
  if (!teamUsername.value.trim()) return false
  return validateUsername(teamUsername.value).valid
})

// Photo Upload State
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)

/** Revoke blob URL to prevent memory leaks */
const revokeBlobUrl = () => {
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
}

const teamPhotoUpload = usePhotoUpload({
  canUpload: () => canUpdateTeam.value || props.mode === "create",
  onUpload: async (_id, file) => {
    revokeBlobUrl()
    photoFile.value = file
    photoPreview.value = URL.createObjectURL(file)
  },
})

const triggerTeamPhotoSelection = () => {
  if (!canUpdateTeam.value && props.mode !== "create") return
  teamPhotoUpload.triggerUpload(props.team?.id || "draft-team")
}

const removePhoto = () => {
  revokeBlobUrl()
  photoFile.value = null
  photoPreview.value = null
}

const resetForm = () => {
  revokeBlobUrl()
  teamName.value = ""
  teamUsername.value = ""
  teamIsPublic.value = false
  inviteEmail.value = ""
  inviteRole.value = defaultTeamRole
  members.value = []
  agentMembers.value = []
  removedAgentIds.value = []
  invitePickerOpen.value = false
  removedMemberIds.value = []
  originalMemberRoles.value = {}
  invitationRoleEdits.value = {}
  photoFile.value = null
  photoPreview.value = null
  teamUsernameAvailable.value = null
  teamUsernameError.value = null
  isCheckingTeamUsername.value = false
}

const checkTeamUsername = async () => {
  const usernameInput = teamUsername.value.trim()

  if (!usernameInput) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }

  if (
    props.mode === "edit" &&
    usernamesMatch(usernameInput, currentTeamUsername.value)
  ) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }

  const validation = validateUsername(usernameInput)
  if (!validation.valid) {
    teamUsernameAvailable.value = false
    teamUsernameError.value = validation.error
    return
  }

  teamUsernameError.value = null
  isCheckingTeamUsername.value = true

  try {
    teamUsernameAvailable.value = await checkUsernameAvailability(usernameInput)
    if (!teamUsernameAvailable.value) {
      teamUsernameError.value = t("components.teamDialog.errors.usernameTaken")
    }
  } finally {
    isCheckingTeamUsername.value = false
  }
}

const debouncedCheckTeamUsername = useDebounceFn(checkTeamUsername, 500)

const handleTeamUsernameInput = () => {
  if (!teamUsername.value.trim()) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }
  debouncedCheckTeamUsername()
}

const toggleTeamIsPublic = (value: boolean) => {
  if (value && !hasValidTeamUsername.value) {
    toast.error(t("components.teamDialog.errors.publicTeamRequiresUsername"))
    return
  }

  teamIsPublic.value = value
}

// Sync internal open state with prop
watch(
  () => props.open,
  (val) => {
    isOpen.value = val ?? false
  }
)

watch(hasValidTeamUsername, (isValid) => {
  if (!isValid && teamIsPublic.value) {
    teamIsPublic.value = false
  }
})

watch(isOpen, async (val) => {
  emit("update:open", val)
  if (!val) {
    resetForm()
  } else {
    // Initialize form when opened
    if (props.mode === "edit" && props.team) {
      isLoading.value = true
      try {
        teamName.value = props.team.name
        teamUsername.value = props.team.username ?? ""
        teamIsPublic.value = props.team.isPublic ?? false
        photoPreview.value = props.team.photoURL || null
        // Load existing team members (users + agents) for the specific team
        const allMembers = await membershipStore.getMembersForTeam(
          props.team.id
        )
        const userMembers = allMembers.filter(isUserMembership)
        const agentMemberRecords = allMembers.filter(isAgentMembership)
        originalMemberRoles.value = Object.fromEntries(
          userMembers.map((membership) => [membership.userId, membership.role])
        )
        members.value = userMembers.map((membership) => ({
          email: membership.user.email!,
          role: membership.role,
          id: membership.userId,
          originalRole: membership.role,
          name: membership.user.displayName ?? undefined,
          photoURL: membership.user.photoURL ?? null,
        }))
        agentMembers.value = agentMemberRecords.map((membership) => ({
          agentId: membership.agentId,
          name: membership.agent.name,
          avatarSeed: membership.agent.avatarSeed ?? "",
          description: membership.agent.description,
          isBuiltIn: membership.agent.isBuiltIn ?? false,
          existing: true,
        }))
      } finally {
        isLoading.value = false
      }
    } else if (props.mode === "create") {
      teamUsername.value = ""
      teamIsPublic.value = false
    }
  }
})

// Helpers

/** Validate email format */
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

/** Best label for a member row: their display name when known, else email. */
const memberLabel = (member: PendingMember) => member.name || member.email

/**
 * Team role options ordered most→least privileged. `owner` is gated to owners
 * at the call site (`canManageOwnerRoles`); the rest are always assignable.
 */
const teamRoleOptions = ["owner", "admin", "member", "guest"] as const

// ── Agent invite combobox ────────────────────────────────────────────────────

/** Agents available to add: built-ins (always) + the team's custom agents. */
const availableAgents = computed<AgentOption[]>(() => {
  if (props.mode === "create") {
    // No team exists yet — only the shipped built-in presets can be staged.
    return BUILT_IN_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      avatarSeed: agent.avatarSeed,
      isBuiltIn: true,
    }))
  }
  return teamAgentsStore.pickerAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    avatarSeed: agent.avatarSeed,
    isBuiltIn: isBuiltInAgentId(agent.id),
  }))
})

/** Agent ids already members or staged — excluded from the picker. */
const takenAgentIds = computed(() => {
  const ids = new Set<string>()
  agentMembers.value.forEach((agent) => ids.add(agent.agentId))
  // In create mode the new team has no members yet, so only staged agents
  // count; otherwise also exclude agents already on the team.
  if (props.mode !== "create") {
    membershipStore.teamMembers.forEach((member) => {
      if (isAgentMembership(member)) ids.add(member.agentId)
    })
  }
  return ids
})

/**
 * Agents the user can still add — taken ones removed. The combobox's own
 * `<Command>` handles the text search (matching each item's content), so this
 * is only the business-level "not already a member/staged" filter.
 */
const pickableAgents = computed<AgentOption[]>(() =>
  availableAgents.value.filter((agent) => !takenAgentIds.value.has(agent.id))
)

/**
 * Stage an agent to be added as a member (role is locked to "member"). The
 * picker stays open so several agents can be added in a row — the just-staged
 * one drops out of `pickableAgents`, and `<Command>` clears its own search on
 * select.
 */
const stageAgent = (agent: AgentOption) => {
  if (!canInviteMembers.value && props.mode !== "create") {
    toast.error(t(getCannotInviteMembersReason.value || ""))
    return
  }
  if (takenAgentIds.value.has(agent.id)) return
  agentMembers.value.push({
    agentId: agent.id,
    name: agent.name,
    avatarSeed: agent.avatarSeed,
    description: agent.description,
    isBuiltIn: agent.isBuiltIn,
    existing: false,
  })
}

/** Remove a staged or already-existing agent member from the dialog. */
const removeAgent = (agentId: string) => {
  const target = agentMembers.value.find((agent) => agent.agentId === agentId)
  if (target?.existing) removedAgentIds.value.push(agentId)
  agentMembers.value = agentMembers.value.filter(
    (agent) => agent.agentId !== agentId
  )
}

const stagedAgentMembers = computed(() =>
  agentMembers.value.filter((agent) => !agent.existing)
)

const agentAvatarSeed = (agent: { avatarSeed: string; name: string }) =>
  agent.avatarSeed.trim() || agent.name.trim() || "Agent"

/**
 * Commit staged agent members to a team as real memberships. Returns the
 * count of failures so the caller can surface a partial-failure toast.
 */
const commitAgentAdditions = async (teamId: string): Promise<number> => {
  const toAdd = agentMembers.value.filter((agent) => !agent.existing)
  if (toAdd.length === 0) return 0
  const results = await Promise.allSettled(
    toAdd.map((agent) => {
      const snapshot: IMembershipAgentSnapshot = {
        id: agent.agentId,
        name: agent.name,
        description: agent.description,
        avatarSeed: agent.avatarSeed,
        isBuiltIn: agent.isBuiltIn,
      }
      return membershipStore.addAgentMember(teamId, agent.agentId, snapshot)
    })
  )
  return results.filter((result) => result.status === "rejected").length
}

/** Remove agent memberships flagged for removal during an edit. */
const commitAgentRemovals = async (teamId: string): Promise<void> => {
  if (removedAgentIds.value.length === 0) return
  await Promise.allSettled(
    removedAgentIds.value.map((agentId) =>
      membershipStore.removeAgentMember(teamId, agentId)
    )
  )
}

/**
 * Invite members via invitationStore.
 */
const inviteMembers = async (
  teamId: string,
  team: ITeam,
  membersToInvite: PendingMember[]
): Promise<InviteResult[]> => {
  const results = await Promise.all(
    membersToInvite.map(async (member): Promise<InviteResult> => {
      if (!isMembershipRole(member.role)) {
        return {
          email: member.email,
          success: false,
          error: new Error("Invalid invitation role."),
        }
      }

      try {
        await invitationStore.sendInvitation({
          teamId,
          teamName: team.name,
          email: member.email,
          role: member.role,
        })
        return { email: member.email, success: true }
      } catch (error) {
        console.error(`Failed to invite ${member.email}:`, error)
        return { email: member.email, success: false, error: error as Error }
      }
    })
  )
  return results
}

/** Show appropriate toast based on invite results */
const showInviteResultToast = (results: InviteResult[]) => {
  const succeeded = results.filter((r) => r.success).length
  const failed = results.length - succeeded

  if (failed === 0) {
    toast.success(
      t("components.teamDialog.toasts.invitedAll", { count: succeeded })
    )
  } else if (succeeded === 0) {
    toast.error(t("components.teamDialog.toasts.inviteFailed"))
  } else {
    toast.warning(
      t("components.teamDialog.toasts.invitePartial", { succeeded, failed })
    )
  }
}

// Resend Invitation State
const resendingIds = ref<Set<string>>(new Set())

const isResending = (id: string) => resendingIds.value.has(id)

const handleResendInvitation = async (invite: IInvitation) => {
  if (!invite.id) return

  resendingIds.value.add(invite.id)
  try {
    await invitationStore.resendInvitation(invite)
    toast.success(t("components.teamDialog.toasts.inviteResent"))
  } catch (error) {
    console.error("Failed to resend invitation:", error)
    toast.error(t("components.teamDialog.toasts.resendFailed"))
  } finally {
    // The old invite is deleted, so we don't strictly need to remove it from the set if the component re-renders quickly,
    // but good practice to clean up.
    // Note: Since the ID changes, the button essentially disappears/is replaced by the new invite row.
    resendingIds.value.delete(invite.id)
  }
}

/** The displayed role for a sent invitation — its staged edit, else stored role. */
const invitationRoleValue = (invite: IInvitation): IMembershipRole =>
  (invite.id ? invitationRoleEdits.value[invite.id] : undefined) ?? invite.role

/**
 * Stage a sent-invitation role change locally (mirrors how active-member role
 * edits work) — committed on Save via `applyStagedInvitationRoles`, discarded on
 * Cancel. Cancel/resend of invitations stay immediate; only the role is staged.
 */
const stageInvitationRole = (invite: IInvitation, value: unknown) => {
  if (!isMembershipRole(value)) {
    toast.error(t("components.teamDialog.errors.invalidInvitationRole"))
    return
  }
  if (
    !canManageOwnerRoles.value &&
    (value === "owner" || invite.role === "owner")
  ) {
    toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
    return
  }
  if (!invite.id) return
  const next = { ...invitationRoleEdits.value }
  // Reverting to the stored role drops the staged edit (keeps the diff clean).
  if (value === invite.role) delete next[invite.id]
  else next[invite.id] = value
  invitationRoleEdits.value = next
}

/**
 * Commit staged sent-invitation role changes. Skips any edit whose invitation
 * was cancelled/resent (id no longer live) in the meantime; genuine failures
 * bubble to `handleSubmit`'s catch, like the active-member role updates.
 */
const applyStagedInvitationRoles = async (): Promise<void> => {
  const live = new Set(teamInvitations.value.map((invite) => invite.id))
  const edits = Object.entries(invitationRoleEdits.value).filter(([id]) =>
    live.has(id)
  )
  if (edits.length === 0) return
  await Promise.all(
    edits.map(([invitationId, role]) =>
      invitationStore.updateInvitationRole(invitationId, role)
    )
  )
}

// Actions

const addMember = (e?: Event) => {
  e?.preventDefault()

  const email = inviteEmail.value.trim()
  if (!email) return

  // Validate email format
  if (!isValidEmail(email)) {
    toast.error(t("components.teamDialog.errors.invalidEmail"))
    return
  }

  // Check if email already exists
  if (members.value.some((m) => m.email === email)) {
    toast.error(t("components.teamDialog.errors.emailAlreadyAdded"))
    return
  }

  // Check if email is current user's email
  if (user.value?.email === email) {
    toast.error(t("components.teamDialog.errors.cannotInviteSelf"))
    return
  }

  if (!canManageOwnerRoles.value && inviteRole.value === "owner") {
    toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
    return
  }

  members.value.push({
    email: email,
    role: inviteRole.value,
  })
  inviteEmail.value = ""
  inviteRole.value = defaultTeamRole
}

const removeMember = (email: string, id?: string) => {
  const existingMember = members.value.find((member) =>
    id ? member.id === id : member.email === email
  )
  if (
    existingMember &&
    !canManageOwnerRoles.value &&
    (existingMember.role === "owner" || existingMember.originalRole === "owner")
  ) {
    toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
    return
  }

  if (id) {
    removedMemberIds.value.push(id)
  }
  members.value = members.value.filter((m) => m.email !== email)
}

const isOwnerRoleManagedMember = (member: PendingMember) =>
  member.role === "owner" || member.originalRole === "owner"

const isMemberRoleUpdateDisabled = (member: PendingMember) =>
  !canManageOwnerRoles.value && isOwnerRoleManagedMember(member)

const isMemberRemovalDisabled = (member: PendingMember) =>
  !canManageOwnerRoles.value && isOwnerRoleManagedMember(member)

const isAddMemberBlockedByOwnerPolicy = computed(
  () => !canManageOwnerRoles.value && inviteRole.value === "owner"
)

const addMemberDisabledReason = computed(() => {
  if (!canInviteMembers.value && props.mode !== "create") {
    return t(getCannotInviteMembersReason.value || "")
  }
  if (isAddMemberBlockedByOwnerPolicy.value) {
    return ownerRoleManagementReason.value
  }
  return null
})

const handleSubmit = async () => {
  if (props.mode !== "invite" && !teamName.value.trim()) return

  isLoading.value = true
  try {
    if (props.mode === "create") {
      const trimmedUsername = teamUsername.value.trim()
      let usernamePayload: string | undefined = undefined
      let isPublicPayload: boolean | undefined = undefined

      if (!trimmedUsername) {
        teamUsernameAvailable.value = null
        teamUsernameError.value = null
      } else {
        const validation = validateUsername(trimmedUsername)
        if (!validation.valid || !validation.normalized) {
          teamUsernameAvailable.value = false
          teamUsernameError.value = validation.error || null
          toast.error(t("components.teamDialog.errors.invalidUsername"), {
            description: validation.error || undefined,
          })
          return
        }

        const isAvailable = await checkUsernameAvailability(
          validation.normalized
        )
        teamUsernameAvailable.value = isAvailable
        teamUsernameError.value = isAvailable
          ? null
          : t("components.teamDialog.errors.usernameTaken")
        if (!isAvailable) {
          toast.error(t("components.teamDialog.errors.usernameTaken"))
          return
        }

        usernamePayload = validation.normalized
      }

      if (teamIsPublic.value && !usernamePayload) {
        toast.error(
          t("components.teamDialog.errors.publicTeamRequiresUsername")
        )
        return
      }

      if (teamIsPublic.value) {
        isPublicPayload = true
      }

      // 1. Create Team (useTeamActions handles success toast)
      const newTeamId = await createTeam(teamName.value, {
        photoFile: photoFile.value || undefined,
        username: usernamePayload,
        isPublic: isPublicPayload,
      })

      // 2. Invite Members to New Team
      if (newTeamId && members.value.length > 0) {
        // Construct minimal team object for invitations
        // We cast to ITeam because we know inviteMembers only needs name and id for sending invites
        const newTeam = {
          id: newTeamId,
          name: teamName.value,
        } as ITeam

        const results = await inviteMembers(newTeam.id, newTeam, members.value)
        if (results.some((r) => !r.success)) {
          showInviteResultToast(results)
        }
      }

      // Add staged agents to the new team (direct memberships, no invite)
      if (newTeamId && agentMembers.value.length > 0) {
        const agentFailures = await commitAgentAdditions(newTeamId)
        if (agentFailures > 0) {
          toast.warning(
            t("components.teamDialog.toasts.agentsPartial", {
              failed: agentFailures,
            })
          )
        }
      }
    } else if (props.mode === "edit" && props.team) {
      // 1. Update Team (useTeamActions handles success toast)
      let filePayload: File | null | undefined = undefined
      if (photoFile.value) {
        filePayload = photoFile.value
      } else if (
        props.team.photoURL &&
        !photoPreview.value &&
        !photoFile.value
      ) {
        filePayload = null // Signal to remove photo
      }

      const trimmedUsername = teamUsername.value.trim()
      let usernamePayload: string | null | undefined = undefined
      let isPublicPayload: boolean | undefined = undefined

      if (!trimmedUsername) {
        if (currentTeamUsername.value) {
          usernamePayload = null
        }
      } else {
        const validation = validateUsername(trimmedUsername)
        if (!validation.valid || !validation.normalized) {
          toast.error(t("components.teamDialog.errors.invalidUsername"), {
            description: validation.error || undefined,
          })
          return
        }

        if (
          teamUsernameAvailable.value === false &&
          !usernamesMatch(validation.normalized, currentTeamUsername.value)
        ) {
          toast.error(t("components.teamDialog.errors.usernameTaken"))
          return
        }

        if (!usernamesMatch(validation.normalized, currentTeamUsername.value)) {
          usernamePayload = validation.normalized
        }
      }

      if (teamIsPublic.value && !trimmedUsername) {
        toast.error(
          t("components.teamDialog.errors.publicTeamRequiresUsername")
        )
        return
      }

      if (teamIsPublic.value !== currentTeamIsPublic.value) {
        isPublicPayload = teamIsPublic.value
      }

      // Keep behavior aligned with user profiles: clearing handle turns off public visibility.
      if (
        usernamePayload === null &&
        isPublicPayload === undefined &&
        currentTeamIsPublic.value
      ) {
        isPublicPayload = false
      }

      await updateTeam(props.team.id, {
        name: teamName.value,
        photoFile: filePayload,
        username: usernamePayload,
        isPublic: isPublicPayload,
      })

      // 2. Process Member Changes
      const membersToUpdate = members.value.filter(
        (m) => m.id && m.role !== m.originalRole
      )
      const newMembers = members.value.filter((m) => !m.id)
      const isRemovingOwners = removedMemberIds.value.some(
        (id) => originalMemberRoles.value[id] === "owner"
      )
      const isChangingOwnerRoles = membersToUpdate.some(
        (member) => member.role === "owner" || member.originalRole === "owner"
      )
      const isInvitingOwners = newMembers.some(
        (member) => member.role === "owner"
      )

      if (
        !canManageOwnerRoles.value &&
        (isRemovingOwners || isChangingOwnerRoles || isInvitingOwners)
      ) {
        toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
        return
      }

      // Remove deleted members
      if (removedMemberIds.value.length > 0) {
        await membershipStore.removeMembers(
          props.team.id,
          removedMemberIds.value
        )
      }

      // Update existing member roles if changed
      if (membersToUpdate.length > 0) {
        const updatePromises = membersToUpdate.map((member) =>
          membershipStore.changeRole(props.team!.id, member.id!, member.role)
        )
        await Promise.all(updatePromises)
      }

      // Commit staged role changes to already-sent invitations (mirrors the
      // active-member role updates above).
      await applyStagedInvitationRoles()

      // Invite new members (those without an id)
      if (newMembers.length > 0) {
        const results = await inviteMembers(
          props.team.id,
          props.team,
          newMembers
        )
        if (results.some((r) => !r.success)) {
          showInviteResultToast(results)
        }
      }

      // Agent membership changes: removals first, then additions
      await commitAgentRemovals(props.team.id)
      const editAgentFailures = await commitAgentAdditions(props.team.id)
      if (editAgentFailures > 0) {
        toast.warning(
          t("components.teamDialog.toasts.agentsPartial", {
            failed: editAgentFailures,
          })
        )
      }
    } else if (props.mode === "invite") {
      // Invite Mode
      const targetTeam = props.team
      if (!targetTeam) throw new Error(t("components.teamDialog.errors.noTeam"))
      if (
        !canManageOwnerRoles.value &&
        members.value.some((member) => member.role === "owner")
      ) {
        toast.error(t("components.teamDialog.errors.ownerRoleRequiresOwner"))
        return
      }

      // Commit staged role changes to already-sent invitations (this tab shows
      // them in invite mode too, so the same flush the edit branch runs is
      // needed here — otherwise the change is staged and silently dropped).
      await applyStagedInvitationRoles()

      if (members.value.length > 0) {
        const results = await inviteMembers(
          targetTeam.id,
          targetTeam,
          members.value
        )
        showInviteResultToast(results)
      }

      // Add staged agents directly (no invitation handshake)
      const stagedAgentCount = stagedAgentMembers.value.length
      const inviteAgentFailures = await commitAgentAdditions(targetTeam.id)
      if (inviteAgentFailures > 0) {
        toast.warning(
          t("components.teamDialog.toasts.agentsPartial", {
            failed: inviteAgentFailures,
          })
        )
      } else if (stagedAgentCount > 0) {
        toast.success(
          t("components.teamDialog.toasts.agentsAdded", {
            count: stagedAgentCount,
          })
        )
      }
    }

    emit("success")
    isOpen.value = false
  } catch (error) {
    console.error(error)
    toast.error(
      props.mode === "create"
        ? t("components.teamDialog.errors.failedToCreate")
        : props.mode === "edit"
          ? t("components.teamDialog.errors.failedToUpdate")
          : t("components.teamDialog.errors.failedToInvite"),
      {
        description: (error as Error).message,
      }
    )
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogTrigger as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogContent class="w-2xl max-w-fit">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === "create"
              ? t("components.teamDialog.title.create")
              : mode === "edit"
                ? t("components.teamDialog.title.edit")
                : t("components.teamDialog.title.invite")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? t("components.teamDialog.description.create")
              : mode === "edit"
                ? t("components.teamDialog.description.edit")
                : t("components.teamDialog.description.invite")
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Team Profile Picture (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <div class="flex flex-col items-center gap-2">
            <FieldLabel class="text-secondary-foreground text-xs">
              {{ t("components.teamDialog.labels.teamPhoto") }}
            </FieldLabel>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <div
                      :class="[
                        'bg-secondary rounded-full p-3',
                        {
                          'cursor-not-allowed opacity-50':
                            !canUpdateTeam && mode === 'edit',
                        },
                      ]"
                    >
                      <AppAvatar
                        class="size-16"
                        :class="{
                          'cursor-pointer': canUpdateTeam || mode === 'create',
                        }"
                        :src="photoPreview"
                        :name="teamName"
                        @click="triggerTeamPhotoSelection"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent v-if="!canUpdateTeam && mode === 'edit'">
                    {{ t(getCannotUpdateTeamReason || "") }}
                  </TooltipContent>
                  <TooltipContent v-else>
                    {{ t("components.teamDialog.tooltips.uploadPhoto") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip
                  v-if="photoPreview && (canUpdateTeam || mode === 'create')"
                >
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute top-1 right-1 size-4 opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon"
                      @click.stop="removePhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.teamDialog.tooltips.removePhoto") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </Field>

        <!-- Team Name (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <FieldLabel class="text-secondary-foreground text-xs" for="name">
            {{ t("components.teamDialog.labels.teamName") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Input
                    id="name"
                    v-model="teamName"
                    :placeholder="
                      $t('components.teamDialog.placeholders.teamName')
                    "
                    :disabled="!canUpdateTeam && mode === 'edit'"
                    @keyup.enter="handleSubmit"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canUpdateTeam && mode === 'edit'">
                {{ t(getCannotUpdateTeamReason || "") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!-- Team Public Profile (Create/Edit Mode) -->
        <Field v-if="mode === 'create' || mode === 'edit'" class="grid gap-2">
          <FieldLabel
            class="text-secondary-foreground text-xs"
            for="team-username"
          >
            {{ t("components.teamDialog.labels.publicHandle") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <InputGroup>
                    <InputGroupInput
                      id="team-username"
                      v-model="teamUsername"
                      :placeholder="
                        $t('components.teamDialog.placeholders.publicHandle')
                      "
                      :maxlength="USERNAME_MAX_LENGTH"
                      :disabled="!canUpdateTeam && mode === 'edit'"
                      @input="handleTeamUsernameInput"
                    />
                    <InputGroupAddon align="inline-end">
                      <TooltipProvider>
                        <Tooltip v-if="isCheckingTeamUsername">
                          <TooltipTrigger as-child>
                            <Spinner />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t("settings.account.username.checking") }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip v-else-if="teamUsernameAvailable === true">
                          <TooltipTrigger as-child>
                            <IconCheck class="text-green-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t("settings.account.username.available") }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip v-else-if="teamUsernameAvailable === false">
                          <TooltipTrigger as-child>
                            <IconX class="text-red-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ teamUsernameError }}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip v-else>
                          <TooltipTrigger as-child>
                            <IconAtSign />
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t("settings.account.username.checkPrompt") }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canUpdateTeam && mode === 'edit'">
                {{ t(getCannotUpdateTeamReason || "") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <p v-if="teamUsernameError" class="text-xs text-red-500">
            {{ teamUsernameError }}
          </p>
        </Field>

        <Field
          v-if="mode === 'create' || mode === 'edit'"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel
              for="team-is-public"
              class="text-secondary-foreground text-xs"
            >
              {{ t("components.teamDialog.labels.publicTeam") }}
            </FieldLabel>
            <FieldDescription class="text-xs">
              {{
                teamIsPublic
                  ? t("components.teamDialog.tooltips.publicTeamUrl", {
                      url: `/${teamUsername.trim()}`,
                    })
                  : t("components.teamDialog.tooltips.turnOnPublicTeam")
              }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <span>
                  <Switch
                    id="team-is-public"
                    :model-value="teamIsPublic"
                    :disabled="
                      !hasValidTeamUsername ||
                      (!canUpdateTeam && mode === 'edit')
                    "
                    @update:model-value="toggleTeamIsPublic"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  !canUpdateTeam && mode === "edit"
                    ? t(getCannotUpdateTeamReason || "")
                    : !hasTeamUsername
                      ? t("components.teamDialog.tooltips.requiresHandle")
                      : teamIsPublic
                        ? t("components.teamDialog.tooltips.publicTeamUrl", {
                            url: `/${teamUsername.trim()}`,
                          })
                        : t("components.teamDialog.tooltips.turnOnPublicTeam")
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <Tabs :default-value="mode === 'edit' ? 'members' : 'invite'">
          <TabsList class="m-0 h-auto! gap-2 bg-transparent p-0">
            <TabsTrigger
              v-if="mode === 'edit'"
              value="members"
              class="text-secondary-foreground data-[state=inactive]:text-secondary-foreground/50 h-auto p-0 text-xs data-[state=active]:shadow-none!"
            >
              {{ t("components.teamDialog.labels.members") }}
            </TabsTrigger>
            <TabsTrigger
              value="invite"
              class="text-secondary-foreground data-[state=inactive]:text-secondary-foreground/50 h-auto p-0 text-xs data-[state=active]:shadow-none!"
            >
              {{ t("components.teamDialog.labels.invite") }}
            </TabsTrigger>
          </TabsList>

          <!-- ── Current members (Edit mode) ────────────────────────────────
             Existing team members with avatar + editable role. Owner rows are
             locked (role + removal) unless the actor is an owner. -->
          <Field class="grid gap-2">
            <TabsContent v-if="mode === 'edit'" value="members" class="p-0">
              <Empty
                v-if="activeMembers.length === 0"
                class="border border-dashed p-6"
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconUsers />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ t("components.teamDialog.labels.noActiveMembers") }}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
              <ItemGroup v-else class="bg-secondary rounded-2xl p-3">
                <Item
                  v-for="member in activeMembers"
                  :key="member.id"
                  size="sm"
                  class="p-0"
                >
                  <ItemMedia>
                    <AppAvatar
                      :src="member.photoURL"
                      :name="memberLabel(member)"
                    />
                  </ItemMedia>
                  <ItemContent class="truncate">
                    <ItemTitle>
                      <span class="truncate">{{ memberLabel(member) }}</span>
                    </ItemTitle>
                    <ItemDescription
                      v-if="
                        member.email && member.email !== memberLabel(member)
                      "
                      class="text-xs"
                    >
                      {{ member.email }}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <!-- Role select; disabled on owner rows the actor can't manage
                     (the remove button's tooltip explains why). -->
                    <Select
                      v-model="member.role"
                      :disabled="isMemberRoleUpdateDisabled(member)"
                    >
                      <Button variant="outline" as-child>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </Button>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem
                            v-for="role in teamRoleOptions"
                            :key="role"
                            :value="role"
                            :disabled="role === 'owner' && !canManageOwnerRoles"
                          >
                            {{ t(`components.teamDialog.roles.${role}`) }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <!-- Remove member -->
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="outline"
                            size="icon"
                            :disabled="isMemberRemovalDisabled(member)"
                            @click="removeMember(member.email, member.id)"
                          >
                            <IconTrash />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{
                            isMemberRemovalDisabled(member)
                              ? ownerRoleManagementReason
                              : t("components.teamDialog.tooltips.removeMember")
                          }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </ItemActions>
                </Item>
              </ItemGroup>
            </TabsContent>

            <!-- ── Invite (all modes) ─────────────────────────────────────────
             Entry form: invite a person by email, or add an agent via the
             picker, with the role to grant. Staged rows appear under
             "Invitations" below until Save. -->
            <TabsContent value="invite" class="grid gap-2 p-0">
              <!-- Email input + agent picker -->
              <ButtonGroup>
                <ButtonGroup>
                  <Popover v-model:open="invitePickerOpen">
                    <PopoverAnchor as-child>
                      <InputGroup>
                        <InputGroupInput
                          id="invite"
                          v-model="inviteEmail"
                          :placeholder="
                            $t(
                              'components.teamDialog.placeholders.inviteOrAgent'
                            )
                          "
                          autocomplete="off"
                          :disabled="!canInviteMembers && mode !== 'create'"
                          @keydown.enter.prevent="addMember"
                        />
                        <InputGroupAddon align="inline-end">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <PopoverTrigger as-child>
                                  <InputGroupButton
                                    size="icon-xs"
                                    :disabled="
                                      !canInviteMembers && mode !== 'create'
                                    "
                                    :aria-label="
                                      t(
                                        'components.teamDialog.tooltips.addAgent'
                                      )
                                    "
                                  >
                                    <IconBot />
                                  </InputGroupButton>
                                </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent
                                v-if="!canInviteMembers && mode !== 'create'"
                              >
                                {{ t(getCannotInviteMembersReason || "") }}
                              </TooltipContent>
                              <TooltipContent v-else>
                                {{
                                  t("components.teamDialog.tooltips.addAgent")
                                }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </InputGroupAddon>
                      </InputGroup>
                    </PopoverAnchor>
                    <PopoverContent
                      align="start"
                      class="w-(--reka-popover-trigger-width) p-0"
                    >
                      <Command>
                        <CommandInput
                          :placeholder="
                            $t(
                              'components.teamDialog.placeholders.searchAgents'
                            )
                          "
                          class="placeholder:text-muted-foreground border-none bg-transparent focus:border-inherit focus:ring-0"
                        />
                        <CommandList>
                          <CommandEmpty v-if="pickableAgents.length > 0">
                            {{
                              t("components.teamDialog.labels.noAgentMatches")
                            }}
                          </CommandEmpty>
                          <p
                            v-else
                            class="text-muted-foreground p-3 text-center text-xs"
                          >
                            {{
                              t("components.teamDialog.labels.noAgentMatches")
                            }}
                          </p>
                          <CommandGroup>
                            <CommandItem
                              v-for="agent in pickableAgents"
                              :key="agent.id"
                              :value="agent.id"
                              @select="stageAgent(agent)"
                            >
                              <AppAvatar
                                class="size-7"
                                variant="beam"
                                :name="agentAvatarSeed(agent)"
                              />
                              <span class="flex min-w-0 flex-col">
                                <span
                                  class="flex items-center gap-1.5 truncate text-sm"
                                >
                                  {{ agent.name }}
                                  <Badge variant="secondary">
                                    {{
                                      t(
                                        "components.teamDialog.labels.agentBadge"
                                      )
                                    }}
                                  </Badge>
                                </span>
                                <span
                                  v-if="agent.description"
                                  class="text-muted-foreground truncate text-xs"
                                >
                                  {{ agent.description }}
                                </span>
                              </span>
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </ButtonGroup>
                <ButtonGroup>
                  <!-- Role to grant + add button -->
                  <Select
                    v-model="inviteRole"
                    :disabled="!canInviteMembers && mode !== 'create'"
                  >
                    <Button variant="outline" as-child>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </Button>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem
                          v-for="role in teamRoleOptions"
                          :key="role"
                          :value="role"
                          :disabled="role === 'owner' && !canManageOwnerRoles"
                        >
                          {{ t(`components.teamDialog.roles.${role}`) }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </ButtonGroup>
                <ButtonGroup>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="outline"
                          size="icon"
                          :disabled="
                            (!canInviteMembers && mode !== 'create') ||
                            isAddMemberBlockedByOwnerPolicy
                          "
                          @click="addMember"
                        >
                          <IconPlus />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {{
                          addMemberDisabledReason ||
                          t("components.teamDialog.tooltips.addMember")
                        }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </ButtonGroup>
              </ButtonGroup>

              <!-- ── Invitations (staged drafts + already-sent) ──────────────────
             Drafts live only until Save (editable email, removed on cancel);
             sent invitations support staged role edits, resend, and cancel. -->
              <ItemGroup
                v-if="
                  stagedInvites.length > 0 ||
                  (canShowTeamInvitations && visibleTeamInvitations.length > 0)
                "
                class="bg-secondary rounded-2xl p-3"
              >
                <!-- Staged drafts (not yet sent) -->
                <Item
                  v-for="(member, index) in stagedInvites"
                  :key="`staged-${index}`"
                  size="sm"
                  class="p-0"
                >
                  <ItemMedia>
                    <AppAvatar :name="member.email || 'draft'" />
                  </ItemMedia>
                  <ItemContent class="truncate">
                    <ItemTitle>
                      <Input
                        v-model="member.email"
                        type="email"
                        :placeholder="
                          $t('components.teamDialog.placeholders.email')
                        "
                        class="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                      />
                    </ItemTitle>
                    <ItemDescription class="text-xs">
                      {{ t("components.teamDialog.tooltips.draft") }}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Select v-model="member.role">
                      <Button variant="outline" as-child>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </Button>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem
                            v-for="role in teamRoleOptions"
                            :key="role"
                            :value="role"
                            :disabled="role === 'owner' && !canManageOwnerRoles"
                          >
                            {{ t(`components.teamDialog.roles.${role}`) }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="outline"
                            size="icon"
                            :disabled="isMemberRemovalDisabled(member)"
                            @click="removeMember(member.email)"
                          >
                            <IconTrash />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{
                            isMemberRemovalDisabled(member)
                              ? ownerRoleManagementReason
                              : t(
                                  "components.teamDialog.tooltips.cancelInvitation"
                                )
                          }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </ItemActions>
                </Item>

                <!-- Already-sent invitations (resend / change role / cancel) -->
                <template v-if="canShowTeamInvitations">
                  <Item
                    v-for="invite in visibleTeamInvitations"
                    :key="invite.id"
                    size="sm"
                    class="p-0"
                  >
                    <ItemMedia>
                      <AppAvatar :name="invite.email" />
                    </ItemMedia>
                    <ItemContent class="truncate">
                      <ItemTitle>
                        <span class="truncate">{{ invite.email }}</span>
                      </ItemTitle>
                      <ItemDescription class="text-xs capitalize">
                        {{
                          invite.status === "declined"
                            ? t("components.teamDialog.tooltips.declined")
                            : t("components.teamDialog.tooltips.pending")
                        }}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <!-- Resend (hidden once declined) -->
                      <TooltipProvider v-if="invite.status !== 'declined'">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button
                              variant="outline"
                              size="icon"
                              :disabled="isResending(invite.id!)"
                              @click="handleResendInvitation(invite)"
                            >
                              <Spinner v-if="isResending(invite.id!)" />
                              <IconForward v-else />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              t(
                                "components.teamDialog.tooltips.resendInvitation"
                              )
                            }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <!-- Staged role change -->
                      <Select
                        :model-value="invitationRoleValue(invite)"
                        :disabled="
                          invite.status === 'declined' ||
                          (!canManageOwnerRoles && invite.role === 'owner')
                        "
                        @update:model-value="
                          (val) => stageInvitationRole(invite, val)
                        "
                      >
                        <Button variant="outline" as-child>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </Button>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem
                              value="owner"
                              :disabled="
                                !canManageOwnerRoles && invite.role !== 'owner'
                              "
                            >
                              {{ t("components.teamDialog.roles.owner") }}
                            </SelectItem>
                            <SelectItem value="admin">
                              {{ t("components.teamDialog.roles.admin") }}
                            </SelectItem>
                            <SelectItem value="member">
                              {{ t("components.teamDialog.roles.member") }}
                            </SelectItem>
                            <SelectItem value="guest">
                              {{ t("components.teamDialog.roles.guest") }}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <!-- Cancel invitation -->
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button
                              variant="outline"
                              size="icon"
                              @click="
                                invitationStore.cancelInvitation(invite.id!)
                              "
                            >
                              <IconTrash />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              t(
                                "components.teamDialog.tooltips.cancelInvitation"
                              )
                            }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </ItemActions>
                  </Item>
                </template>

                <!-- ── Agent members (staged + existing) ───────────────────────────
                 Agents join directly (no invite handshake); their role is always
                "member" and is shown locked. -->
                <template v-if="agentMembers.length > 0">
                  <Item
                    v-for="agent in agentMembers"
                    :key="agent.agentId"
                    size="sm"
                    class="p-0"
                  >
                    <ItemMedia>
                      <AppAvatar
                        class="size-8"
                        variant="beam"
                        :name="agentAvatarSeed(agent)"
                      />
                    </ItemMedia>
                    <ItemContent class="truncate">
                      <ItemTitle class="flex items-center gap-1.5">
                        <span class="truncate">{{ agent.name }}</span>
                        <Badge variant="secondary">
                          {{ t("components.teamDialog.labels.agentBadge") }}
                        </Badge>
                      </ItemTitle>
                      <ItemDescription
                        v-if="agent.description"
                        class="truncate text-xs"
                      >
                        {{ agent.description }}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <!-- Role is locked to "member" for agents -->
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <div>
                              <Select model-value="member" disabled>
                                <Button variant="outline" as-child>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </Button>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="member">
                                      {{
                                        t("components.teamDialog.roles.member")
                                      }}
                                    </SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              t(
                                "components.teamDialog.tooltips.agentRoleLocked"
                              )
                            }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <!-- Remove agent -->
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button
                              variant="outline"
                              size="icon"
                              @click="removeAgent(agent.agentId)"
                            >
                              <IconTrash />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{
                              t("components.teamDialog.tooltips.removeAgent")
                            }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </ItemActions>
                  </Item>
                </template>
              </ItemGroup>
            </TabsContent>
          </Field>
        </Tabs>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isLoading">
            {{ t("common.actions.cancel") }}
          </Button>
        </DialogClose>
        <Button
          :disabled="isLoading || (!canUpdateTeam && mode === 'edit')"
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{
            mode === "create"
              ? t("components.teamDialog.actions.create")
              : mode === "edit"
                ? t("components.teamDialog.actions.save")
                : t("components.teamDialog.actions.invite")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
