import type { ZodObject, ZodRawShape } from "zod"
import {
  membershipPreferencesSchema,
  membershipPreferencesWriteSchema,
  teamSchema,
  teamWriteSchema,
  userPreferencesSchema,
  userPreferencesWriteSchema,
  userSchema,
  userWriteSchema,
  workspaceSchema,
  workspaceWriteSchema,
} from "./domain"
import {
  membershipDocDataSchema,
  membershipDocDataWriteSchema,
} from "./membership"
import { userNotificationSettingsSchema } from "./notifications"
import { settingsShortcutsDocSchema, settingsThemeDocSchema } from "./settings"

/**
 * Firestore path → schema pair registry.
 *
 * The sync engine calls `lookupSchema(ref.path)` at write time to find the
 * right validator for a given mutation target. The read-path converters in
 * `firebase-helpers.ts` don't consult this registry directly — they import
 * schemas individually — but the two sets must stay in sync, so any new
 * entity added here should also get a converter there.
 *
 * Path patterns use anchored regex matching against `DocumentReference.path`
 * (e.g. `"users/abc123"`, `"teams/t1/workspaces/w1"`). Order-sensitive:
 * the first matching entry wins. Keep more specific patterns (e.g. the
 * nested `settings/preferences` subdoc) above broader ones.
 *
 * Entities without a dedicated `*WriteSchema` (theme doc, notification
 * settings) use the read schema as the write schema. Both are safe because
 * `validatePartialUpdate` iterates the data's keys and validates each
 * field individually — so `assertValid` against the strict read schema
 * only fires on non-merge writes, and those are expected to carry a full
 * document.
 */

export interface SchemaPair {
  read: ZodObject<ZodRawShape>
  write: ZodObject<ZodRawShape>
  name: string
}

interface RegistryEntry {
  pattern: RegExp
  schemas: SchemaPair
}

const registry: RegistryEntry[] = [
  // ─── User docs ─────────────────────────────────────────────────────────────
  {
    pattern: /^users\/[^/]+$/,
    schemas: { read: userSchema, write: userWriteSchema, name: "user" },
  },
  {
    pattern: /^users\/[^/]+\/settings\/preferences$/,
    schemas: {
      read: userPreferencesSchema,
      write: userPreferencesWriteSchema,
      name: "userPreferences",
    },
  },
  {
    pattern: /^users\/[^/]+\/settings\/themes$/,
    schemas: {
      read: settingsThemeDocSchema,
      write: settingsThemeDocSchema,
      name: "settingsThemes",
    },
  },
  {
    pattern: /^users\/[^/]+\/settings\/shortcuts$/,
    schemas: {
      read: settingsShortcutsDocSchema,
      write: settingsShortcutsDocSchema,
      name: "settingsShortcuts",
    },
  },
  {
    pattern: /^users\/[^/]+\/settings\/notifications$/,
    schemas: {
      read: userNotificationSettingsSchema,
      write: userNotificationSettingsSchema,
      name: "notificationSettings",
    },
  },
  // ─── Team docs ─────────────────────────────────────────────────────────────
  {
    pattern: /^teams\/[^/]+$/,
    schemas: { read: teamSchema, write: teamWriteSchema, name: "team" },
  },
  {
    pattern: /^teams\/[^/]+\/memberships\/[^/]+\/settings\/preferences$/,
    schemas: {
      read: membershipPreferencesSchema,
      write: membershipPreferencesWriteSchema,
      name: "membershipPreferences",
    },
  },
  {
    pattern: /^teams\/[^/]+\/memberships\/[^/]+$/,
    schemas: {
      read: membershipDocDataSchema,
      write: membershipDocDataWriteSchema,
      name: "membership",
    },
  },
  {
    pattern: /^teams\/[^/]+\/workspaces\/[^/]+$/,
    schemas: {
      read: workspaceSchema,
      write: workspaceWriteSchema,
      name: "workspace",
    },
  },
]

/**
 * Look up the schema pair for a given Firestore document path.
 * Returns `null` for paths not in the registry — callers should treat that
 * as "no validation available, pass through".
 */
export function lookupSchema(path: string): SchemaPair | null {
  for (const entry of registry) {
    if (entry.pattern.test(path)) return entry.schemas
  }
  return null
}
