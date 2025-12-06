import { v7 as uuidv7 } from "uuid"

export const generateId = () => {
  return uuidv7()
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
