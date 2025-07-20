import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite"
import tailwindcss from "@tailwindcss/vite"
import UnheadVite from "@unhead/addons/vite"
import { unheadVueComposablesImports } from "@unhead/vue"
import Vue from "@vitejs/plugin-vue"
import MotionResolver from "motion-v/resolver"
import { dirname, resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"
import RekaResolver from "reka-ui/resolver"
import AutoImport from "unplugin-auto-import/vite"
import Unfonts from "unplugin-fonts/vite"
import IconsResolver from "unplugin-icons/resolver"
import Icons from "unplugin-icons/vite"
import Components from "unplugin-vue-components/vite"
import { VueRouterAutoImports } from "unplugin-vue-router"
import VueRouter from "unplugin-vue-router/vite"
import { defineConfig } from "vite"
import checker from "vite-plugin-checker"
import { ViteImageOptimizer } from "vite-plugin-image-optimizer"
import { VitePWA } from "vite-plugin-pwa"
import Sitemap from "vite-plugin-sitemap"
import Layouts from "vite-plugin-vue-layouts"

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    sourcemap: process.env.NODE_ENV !== "production",
  },
  plugins: [
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
        name: "template",
        short_name: "template",
        description: "template description.",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        id: "com.template.app",
        protocol_handlers: [
          {
            protocol: "web+template",
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
        maximumFileSizeToCacheInBytes: 3000000,
        globPatterns: ["**/*.{js,ts,json,css,scss,html,png,jpg,svg,ico}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "documents",
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "font",
            handler: "CacheFirst",
            options: {
              cacheName: "fonts",
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "manifest",
            handler: "CacheFirst",
            options: {
              cacheName: "manifests",
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "script",
            handler: "NetworkFirst",
            options: {
              cacheName: "scripts",
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "style",
            handler: "CacheFirst",
            options: {
              cacheName: "styles",
            },
          },
        ],
        navigateFallback: "/index.html",
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
          "Roboto Flex Variable",
          "Roboto Slab Variable",
          "Roboto Mono Variable",
          "Playfair Display Variable",
        ],
      },
    }),
    ViteImageOptimizer(),
    Icons({
      scale: 1,
      defaultClass: "inline-flex shrink-0 size-4",
    }),
    VueI18nPlugin({
      include: resolve(
        dirname(fileURLToPath(import.meta.url)),
        "./src/locales/**"
      ),
    }),
    UnheadVite(),
    Sitemap(),
    checker({
      enableBuild: false,
      typescript: true,
      vueTsc: true,
      overlay: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
})
