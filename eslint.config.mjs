import js from "@eslint/js"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"
import eslintPluginVue from "eslint-plugin-vue"
import ts from "typescript-eslint"

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...eslintPluginVue.configs["flat/recommended"],
  eslintPluginPrettierRecommended,
  {
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/require-default-prop": "off",
      "no-undef": "off",
    },
    files: ["*.vue", "**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: "@typescript-eslint/parser",
      },
    },
  }
)
