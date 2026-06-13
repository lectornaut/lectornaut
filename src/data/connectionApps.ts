/**
 * Client directory of installable connection apps — the Connections section
 * of Settings → Integrations renders from this list
 * (docs/connections-feature.prompt.md). Mirror of
 * `functions/src/connectionProviders.ts` (the server registry is
 * authoritative for scopes + contributed docs; keep display copy in sync —
 * same convention as the built-in tool catalog keeping copy in data files).
 */

import { IconLogosGoogleCalendar, IconLogosGoogleDrive } from "@/data/icons"
import {
  CONNECTION_PROVIDERS,
  GOOGLE_CALENDAR_TOOL_KEY,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_DRIVE_TOOL_KEY,
  type ConnectionProvider,
} from "@lectornaut/shared/domain"
import type { Component } from "vue"

/**
 * Directory facets for the Connections page's category filter. Display-only
 * taxonomy (the server never reads it) — that's why it lives here with
 * name/description/logo and NOT in `shared/domain.ts`. An app can belong to
 * several; the filter ORs selected categories. Labels come from
 * `settings.connections.categories.*`, mapped exhaustively in
 * SettingsConnections.vue so adding a value here forces a label there.
 */
export const CONNECTION_CATEGORIES = [
  "ai-integrations",
  "link-previews",
  "database-sync",
  "automations",
] as const
export type ConnectionCategory = (typeof CONNECTION_CATEGORIES)[number]

export interface ConnectionAppDescriptor {
  provider: ConnectionProvider
  name: string
  description: string
  avatarSeed: string
  /** Directory facets for the category filter — an app can hold several. */
  categories: ConnectionCategory[]
  /** Full-color provider logo (`~icons/logos/*`) for the Connections page. */
  logo: Component
  /**
   * OAuth scopes the per-user popup requests. Must match the server
   * registry — the server validates nothing about client-requested scopes
   * (the token exchange grants whatever the user consented to), but a
   * mismatch surfaces as confusing consent screens.
   */
  scopes: string[]
  /** Integration sourceKeys this app contributes while installed. */
  toolKeys: string[]
}

const GOOGLE_CALENDAR_APP: ConnectionAppDescriptor = {
  provider: "google-calendar",
  name: "Google Calendar",
  description:
    "Let agents look up — and, with per-write confirmation, schedule — " +
    "events on members' connected Google Calendars.",
  avatarSeed: "google-calendar",
  categories: ["ai-integrations", "link-previews"],
  logo: IconLogosGoogleCalendar,
  // P2 upgraded `calendar.events.readonly` → `calendar.events` (read+write).
  // Members who connected under P1 keep read access; the binding row shows a
  // reconnect hint (`needsScopeUpgrade`) until they re-consent.
  scopes: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  toolKeys: [GOOGLE_CALENDAR_TOOL_KEY],
}

const GOOGLE_DRIVE_APP: ConnectionAppDescriptor = {
  provider: "google-drive",
  name: "Google Drive",
  description:
    "Let agents search, read, and (with confirmation) save files in " +
    "members' connected Google Drives.",
  avatarSeed: "google-drive",
  categories: [
    "ai-integrations",
    "link-previews",
    "database-sync",
    "automations",
  ],
  logo: IconLogosGoogleDrive,
  // The least-privilege pair: `drive.readonly` for search/read +
  // `drive.file` for the confirm-gated writes (app-created/picked files
  // only). Bindings granted before `drive.file` was declared show the
  // `needsScopeUpgrade` reconnect hint (calendar P2 precedent).
  scopes: [
    "openid",
    "email",
    GOOGLE_DRIVE_READONLY_SCOPE,
    GOOGLE_DRIVE_FILE_SCOPE,
  ],
  toolKeys: [GOOGLE_DRIVE_TOOL_KEY],
}

const APPS_BY_PROVIDER: Readonly<
  Record<ConnectionProvider, ConnectionAppDescriptor>
> = {
  "google-calendar": GOOGLE_CALENDAR_APP,
  "google-drive": GOOGLE_DRIVE_APP,
}

/** Every installable app, in directory display order. */
export const CONNECTION_APPS: readonly ConnectionAppDescriptor[] =
  CONNECTION_PROVIDERS.map((provider) => APPS_BY_PROVIDER[provider])

export const getConnectionApp = (
  provider: ConnectionProvider
): ConnectionAppDescriptor => APPS_BY_PROVIDER[provider]
