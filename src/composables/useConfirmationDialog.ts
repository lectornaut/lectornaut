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

  const open = (item: T) => {
    itemToConfirm.value = item
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
      if (!isOpen.value) itemToConfirm.value = null
    })
  }

  const confirm = async (action: (item: T) => Promise<void>) => {
    // Snapshot up front so the action keeps the item even if a concurrent
    // close clears `itemToConfirm` mid-flight.
    const item = itemToConfirm.value
    if (!item) return
    try {
      await action(item)
      isOpen.value = false
    } finally {
      itemToConfirm.value = null
    }
  }

  return {
    isOpen,
    item: itemToConfirm,
    open,
    close,
    confirm,
  }
}
