/**
 * Schemas module barrel.
 *
 * This module is the single public entry point for the schema validation
 * layer. Import from `@/schemas` rather than reaching into individual files
 * — it keeps the dependency graph flat and makes tree-shaking predictable.
 *
 * Layout:
 *   _primitives  — shared timestamp primitives (Timestamp, FieldValue)
 *   _registry    — Firestore path → schema pair lookup (populated in PR 4)
 *   _utils       — parseSafe, assertValid, zodConverter,
 *                  validatePartialUpdate, SchemaValidationError,
 *                  setSchemaViolationSink
 *   domain       — users, teams, workspaces, preferences, billing
 *   membership   — membership records, denormalized user/team snapshots
 *   session      — device sessions
 *   logs         — audit log entries and sub-shapes
 *   nodes        — workspace nodes (folder/file discriminated union) +
 *                  attachments
 *   sso          — team security / SSO config
 *   notifications — local notifications + user notification settings
 *   settings     — theme doc, shortcut overrides
 *   sync         — outbox operation + sync mutate payload
 */

export * from "./_primitives"
export * from "./_registry"
export * from "./_utils"

export * from "./domain"
export * from "./invitation"
export * from "./logs"
export * from "./membership"
export * from "./memory"
export * from "./nodes"
export * from "./notifications"
export * from "./session"
export * from "./settings"
export * from "./sso"
export * from "./sync"
