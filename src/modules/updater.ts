import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { toast } from "vue-sonner"

export type UpdateCheckResult = {
  status: "up-to-date" | "available"
  version?: string
  update?: Update
}

const lastCheckResult = shallowRef<UpdateCheckResult | null>(null)
const isCheckingForUpdates = ref(false)

export { isCheckingForUpdates, lastCheckResult }

/**
 * Downloads and installs the given update with progress toasts
 */
export const downloadAndInstallUpdate = async (update: Update) => {
  let downloaded = 0
  let contentLength = 0

  const toastId = toast.loading("Preparing update...")

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0
        toast.loading("Downloading update...", {
          id: toastId,
          description: `Started downloading ${contentLength} bytes`,
        })
        break
      case "Progress":
        downloaded += event.data.chunkLength
        if (contentLength > 0) {
          const percent = Math.round((downloaded / contentLength) * 100)
          toast.loading(`Downloading update... ${percent}%`, {
            id: toastId,
            description: `${(downloaded / 1024 / 1024).toFixed(2)} MB / ${(contentLength / 1024 / 1024).toFixed(2)} MB`,
          })
        }
        break
      case "Finished":
        toast.success("Update downloaded", {
          id: toastId,
          description: "Restart to apply changes",
          action: {
            label: "Restart",
            onClick: async () => {
              await relaunch()
            },
          },
        })
        break
    }
  })
}

/**
 * Checks for updates and returns the result
 */
export const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  isCheckingForUpdates.value = true

  try {
    const update = await check()

    if (update) {
      console.log(
        `Found update: ${update.version} (released on ${update.date})\nRelease notes: ${update.body}`
      )

      const result: UpdateCheckResult = {
        status: "available",
        version: update.version,
        update,
      }

      lastCheckResult.value = result
      return result
    }

    const result: UpdateCheckResult = { status: "up-to-date" }
    lastCheckResult.value = result
    return result
  } finally {
    isCheckingForUpdates.value = false
  }
}

/**
 * Initializes the Tauri updater
 * Checks for updates, notifies the user, and handles the download/install process
 */
export const initUpdater = async () => {
  try {
    const result = await checkForUpdates()

    if (result.status === "available" && result.update) {
      toast.info(`v${result.version} is available`, {
        description: "A new version is available.",
        action: {
          label: "Update",
          onClick: async () => {
            await downloadAndInstallUpdate(result.update!)
          },
        },
      })
    }
  } catch (error) {
    console.error("Error checking for updates:", error)
  }
}
