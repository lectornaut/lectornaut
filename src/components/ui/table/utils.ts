import type { Ref } from "vue"

type Updater<T> = T | ((oldValue: T) => T)

export function valueUpdater<T>(updaterOrValue: Updater<T>, ref: Ref<T>): void {
  ref.value =
    typeof updaterOrValue === "function"
      ? (updaterOrValue as (oldValue: T) => T)(ref.value)
      : updaterOrValue
}
