import type { Ref } from "vue"

/**
 * Asks before a transition throws away unsaved edits: closing a dialog
 * (Escape, backdrop, the X, Cancel) or anything else passed to `request`
 * (e.g. switching Settings tabs, which unmounts the tab's form).
 *
 *   const guard = useDismissGuard(open, () => isDirty.value)
 *   <Dialog :open="open" @update:open="guard.onOpenChange">
 *   <ConfirmAction v-model:open="guard.confirmOpen.value" ... :on-confirm="guard.discard" />
 *
 * Programmatic closes (`open.value = false` after a save) skip the guard on
 * purpose: only user dismissals go through `onOpenChange`.
 */
export function useDismissGuard(open: Ref<boolean>, isDirty: () => boolean) {
  const confirmOpen = ref(false)
  let pending: (() => void) | null = null

  const request = (proceed: () => void) => {
    if (!isDirty()) {
      proceed()
      return
    }
    pending = proceed
    confirmOpen.value = true
  }

  const onOpenChange = (next: boolean) => {
    if (next) open.value = true
    else request(() => (open.value = false))
  }

  const discard = () => {
    const proceed = pending
    pending = null
    proceed?.()
  }

  return { confirmOpen, request, onOpenChange, discard }
}
