import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { HmrContext, Plugin, ViteDevServer } from "vite"
import { generateThemeCss } from "./themeGenerator"

export interface GenerateThemesCssPluginOptions {
  outFile: string
}

const themePluginDir = fileURLToPath(new URL(".", import.meta.url))
const srcDir = fileURLToPath(new URL("../../", import.meta.url))

export function generateThemesCssPlugin(
  options: GenerateThemesCssPluginOptions
): Plugin {
  const outFile = resolve(srcDir, options.outFile)

  return {
    name: "generate-themes-css",
    buildStart() {
      syncGeneratedThemeCss(outFile)
    },
    configureServer(server: ViteDevServer) {
      syncGeneratedThemeCss(outFile)
      server.watcher.add(themePluginDir)
    },
    handleHotUpdate(ctx: HmrContext) {
      if (!ctx.file.startsWith(themePluginDir)) return

      syncGeneratedThemeCss(outFile)
      ctx.server.ws.send({ type: "full-reload" })

      return []
    },
  }
}

function syncGeneratedThemeCss(outFile: string) {
  const nextCss = generateThemeCss()
  const previousCss = readExistingThemeCss(outFile)

  if (previousCss !== nextCss) {
    writeFileSync(outFile, nextCss, "utf8")
  }
}

function readExistingThemeCss(outFile: string) {
  try {
    return readFileSync(outFile, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }

    return ""
  }
}
