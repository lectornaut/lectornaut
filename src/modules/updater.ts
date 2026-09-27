import { i18n } from "@/modules/i18n"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { toast } from "vue-sonner"

const t = i18n.global.t

export type UpdateCheckResult = {
  status: "up-to-date" | "available"
  version?: string
  update?: Update
}

/** Lifecycle of the update the UI can act on, shared across every surface. */
export type UpdateStage = "idle" | "available" | "downloading" | "ready"

const lastCheckResult = shallowRef<UpdateCheckResult | null>(null)
const isCheckingForUpdates = ref(false)
const updateStage = ref<UpdateStage>("idle")
const updateDownloadPercent = ref(0)

export {
  isCheckingForUpdates,
  lastCheckResult,
  updateDownloadPercent,
  updateStage,
}

/**
 * Restarts the app so a downloaded update takes effect
 */
export const restartToApplyUpdate = async () => {
  await relaunch()
}

/**
 * Downloads and installs the given update with progress toasts
 */
export const downloadAndInstallUpdate = async (update: Update) => {
  let downloaded = 0
  let contentLength = 0

  const toastId = toast.loading(t("updater.preparing"))
  updateStage.value = "downloading"
  updateDownloadPercent.value = 0

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0
          toast.loading(t("updater.downloading"), {
            id: toastId,
            description: t("updater.startedDownloading", {
              bytes: contentLength,
            }),
          })
          break
        case "Progress":
          downloaded += event.data.chunkLength
          if (contentLength > 0) {
            const percent = Math.round((downloaded / contentLength) * 100)
            updateDownloadPercent.value = percent
            toast.loading(t("updater.downloadingProgress", { percent }), {
              id: toastId,
              description: t("updater.downloadProgress", {
                downloaded: (downloaded / 1024 / 1024).toFixed(2),
                total: (contentLength / 1024 / 1024).toFixed(2),
              }),
            })
          }
          break
        case "Finished":
          updateDownloadPercent.value = 100
          updateStage.value = "ready"
          toast.success(t("updater.downloaded"), {
            id: toastId,
            description: t("updater.restartToApply"),
            action: {
              label: t("updater.restart"),
              onClick: restartToApplyUpdate,
            },
          })
          break
      }
    })
  } catch (error) {
    updateStage.value = "available"
    toast.error(t("updater.failed"), { id: toastId })
    throw error
  }
}

/**
 * Checks for updates and returns the result
 */
export const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  isCheckingForUpdates.value = true

  try {
    const update = await check()

    if (update) {
      const result: UpdateCheckResult = {
        status: "available",
        version: update.version,
        update,
      }

      lastCheckResult.value = result
      // A download already in flight (or finished) outranks a fresh check.
      if (updateStage.value === "idle") updateStage.value = "available"
      return result
    }

    const result: UpdateCheckResult = { status: "up-to-date" }
    lastCheckResult.value = result
    if (updateStage.value === "available") updateStage.value = "idle"
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
      toast.info(t("updater.versionAvailable", { version: result.version }), {
        description: t("updater.newVersionAvailable"),
        action: {
          label: t("updater.update"),
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
