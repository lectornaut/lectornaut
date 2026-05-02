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
import { defineConfig, type Plugin } from "vite"
import checker from "vite-plugin-checker"
import { ViteImageOptimizer } from "vite-plugin-image-optimizer"
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

// @geoql/v-maplibre lazy-loads these optional peer deps via dynamic import()
// wrapped in try/catch. We don't use the COG/geotiff/raster/lidar features, so
// instead of installing the (heavy) packages we resolve them to a stub that
// throws — letting v-maplibre's catch block disable the feature gracefully.
const optionalGeoDeps = [
  "@developmentseed/deck.gl-geotiff",
  "@developmentseed/deck.gl-raster",
  "@developmentseed/geotiff",
  "@geoql/maplibre-gl-starfield",
  "maplibre-gl-lidar",
  "maplibre-gl-wind",
]

const stubMessage = (name: string) =>
  `[v-maplibre] Optional peer "${name}" is not installed; this feature is disabled.`

const stubOptionalGeoDeps = (): Plugin => {
  const STUB = "\0v-maplibre-optional-stub:"
  return {
    name: "v-maplibre-stub-optional-deps",
    enforce: "pre",
    resolveId(id) {
      if (optionalGeoDeps.includes(id)) return STUB + id
    },
    load(id) {
      if (id.startsWith(STUB)) {
        const name = id.slice(STUB.length)
        return `throw new Error(${JSON.stringify(stubMessage(name))})`
      }
    },
  }
}

// https://vitejs.dev/config/
/**
 * Vite Configuration
 * Configures Vue, PWA, Auto-imports, and other plugins for the build process
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  optimizeDeps: {
    include: ["workbox-window"],
    rolldownOptions: {
      plugins: [stubOptionalGeoDeps()],
    },
  },
  plugins: [
    stubOptionalGeoDeps(),
    generateThemesCssPlugin({
      outFile: "./styles/theme.css",
    }),
    VueRouter(),
    Vue(),
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
          "EB Garamond Variable",
          "Geist Mono Variable",
          "Playfair Display Variable",
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
        lintCommand: "stylelint './src/**/*.{css,scss}'",
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
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
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
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
    // don't minify for debug builds
    minify:
      process.env.NODE_ENV !== "production" || !!process.env.TAURI_ENV_DEBUG,
    // produce sourcemaps for debug builds
    sourcemap:
      process.env.NODE_ENV !== "production" || !!process.env.TAURI_ENV_DEBUG,
  },
})
