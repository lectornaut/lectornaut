import type { Ref } from "vue"

interface UseConfirmationDialogReturn<T> {
  isOpen: Ref<boolean>
  item: Ref<T | null>
  open: (item: T) => void
  close: () => void
  confirm: (action: (item: T) => Promise<void>) => Promise<void>
}

/**
 * Composable for managing confirmation dialogs with consistent patterns.
 * Follows Single Responsibility Principle - manages only dialog state and actions.
 */
export function useConfirmationDialog<T>(): UseConfirmationDialogReturn<T> {
  const isOpen = ref(false)
  const itemToConfirm = ref<T | null>(null) as Ref<T | null>
  // Whether a confirm is pending, tracked apart from the item so confirms
  // that carry no payload (`open(null)`, e.g. "Delete SSO") still fire.
  let armed = false

  const open = (item: T) => {
    itemToConfirm.value = item
    armed = true
    isOpen.value = true
  }

  const close = () => {
    isOpen.value = false
    // Defer clearing the item by a microtask. shadcn's `AlertDialogAction`
    // auto-closes on the SAME click as the confirm button, so a consumer that
    // wires `@update:open="(v) => !v && close()"` fires this alongside the
    // confirm `@click`. Clearing synchronously raced `confirm()` (which reads
    // the item) and made the action a silent no-op. Deferring lets `confirm()`
    // read the item first, while still clearing it for cancel / escape /
    // overlay dismissals. The `isOpen` guard avoids clobbering a fresh item if
    // the dialog was re-opened within the same tick.
    queueMicrotask(() => {
      if (!isOpen.value) {
        itemToConfirm.value = null
        armed = false
      }
    })
  }

  const confirm = async (action: (item: T) => Promise<void>) => {
    if (!armed) return
    // Snapshot up front so the action keeps the item even if a concurrent
    // close clears `itemToConfirm` mid-flight.
    const item = itemToConfirm.value as T
    // A throw propagates and leaves the dialog open with its item intact,
    // so the user still sees what failed and can retry or cancel.
    await action(item)
    // Keep the item: the dialog is fading out and still renders its name.
    // The next `open()` overwrites it.
    isOpen.value = false
    armed = false
  }

  return {
    isOpen,
    item: itemToConfirm,
    open,
    close,
    confirm,
  }
}
