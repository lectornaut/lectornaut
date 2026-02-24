import { toast } from "vue-sonner"

/**
 * Toast message configuration for async operations.
 */
export interface ToastMessages {
  /** Message shown on successful completion */
  success: string
  /** Message shown on error (error.message added as description) */
  error: string
  /** Optional in-progress message shown before operation starts */
  info?: string
}

/**
 * Extended options for withToast with undo support.
 */
export interface WithToastOptions extends ToastMessages {
  /** Undo callback - if provided, shows "Undo" button in success toast */
  onUndo?: () => Promise<void>
  /** Label for undo button (default: "Undo") */
  undoLabel?: string
  /** Message shown after successful undo (default: "Restored") */
  undoSuccessMessage?: string
  /** Message shown if undo fails (default: "Failed to undo") */
  undoErrorMessage?: string
}

const getToastErrorDescription = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "An unexpected error occurred"
}

/**
 * Wraps an async operation with consistent toast notifications.
 * Supports optional undo action button on success toast.
 *
 * @example
 * ```ts
 * // Basic usage
 * await withToast(
 *   () => api.createWorkspace(name),
 *   { success: "Created", error: "Failed" }
 * )
 *
 * // With undo support
 * await withToast(
 *   () => api.deleteItem(id),
 *   { success: "Deleted", error: "Failed", onUndo: () => api.restore(id) }
 * )
 * ```
 */
export async function withToast<T>(
  operation: () => Promise<T>,
  options: WithToastOptions | ToastMessages
): Promise<T> {
  const opts = options as WithToastOptions
  const promise = Promise.resolve().then(() => operation())

  toast.promise(promise, {
    ...(opts.info ? { loading: opts.info } : {}),
    success: () =>
      opts.onUndo
        ? {
            message: opts.success,
            action: {
              label: opts.undoLabel ?? "Undo",
              onClick: async () => {
                try {
                  await opts.onUndo!()
                  toast.success(opts.undoSuccessMessage ?? "Restored")
                } catch (undoError) {
                  console.error("Undo failed:", undoError)
                  toast.error(opts.undoErrorMessage ?? "Failed to undo")
                }
              },
            },
          }
        : opts.success,
    error: (error: unknown) => ({
      message: opts.error,
      description: getToastErrorDescription(error),
    }),
  })

  return await promise
}

/**
 * Show a success toast with optional undo action.
 * Use when you need a toast without wrapping an async operation.
 */
export function showSuccessToast(
  message: string,
  options?: { onUndo?: () => Promise<void>; undoLabel?: string }
) {
  if (options?.onUndo) {
    toast.success(message, {
      action: {
        label: options.undoLabel ?? "Undo",
        onClick: async () => {
          try {
            await options.onUndo!()
            toast.success("Restored")
          } catch (error) {
            console.error("Undo failed:", error)
            toast.error("Failed to undo")
          }
        },
      },
    })
  } else {
    toast.success(message)
  }
}

/**
 * Show an error toast.
 */
export function showErrorToast(message: string, description?: string) {
  toast.error(message, description ? { description } : undefined)
}
