/** @type {import('stylelint').Config} */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // Tailwind v4 is CSS-first; these at-rules are Tailwind/CSS additions
    // the core `at-rule-no-unknown` rule doesn't recognize. `@apply` is
    // also flagged separately as a deprecated CSS proposal, hence the
    // dedicated `at-rule-no-deprecated` ignore.
    "at-rule-no-deprecated": [true, { ignoreAtRules: ["apply"] }],
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "apply",
          "theme",
          "plugin",
          "custom-variant",
          "view-transition",
        ],
      },
    ],
    // Tailwind v4 requires bare-string `@import` (e.g. `@import
    // "tailwindcss"`); the base config's default `url(...)` preference
    // would rewrite and break it. (The scss preset set this implicitly.)
    "import-notation": "string",
    // The top-of-file directives are intentionally grouped with no blank
    // lines (`@import` → `@plugin` → `@custom-variant`). Relax only
    // blockless-after-blockless so block at-rules (`@layer`, `@media`, …)
    // still require their empty line.
    "at-rule-empty-line-before": [
      "always",
      {
        except: ["blockless-after-same-name-blockless", "first-nested"],
        ignore: ["after-comment", "blockless-after-blockless"],
      },
    ],
  },
}
