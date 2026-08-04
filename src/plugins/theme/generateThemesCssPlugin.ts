// Regenerates the preset theme stylesheet from the token sources in
// `src/utils/theme/`. It must emit a real file (not a `virtual:` module)
// because `@tailwindcss/vite` inlines the `@import "@/styles/theme.css"` in
// `src/styles/index.css` with its own filesystem resolver, which never
// consults Vite's plugin container.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Plugin } from "vite"
import { generateThemeCss } from "./themeGenerator.ts"

export function generateThemesCssPlugin(options: {
  /** Output path, relative to the project root. */
  outFile: string
}): Plugin {
  let outFile: string

  return {
    name: "generate-themes-css",
    configResolved(config) {
      outFile = resolve(config.root, options.outFile)
    },
    // Runs on `vite build` and on every dev-server (re)start. That covers
    // edits to the generator and token sources too: they are vite.config
    // dependencies, so Vite restarts the server when they change — no
    // handleHotUpdate or manual watcher needed.
    buildStart() {
      const nextCss = generateThemeCss()
      const previousCss = existsSync(outFile)
        ? readFileSync(outFile, "utf8")
        : ""

      // Skip identical writes so the mtime bump doesn't retrigger watchers.
      if (previousCss !== nextCss) {
        writeFileSync(outFile, nextCss, "utf8")
      }
    },
  }
}
