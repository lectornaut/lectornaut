import css from "@eslint/css"
import js from "@eslint/js"
import vueI18n from "@intlify/eslint-plugin-vue-i18n"
import tsParser from "@typescript-eslint/parser"
import eslintConfigPrettier from "eslint-config-prettier"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"
import eslintPluginVue from "eslint-plugin-vue"
import { defineConfig } from "eslint/config"
import globals from "globals"
import ts from "typescript-eslint"
import vueParser from "vue-eslint-parser"

export default defineConfig([
  {
    files: ["**/*.css"],
    language: "css/css",
    plugins: { css },
    rules: css.configs.recommended.rules,
  },
  {
    ignores: ["*.d.ts", "**/dist"],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...eslintPluginVue.configs["flat/recommended"],
  ...vueI18n.configs["flat/recommended"],
  {
    settings: {
      "vue-i18n": {
        localeDir: "./src/locales/*.{json}",
        messageSyntaxVersion: "^11.2.8",
      },
    },
  },
  {
    files: ["**/*.{js,ts,cjs,mjs,vue}"],
    languageOptions: {
      parser: vueParser,
      globals: globals.browser,
      parserOptions: {
        parser: tsParser,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/require-default-prop": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@intlify/vue-i18n/no-raw-text": "off",
    },
  },
  eslintPluginPrettierRecommended,
  eslintConfigPrettier,
])
