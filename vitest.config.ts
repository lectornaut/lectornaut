import { configDefaults, defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./tests/setup.ts"],
      css: true,
      exclude: [...configDefaults.exclude, "functions/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        exclude: [
          ...((configDefaults as { coverage?: { exclude?: string[] } }).coverage
            ?.exclude ?? []),
          "tests/**",
          "functions/**",
          "src-tauri/**",
        ],
      },
    },
  })
)
