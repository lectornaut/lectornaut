export const isTauri = computed(() => {
  if ("__TAURI_INTERNALS__" in window) {
    return true
  } else {
    return false
  }
})
