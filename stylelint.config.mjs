/** @type {import('stylelint').Config} */
export default {
  extends: ["stylelint-config-standard-scss"],
  rules: {
    "at-rule-no-deprecated": [true, { ignoreAtRules: ["apply"] }],
    "scss/at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: ["plugin", "custom-variant", "theme"],
      },
    ],
  },
}
