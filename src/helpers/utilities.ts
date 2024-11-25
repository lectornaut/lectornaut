import { v4 as uuidv4 } from "uuid"

export const isTauri = computed(() => {
  if ("__TAURI_INTERNALS__" in window) {
    return true
  } else {
    return false
  }
})

export const generateId = () => {
  return uuidv4()
}

export const getInitials = (name: string) => {
  if (!name) {
    return "UNNAMED USER"
  }
  return name
    .match(/(^\S\S?|\s\S)?/g)
    ?.map((v) => v.trim())
    .join("")
    .match(/(^\S|\S$)?/g)
    ?.join("")
    .toLocaleUpperCase()
}
