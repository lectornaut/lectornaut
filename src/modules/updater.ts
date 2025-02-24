import { confirm } from "@tauri-apps/plugin-dialog"
import { relaunch } from "@tauri-apps/plugin-process"
import { check } from "@tauri-apps/plugin-updater"

export const initUpdater = async () => {
  try {
    console.log("Checking for updates...")
    const update = await check()

    if (update?.available) {
      console.log(
        `Found update: ${update.version} (released on ${update.date})\nRelease notes: ${update.body}`
      )

      const userConfirmed = await confirm(
        `A new update (${update.version}) is available.\n\nRelease Notes:\n${update.body}\n\nDo you want to download and install it now?`,
        { title: "Update Available", kind: "info" }
      )

      if (!userConfirmed) {
        console.log("User canceled the update.")
        return
      }

      let downloaded = 0
      let contentLength = 0

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0
            console.log(`Started downloading: ${contentLength} bytes`)
            break
          case "Progress":
            downloaded += event.data.chunkLength
            console.log(`Downloaded: ${downloaded} / ${contentLength}`)
            break
          case "Finished":
            console.log("Download finished")
            break
        }
      })

      console.log("Update installed successfully. Restarting app...")
      await relaunch()
    } else {
      console.log("No updates available.")
    }
  } catch (error) {
    console.error("Error checking for updates:", error)
  }
}
