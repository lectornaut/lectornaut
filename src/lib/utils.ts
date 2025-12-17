import type { Updater } from "@tanstack/vue-table"
import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Ref } from "vue"

/**
 * ClassName Merger
 * Combines Tailwind classes safely using clsx and tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Value Updater for TanStack Table
 * Updates a ref value based on a functional or direct update
 */
export function valueUpdater<T extends Updater<unknown>>(
  updaterOrValue: T,
  ref: Ref
) {
  ref.value =
    typeof updaterOrValue === "function"
      ? updaterOrValue(ref.value)
      : updaterOrValue
}
