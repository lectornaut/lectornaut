import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import eslintConfigPrettier from "eslint-config-prettier"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"
import eslintPluginVue from "eslint-plugin-vue"
import globals from "globals"
import ts from "typescript-eslint"
import vueParser from "vue-eslint-parser"

export default ts.config(
  {
    ignores: ["*.d.ts", "**/dist"],
    extends: [
      js.configs.recommended,
      ...ts.configs.recommended,
      ...eslintPluginVue.configs["flat/recommended"],
      eslintPluginPrettierRecommended,
    ],
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
    },
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      parser: vueParser,
      globals: globals.browser,
      parserOptions: {
        parser: tsParser,
      },
    },
  },
  eslintConfigPrettier
)
