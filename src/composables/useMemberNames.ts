import { useMembershipStore } from "@/stores/membershipStore"
import { isUserMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { computed } from "vue"

/** Display name for a member uid; falls back to the uid for a departed one. */
export function useMemberNames() {
  const { teamMembers } = storeToRefs(useMembershipStore())
  const names = computed(() => {
    const byUid = new Map<string, string>()
    for (const member of teamMembers.value) {
      if (!isUserMembership(member)) continue
      const name = member.user?.displayName || member.user?.email
      if (name) byUid.set(member.userId, name)
    }
    return byUid
  })
  const memberName = (uid: string): string => names.value.get(uid) ?? uid
  return { memberName }
}
