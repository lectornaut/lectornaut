import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite"
import UnheadVite from "@unhead/addons/vite"
import { unheadVueComposablesImports } from "@unhead/vue"
import Vue from "@vitejs/plugin-vue"
import autoprefixer from "autoprefixer"
import { resolve, dirname } from "node:path"
import { fileURLToPath, URL } from "node:url"
import RekaResolver from "reka-ui/resolver"
import tailwind from "tailwindcss"
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
  plugins: [
    VueRouter(),
    Vue(),
    VitePWA({
      registerType: "prompt",
      devOptions: {
        enabled: process.env.NODE_ENV === "development",
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
    }),
    Components({
      resolvers: [
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
        families: ["Instrument Serif", "Geist Sans", "Geist Mono"],
      },
    }),
    ViteImageOptimizer(),
    Icons({
      scale: 1,
      defaultClass: "inline-flex shrink-0 w-4 h-4",
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
      typescript: true,
      vueTsc: true,
    }),
  ],
  css: {
    postcss: {
      plugins: [tailwind(), autoprefixer()],
    },
  },
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
