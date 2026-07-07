/**
 * Client directory of installable connection apps — the Connections section
 * of Settings → Integrations renders from this list
 * (docs/connections-feature.prompt.md). Mirror of
 * `functions/src/connectionProviders.ts` (the server registry is
 * authoritative for scopes + contributed docs; keep display copy in sync —
 * same convention as the built-in tool catalog keeping copy in data files).
 */

import {
  IconLogosGithubIcon,
  IconLogosGoogleCalendar,
  IconLogosGoogleDrive,
  IconLogosGoogleGmail,
} from "@/data/icons"
import {
  CONNECTION_PROVIDERS,
  GITHUB_TOOL_KEY,
  GOOGLE_CALENDAR_TOOL_KEY,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_DRIVE_TOOL_KEY,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_GMAIL_TOOL_KEY,
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
  /**
   * Provider authorize endpoint — used by the web authorization-code redirect
   * flow AND the desktop (Tauri) loopback flow for every provider.
   */
  authorizeUrl: string
  /**
   * Extra authorization-request params. Google needs `access_type=offline` +
   * `prompt=consent` for the refresh token; GitHub needs none.
   */
  authParams: Record<string, string>
  /** Integration sourceKeys this app contributes while installed. */
  toolKeys: string[]
  /**
   * Optional provider-side management link, surfaced as a cog button next to
   * Connect — e.g. GitHub's install/configure page (which repos the app may
   * touch) or Google's third-party-access page (view/revoke). `labelKey` is
   * the i18n key for its tooltip/aria-label. Undefined = no cog.
   */
  manage?: { url: string; labelKey: string }
}

// Google authorize endpoint + grant params shared by both Google apps (web +
// desktop loopback both build their authorize URL from these).
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_AUTH_PARAMS: Record<string, string> = {
  access_type: "offline",
  prompt: "consent",
}
// Google has no per-resource configure step (scopes are all-or-nothing, set
// by the app) — the only user-side surface is the account's third-party-access
// page to view/revoke. Shared by both Google apps.
const GOOGLE_MANAGE = {
  url: "https://myaccount.google.com/connections",
  labelKey: "settings.connections.manageOnGoogle",
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
  authorizeUrl: GOOGLE_AUTHORIZE_URL,
  authParams: GOOGLE_AUTH_PARAMS,
  toolKeys: [GOOGLE_CALENDAR_TOOL_KEY],
  manage: GOOGLE_MANAGE,
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
  authorizeUrl: GOOGLE_AUTHORIZE_URL,
  authParams: GOOGLE_AUTH_PARAMS,
  toolKeys: [GOOGLE_DRIVE_TOOL_KEY],
  manage: GOOGLE_MANAGE,
}

const GOOGLE_GMAIL_APP: ConnectionAppDescriptor = {
  provider: "google-gmail",
  name: "Gmail",
  description:
    "Let agents search and read email — and, with per-send confirmation, " +
    "send it — on members' connected Gmail accounts.",
  avatarSeed: "google-gmail",
  categories: ["ai-integrations", "automations"],
  logo: IconLogosGoogleGmail,
  // `gmail.readonly` (reads) + `gmail.send` (the confirm-gated send tool) —
  // NEVER modify/compose (send-only is the narrowest write grant). Bindings
  // granted before `gmail.send` was declared show the `needsScopeUpgrade`
  // reconnect hint (calendar P2 precedent).
  scopes: [
    "openid",
    "email",
    GOOGLE_GMAIL_READONLY_SCOPE,
    GOOGLE_GMAIL_SEND_SCOPE,
  ],
  authorizeUrl: GOOGLE_AUTHORIZE_URL,
  authParams: GOOGLE_AUTH_PARAMS,
  toolKeys: [GOOGLE_GMAIL_TOOL_KEY],
  manage: GOOGLE_MANAGE,
}

const GITHUB_APP: ConnectionAppDescriptor = {
  provider: "github",
  name: "GitHub",
  description:
    "Let agents search and read repositories, and — with per-write " +
    "confirmation — file issues and comment on members' connected GitHub.",
  avatarSeed: "github",
  categories: ["ai-integrations", "automations"],
  logo: IconLogosGithubIcon,
  // GitHub App: access is governed by the app's PERMISSIONS + which repos it's
  // installed on, not OAuth scopes — so request none (an empty `scope` is
  // omitted from the authorize URL). No extra grant params either.
  scopes: [],
  authorizeUrl: "https://github.com/login/oauth/authorize",
  authParams: {},
  toolKeys: [GITHUB_TOOL_KEY],
  // Authorizing alone yields a token that can reach NO repos until the GitHub
  // App is installed on them — point members at the install/configure page.
  manage: import.meta.env.VITE_GITHUB_APP_SLUG
    ? {
        url: `https://github.com/apps/${import.meta.env.VITE_GITHUB_APP_SLUG}/installations/new`,
        labelKey: "settings.connections.installOnGitHub",
      }
    : undefined,
}

const APPS_BY_PROVIDER: Readonly<
  Record<ConnectionProvider, ConnectionAppDescriptor>
> = {
  "google-calendar": GOOGLE_CALENDAR_APP,
  "google-drive": GOOGLE_DRIVE_APP,
  "google-gmail": GOOGLE_GMAIL_APP,
  github: GITHUB_APP,
}

/** Every installable app, in directory display order. */
export const CONNECTION_APPS: readonly ConnectionAppDescriptor[] =
  CONNECTION_PROVIDERS.map((provider) => APPS_BY_PROVIDER[provider])

export const getConnectionApp = (
  provider: ConnectionProvider
): ConnectionAppDescriptor => APPS_BY_PROVIDER[provider]
