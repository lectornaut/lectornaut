/**
 * Connection provider registry — pure data describing each installable
 * connection app (docs/connections-feature.prompt.md): which OAuth scopes its
 * bindings request and which integration docs (`source: "published"`) it
 * contributes on install. The client mirror is `src/data/connectionApps.ts`;
 * keep display copy in sync.
 *
 * Pure data + lookups (no Firebase imports) so `node --test` can cover any
 * future helpers without an emulator.
 */

// Package specifier (not `./domain.js`/`./connectionsCore.js`) so bare
// `node --test` can load this module directly — same rule as
// connectionsCore.ts (type-stripping honors the workspace exports map but
// not relative `.js`→`.ts`).
import {
  GITHUB_READ_FILE_TOOL_NAME,
  GITHUB_TOOL_KEY,
  GITHUB_WRITE_TOOL_NAMES,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_TOOL_KEY,
  GOOGLE_CALENDAR_WRITE_TOOL_NAMES,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_READ_FILE_TOOL_NAME,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_DRIVE_TOOL_KEY,
  GOOGLE_DRIVE_WRITE_TOOL_NAMES,
  type ConnectionProvider,
} from "@lectornaut/shared/domain"

export interface ConnectionContributedTool {
  /** Integration `sourceKey` AND Genkit wire-name (doc id == sourceKey). */
  sourceKey: string
  name: string
  description: string
  avatarSeed: string
}

/**
 * Per-provider OAuth substrate config — the data that lets ONE token-exchange
 * path serve every provider. Google and GitHub speak the same authorization-
 * code + token-endpoint shape; only these knobs differ.
 */
export interface ProviderOauthConfig {
  /** Token endpoint for the authorization-code AND refresh grants. */
  tokenUrl: string
  /**
   * Best-effort token revocation endpoint, or null to skip. GitHub's revoke
   * is an app-authenticated DELETE we don't call; the grant dies on the
   * user's GitHub settings instead.
   */
  revokeUrl: string | null
  /**
   * Whether bind must REQUIRE a refresh token. True for Google (always issues
   * one); false for GitHub (classic OAuth issues none, and a GitHub App may or
   * may not depending on its token-expiration setting — either is fine, the
   * parser auto-detects expiry). Token lifetime itself is detected from
   * `expires_in`, not configured here.
   */
  expectsRefreshToken: boolean
  /**
   * Userinfo endpoint to fetch the binding's identity label when the token
   * response carries no `id_token` (GitHub `GET /user`); null when the email
   * rides the id_token (Google).
   */
  userInfoUrl: string | null
  /** Env-var names holding this provider's confidential OAuth client (each
   * must be bound as a `defineSecret` on every function that exchanges or
   * refreshes a token). */
  clientIdEnvVar: string
  clientSecretEnvVar: string
}

export interface ConnectionProviderSpec {
  provider: ConnectionProvider
  name: string
  description: string
  avatarSeed: string
  /**
   * Scopes the per-user OAuth popup requests. For Google, `openid email`
   * rides along so the token exchange returns an `id_token` whose email
   * labels the binding row; GitHub has no id_token, so identity comes from
   * `oauth.userInfoUrl` instead.
   */
  scopes: string[]
  /** OAuth endpoint + token-lifecycle config (see ProviderOauthConfig). */
  oauth: ProviderOauthConfig
  tools: ConnectionContributedTool[]
  /**
   * EVERY Genkit wire-name the app registers — the doc-backed sourceKeys
   * plus the companion tools that ride the same install gate (write tools,
   * extra read tools). Feeds `CONNECTION_TOOL_WIRE_NAMES` so a custom tool
   * can't shadow ANY of them (sourceKeys alone left the calendar write
   * names unguarded).
   */
  wireNames: readonly string[]
}

const GOOGLE_OAUTH: ProviderOauthConfig = {
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  expectsRefreshToken: true,
  userInfoUrl: null,
  clientIdEnvVar: "GOOGLE_OAUTH_CLIENT_ID",
  clientSecretEnvVar: "GOOGLE_OAUTH_CLIENT_SECRET",
}

const GOOGLE_CALENDAR: ConnectionProviderSpec = {
  provider: "google-calendar",
  name: "Google Calendar",
  description:
    "Let agents look up — and, with per-write confirmation, schedule — " +
    "events on members' connected Google Calendars.",
  avatarSeed: "google-calendar",
  // P2 upgraded `calendar.events.readonly` → `calendar.events` (read + write;
  // the broader scope covers reads). Bindings created under P1 keep working
  // for reads; write tools check the binding's GRANTED scopes at call time
  // and steer stale grants to reconnect.
  scopes: ["openid", "email", GOOGLE_CALENDAR_EVENTS_SCOPE],
  oauth: GOOGLE_OAUTH,
  tools: [
    {
      sourceKey: GOOGLE_CALENDAR_TOOL_KEY,
      name: "Google Calendar",
      description:
        "Look up events on the chatting member's connected Google Calendar.",
      avatarSeed: GOOGLE_CALENDAR_TOOL_KEY,
    },
  ],
  wireNames: [GOOGLE_CALENDAR_TOOL_KEY, ...GOOGLE_CALENDAR_WRITE_TOOL_NAMES],
}

const GOOGLE_DRIVE: ConnectionProviderSpec = {
  provider: "google-drive",
  name: "Google Drive",
  description:
    "Let agents search, read, and (with confirmation) save files in " +
    "members' connected Google Drives.",
  avatarSeed: "google-drive",
  // The least-privilege pair (docs/connections-google-drive.prompt.md):
  // `drive.readonly` (RESTRICTED — CASA assessment) powers search/read;
  // `drive.file` (non-sensitive) powers the confirm-gated write tools,
  // which reach only files the app created or the user picked. NEVER the
  // full `drive` scope. Bindings granted before `drive.file` was declared
  // surface the `needsScopeUpgrade` reconnect hint (calendar P2 precedent).
  scopes: [
    "openid",
    "email",
    GOOGLE_DRIVE_READONLY_SCOPE,
    GOOGLE_DRIVE_FILE_SCOPE,
  ],
  oauth: GOOGLE_OAUTH,
  tools: [
    {
      sourceKey: GOOGLE_DRIVE_TOOL_KEY,
      name: "Google Drive",
      description:
        "Search, read and — with per-write confirmation — save files on " +
        "the chatting member's connected Google Drive.",
      avatarSeed: GOOGLE_DRIVE_TOOL_KEY,
    },
  ],
  // `readDriveFile` and the confirm-gated write tools all ride the ONE
  // googleDrive install gate (no integration docs of their own).
  wireNames: [
    GOOGLE_DRIVE_TOOL_KEY,
    GOOGLE_DRIVE_READ_FILE_TOOL_NAME,
    ...GOOGLE_DRIVE_WRITE_TOOL_NAMES,
  ],
}

const GITHUB: ConnectionProviderSpec = {
  provider: "github",
  name: "GitHub",
  description:
    "Let agents search and read repositories, and — with per-write " +
    "confirmation — file issues and comment on members' connected GitHub.",
  avatarSeed: "github",
  // GitHub App, NOT OAuth App: access is governed by the app's granted
  // PERMISSIONS (Issues, Contents, …) and which repos it's installed on — NOT
  // OAuth scopes. So no `scope` is requested; the token response carries none.
  // Identity comes from `oauth.userInfoUrl` (GitHub has no id_token).
  scopes: [],
  oauth: {
    // GitHub App user-authorization uses the SAME OAuth endpoints as an OAuth
    // App. User tokens may expire (8h) + refresh, or not, per the app's
    // "Expire user authorization tokens" setting — the parser auto-detects
    // either from `expires_in`, so we don't require a refresh token.
    tokenUrl: "https://github.com/login/oauth/access_token",
    revokeUrl: null,
    expectsRefreshToken: false,
    userInfoUrl: "https://api.github.com/user",
    clientIdEnvVar: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnvVar: "GITHUB_OAUTH_CLIENT_SECRET",
  },
  tools: [
    {
      sourceKey: GITHUB_TOOL_KEY,
      name: "GitHub",
      description:
        "Search and read issues, pull requests, repositories and file " +
        "contents on the chatting member's connected GitHub.",
      avatarSeed: GITHUB_TOOL_KEY,
    },
  ],
  // `readGitHubFile` and the confirm-gated write tools all ride the ONE
  // gitHub install gate (no integration docs of their own).
  wireNames: [
    GITHUB_TOOL_KEY,
    GITHUB_READ_FILE_TOOL_NAME,
    ...GITHUB_WRITE_TOOL_NAMES,
  ],
}

const PROVIDERS: Readonly<Record<ConnectionProvider, ConnectionProviderSpec>> =
  {
    "google-calendar": GOOGLE_CALENDAR,
    "google-drive": GOOGLE_DRIVE,
    github: GITHUB,
  }

export function getConnectionProviderSpec(
  provider: ConnectionProvider
): ConnectionProviderSpec {
  return PROVIDERS[provider]
}

/**
 * Wire-names of every connection tool — doc-backed sourceKeys AND the
 * companion/write tools riding the same install gates — for the custom-tool
 * wire-name collision guard (`assertWireNameUnique`): a custom tool must not
 * shadow a connection tool any more than a built-in one. Union with the
 * sourceKeys so a spec that forgets to repeat its sourceKey in `wireNames`
 * still guards it.
 */
export const CONNECTION_TOOL_WIRE_NAMES: ReadonlySet<string> = new Set(
  Object.values(PROVIDERS).flatMap((spec) => [
    ...spec.wireNames,
    ...spec.tools.map((tool) => tool.sourceKey),
  ])
)

/**
 * Owning provider for each contributed tool `sourceKey` — lets the
 * integrations resolver trace a published doc back to its connection. The
 * team-wide kill switch lives on the CONNECTION doc (one flip covers every
 * tool the app contributes), so dispatch gating needs this reverse edge.
 */
export const CONNECTION_PROVIDER_BY_SOURCE_KEY: ReadonlyMap<
  string,
  ConnectionProvider
> = new Map(
  Object.values(PROVIDERS).flatMap((spec) =>
    spec.tools.map((tool) => [tool.sourceKey, spec.provider] as const)
  )
)
