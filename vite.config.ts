import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite"
import tailwindcss from "@tailwindcss/vite"
import { unheadVueComposablesImports } from "@unhead/vue"
import { Unhead } from "@unhead/vue/vite"
import Vue from "@vitejs/plugin-vue"
import MotionResolver from "motion-v/resolver"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"
import RekaResolver from "reka-ui/resolver"
import AutoImport from "unplugin-auto-import/vite"
import Unfonts from "unplugin-fonts/vite"
import IconsResolver from "unplugin-icons/resolver"
import Icons from "unplugin-icons/vite"
import TurboConsole from "unplugin-turbo-console/vite"
import Components from "unplugin-vue-components/vite"
import { defineConfig } from "vite"
import checker from "vite-plugin-checker"
import { ViteImageOptimizer } from "vite-plugin-image-optimizer"
import monacoEditorPlugin from "vite-plugin-monaco-editor-esm"
import { VitePWA } from "vite-plugin-pwa"
import Sitemap from "vite-plugin-sitemap"
import Layouts from "vite-plugin-vue-layouts"
import { VueRouterAutoImports } from "vue-router/unplugin"
import VueRouter from "vue-router/vite"
import { generateThemesCssPlugin } from "./src/plugins/theme"

const host = process.env.TAURI_DEV_HOST
const file = fileURLToPath(new URL("package.json", import.meta.url))
const json = readFileSync(file, "utf8")
const pkg = JSON.parse(json)

/**
 * Monaco web-worker entries for `vite-plugin-monaco-editor-esm`, declared
 * WITH the `.js` extension on purpose.
 *
 * monaco-editor@0.55's package `exports` map is `{ "./*": "./*" }`, which
 * resolves subpaths verbatim and disables extension probing. The plugin
 * (v2.0.2, latest) hardcodes its built-in worker entries WITHOUT `.js`, so
 * under Vite 8 / rolldown — which strictly honor `exports` — esbuild fails
 * with "Could not resolve …/editor.worker". Passing the SAME workers here
 * with `.js` makes the plugin's `resolveMonacoPath()` match the real files
 * (it does `fs.existsSync(<cwd>/node_modules/<entry>)` and returns that
 * absolute path, which bypasses the exports map). They're wired via
 * `customWorkers` + `languageWorkers: []` so they aren't registered twice
 * (`getWorks()` appends customWorkers to the built-in list). Labels are
 * unchanged, so stream-monaco still resolves each worker by label.
 */
const monacoWorkers = [
  {
    label: "editorWorkerService",
    entry: "monaco-editor/esm/vs/editor/editor.worker.js",
  },
  {
    label: "typescript",
    entry: "monaco-editor/esm/vs/language/typescript/ts.worker.js",
  },
  { label: "css", entry: "monaco-editor/esm/vs/language/css/css.worker.js" },
  { label: "html", entry: "monaco-editor/esm/vs/language/html/html.worker.js" },
  { label: "json", entry: "monaco-editor/esm/vs/language/json/json.worker.js" },
]

// https://vitejs.dev/config/
/**
 * Vite Configuration
 * Configures Vue, PWA, Auto-imports, and other plugins for the build process
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    generateThemesCssPlugin({
      outFile: "./styles/theme.css",
    }),
    VueRouter(),
    Vue(),
    // Bundles Monaco's web workers so markstream-vue's Monaco code-block
    // runtime (stream-monaco) can tokenize/lay out code off the main
    // thread. Worker entries (with `.js`, and why) are declared in
    // `monacoWorkers` above; `languageWorkers: []` avoids double-
    // registering the plugin's broken extensionless built-ins.
    // customDistPath keeps the emitted workers under a predictable folder
    // for the PWA/Tauri build.
    monacoEditorPlugin({
      languageWorkers: [],
      customWorkers: monacoWorkers,
      customDistPath: (_root, buildOutDir) =>
        resolve(buildOutDir, "monacoeditorwork"),
    }),
    VitePWA({
      devOptions: {
        enabled: true,
        type: "module",
      },
      pwaAssets: {
        overrideManifestIcons: true,
      },
      manifest: {
        name: "Lectornaut",
        short_name: "Lectornaut",
        description: "Lectornaut",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        id: "com.lectornaut.com",
        protocol_handlers: [
          {
            protocol: "web+lectornaut",
            url: "/%s",
          },
        ],
        display_override: ["window-controls-overlay"],
        screenshots: [
          {
            src: "/screenshot-1.png",
            sizes: "2560x1440",
            type: "image/png",
          },
          {
            src: "/screenshot-2.png",
            sizes: "2560x1440",
            type: "image/png",
            form_factor: "wide",
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,jpg,jpeg,gif,webp,woff,woff2,ttf,eot,otf,webmanifest,json}",
        ],
        // Monaco's language workers are emitted UNMINIFIED by
        // vite-plugin-monaco-editor-esm (its internal esbuild pass has no
        // minify step), so `ts.worker..bundle.js` alone is ~13 MB — far
        // past any sane precache budget, and workbox fails the build on
        // the oversized asset. The workers are fetched on demand (via
        // Monaco's getWorkerUrl shim), not needed at SW-install time, so
        // keep them out of the precache manifest. The `script` runtime-
        // caching rule below still serves/caches them after first use.
        globIgnores: ["**/monacoeditorwork/**"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "documents",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "script",
            handler: "NetworkFirst",
            options: {
              cacheName: "scripts",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "style",
            handler: "CacheFirst",
            options: {
              cacheName: "styles",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "font",
            handler: "CacheFirst",
            options: {
              cacheName: "fonts",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "manifest",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "manifest",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
        ],
      },
    }),
    tailwindcss(),
    Components({
      resolvers: [
        MotionResolver(),
        RekaResolver(),
        IconsResolver({
          prefix: "icon",
        }),
      ],
    }),
    AutoImport({
      imports: [
        "vue",
        "@vueuse/core",
        "vue-i18n",
        unheadVueComposablesImports,
        VueRouterAutoImports,
      ],
      vueTemplate: true,
    }),
    Layouts(),
    Unfonts({
      fontsource: {
        families: [
          "Geist Variable",
          "Geist Mono Variable",
          "Bricolage Grotesque Variable",
        ],
      },
    }),
    ViteImageOptimizer(),
    Icons({
      defaultClass: "inline-flex shrink-0 size-4",
    }),
    VueI18nPlugin({
      include: resolve(
        dirname(fileURLToPath(import.meta.url)),
        "./src/locales/**"
      ),
    }),
    Unhead(),
    Sitemap(),
    checker({
      typescript: true,
      vueTsc: true,
      eslint: {
        lintCommand: "eslint './src/**/*.{js,ts,cjs,mjs,vue}'",
        watchPath: "./src",
      },
      stylelint: {
        lintCommand: "stylelint './src/**/*.css'",
        watchPath: "./src",
      },
      // overlay: false,
      enableBuild: false,
    }),
    TurboConsole({
      highlight: {
        themeDetect: true,
      },
      launchEditor: false,
      passLogs: false,
      inspector: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    // make sure this port matches the devUrl port in tauri.conf.json file
    port: 5173,
    // Tauri expects a fixed port, fail if that port is not available
    strictPort: true,
    // if the host Tauri is expecting is set, use it
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,

    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
      usePolling: true,
    },
  },
  // Env variables starting with the item of `envPrefix` will be exposed in tauri's source code through `import.meta.env`.
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux.
    // Web (PWA) builds without TAURI_ENV_PLATFORM also fall through to the
    // safari branch, so it doubles as the web baseline.
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome131" : "safari18",
    // don't minify for debug builds
    minify:
      process.env.NODE_ENV !== "production" || !!process.env.TAURI_ENV_DEBUG,
    // produce sourcemaps for debug builds
    sourcemap:
      process.env.NODE_ENV !== "production" || !!process.env.TAURI_ENV_DEBUG,
  },
})
