import { isTauri } from "@/composables/usePlatform"

/**
 * Hand the user a text file. Desktop: native save dialog + write (the dialog
 * plugin adds the chosen path to the fs scope). Browser: a Blob download.
 * Returns false when the user cancelled.
 */
export async function saveTextFile(
  fileName: string,
  text: string,
  mimeType = "application/json"
): Promise<boolean> {
  if (isTauri.value) {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { writeFile } = await import("@tauri-apps/plugin-fs")
    const targetPath = await save({ defaultPath: fileName })
    if (!targetPath) return false
    await writeFile(targetPath, new TextEncoder().encode(text))
    return true
  }
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.rel = "noopener noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
  return true
}
