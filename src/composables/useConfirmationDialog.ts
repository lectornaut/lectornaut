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
    itemToConfirm.value = null
  }

  const confirm = async (action: (item: T) => Promise<void>) => {
    if (!itemToConfirm.value) return
    try {
      await action(itemToConfirm.value)
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
