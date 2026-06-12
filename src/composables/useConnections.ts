/**
 * useConnections — read-model + verbs for Settings → Connections
 * (SettingsConnections.vue; docs/connections-feature.prompt.md).
 *
 * Reads (live, member-visible):
 *   - `teams/{teamId}/connections` — which apps are installed.
 *   - `…/connections/{provider}/bindings` — who has linked an account
 *     (metadata only; tokens live in `bindingSecrets`, unreadable by rules).
 *
 * Verbs:
 *   - install / uninstall (admin-gated) — registration only, no OAuth.
 *   - connect / disconnect (any member, own account) — `connect` runs the
 *     GIS popup **code** flow client-side and posts the one-time code to
 *     `completeConnectionBinding`; the exchange happens server-side because
 *     only functions hold the OAuth client secret.
 *
 * Both write paths are callable-applied with NO optimistic layer: install is
 * an admin action where a roundtrip is fine, and connect's latency is the
 * OAuth popup itself. The live listeners reflect the result.
 */

import {
  completeConnectionBinding as completeConnectionBindingFn,
  installConnection as installConnectionFn,
  removeConnectionBinding as removeConnectionBindingFn,
  setConnectionDisabled as setConnectionDisabledFn,
  uninstallConnection as uninstallConnectionFn,
} from "@/composables/useFunctions"
import { isTauri } from "@/composables/usePlatform"
import {
  CONNECTION_APPS,
  getConnectionApp,
  type ConnectionAppDescriptor,
} from "@/data/connectionApps"
import type { IConnection, IConnectionBinding } from "@/schemas/connections"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import {
  getConnectionBindingRef,
  getConnectionBindingsCollection,
  getConnectionRef,
  getConnectionsCollection,
} from "@/utils/firebase/firebase-helpers"
import {
  useCollectionQuery,
  useDocumentQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import {
  hasGrantedScope,
  type ConnectionProvider,
} from "@lectornaut/shared/domain"
import { invoke } from "@tauri-apps/api/core"
import { storeToRefs } from "pinia"
import { computed, type ComputedRef } from "vue"
import { toast } from "vue-sonner"

// ─── GIS popup code flow ─────────────────────────────────────────────────────
// Loaded on demand from Google's CDN — the library is script-only (no npm
// package) and only members who click Connect ever pay for it.

const GIS_SRC = "https://accounts.google.com/gsi/client"

interface GoogleCodeResponse {
  code?: string
  error?: string
}

interface GoogleCodeClientConfig {
  client_id: string
  scope: string
  ux_mode: "popup"
  /** Forces a refresh-token reissue on every connect (see connections.ts). */
  prompt: "consent"
  callback: (response: GoogleCodeResponse) => void
  error_callback?: (error: { type?: string; message?: string }) => void
}

interface GoogleCodeClient {
  requestCode(): void
}

interface GisWindow {
  google?: {
    accounts?: {
      oauth2?: {
        initCodeClient(config: GoogleCodeClientConfig): GoogleCodeClient
      }
    }
  }
}

let gisLoad: Promise<void> | null = null

function loadGis(): Promise<void> {
  const win = window as unknown as GisWindow
  if (win.google?.accounts?.oauth2) return Promise.resolve()
  gisLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      gisLoad = null // allow a retry after a transient network failure
      reject(new Error("Couldn't load Google's sign-in library."))
    }
    document.head.appendChild(script)
  })
  return gisLoad
}

/**
 * GIS `error_callback` types we branch UX on: a blocked popup gets an
 * actionable toast; a user-closed popup is a deliberate cancel, not an error.
 */
const GIS_POPUP_BLOCKED = "popup_failed_to_open"
const GIS_POPUP_CLOSED = "popup_closed"

// ─── Tauri system-browser flow ───────────────────────────────────────────────
// Inside the Tauri webview the GIS popup flow is unusable twice over: the
// webview won't spawn the popup, and Google rejects OAuth from embedded
// webviews outright (`disallowed_useragent`). The native pattern (RFC 8252)
// runs instead: the `authorize_oauth` Rust command opens the consent page in
// the SYSTEM browser, catches the redirect on a loopback listener, and hands
// back the one-time code — which goes to the SAME `completeConnectionBinding`
// exchange, now with the loopback `redirectUri` (the server allowlists
// loopback hosts only). Tokens never exist inside the app.

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"

/**
 * Loopback redirect the desktop authorization listens on — registered
 * VERBATIM under the connections OAuth client's Authorized redirect URIs
 * (docs/connections-feature.prompt.md → deploy prerequisites). Sharing the
 * sign-in listener's port is safe: both flows are one-shot and
 * user-sequential, so they never race; the distinct path keeps the two
 * registrations self-documenting in the console.
 */
const TAURI_LOOPBACK_REDIRECT_URI = "http://localhost:7878/connections-callback"

interface TauriAuthorizationResult {
  code: string
  state: string | null
}

/** Run the system-browser flow; resolve with code + the loopback redirect. */
async function requestAuthorizationCodeTauri(
  app: ConnectionAppDescriptor,
  clientId: string
): Promise<{ code: string; redirectUri: string }> {
  // CSRF binding: the redirect must echo our nonce or the code is discarded
  // (a planted redirect to the loopback can't forge a code into our flow).
  const state = crypto.randomUUID()
  const result = await invoke<TauriAuthorizationResult>("authorize_oauth", {
    config: {
      auth_url: GOOGLE_AUTH_ENDPOINT,
      client_id: clientId,
      redirect_uri: TAURI_LOOPBACK_REDIRECT_URI,
      scopes: app.scopes.join(" "),
      extra_params: {
        // Same grant semantics as the GIS popup flow: offline for the
        // refresh token, consent so Google reissues it on reconnect.
        access_type: "offline",
        prompt: "consent",
        state,
      },
    },
  })
  if (result.state !== state) {
    throw new Error("Authorization state mismatch — discarding the code.")
  }
  return { code: result.code, redirectUri: TAURI_LOOPBACK_REDIRECT_URI }
}

/**
 * Run the popup and resolve with the one-time authorization code.
 *
 * POPUP-BLOCKER CONSTRAINT: browsers allow `window.open` only inside a live
 * user activation (the click). Everything between the click and
 * `client.requestCode()` must therefore stay synchronous-or-microtask —
 * which is why `loadGis()` is PRELOADED at composable setup (below): on
 * first use, loading the script here would burn the activation on a network
 * fetch and the popup would open blocked ("Failed to open popup window").
 * With the script warm, `await loadGis()` is a resolved-promise microtask
 * and the popup opens within the activation window.
 */
async function requestAuthorizationCode(
  app: ConnectionAppDescriptor,
  clientId: string
): Promise<string> {
  await loadGis()
  const win = window as unknown as GisWindow
  const oauth2 = win.google?.accounts?.oauth2
  if (!oauth2) throw new Error("Couldn't load Google's sign-in library.")
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: app.scopes.join(" "),
      ux_mode: "popup",
      prompt: "consent",
      callback: (response) => {
        if (response.code) resolve(response.code)
        else reject(new Error(response.error ?? GIS_POPUP_CLOSED))
      },
      error_callback: (error) => {
        // Surface the machine-readable `type` as the message so `connect()`
        // can branch (blocked → actionable toast; closed → silent cancel).
        reject(new Error(error.type ?? error.message ?? "Popup failed."))
      },
    })
    client.requestCode()
  })
}

// ─── Composable ──────────────────────────────────────────────────────────────

export interface ConnectionAppRow {
  app: ConnectionAppDescriptor
  installed: boolean
  /**
   * The installed connection doc (status, installedByUid, createdAt,
   * disable provenance) — the info dialog renders from it. Null while not
   * installed.
   */
  connection: IConnection | null
  /**
   * Owner/Admin kill switch is ON (`status: "disabled"`): the server stops
   * registering the app's tools and minting tokens, and rejects new
   * connects. Bindings stay intact; Disconnect remains available.
   */
  disabled: boolean
  /** The signed-in member's own binding, when they've connected an account. */
  myBinding: IConnectionBinding | null
  /** Every member's binding (metadata only) — the info dialog's roster. */
  bindings: IConnectionBinding[]
  /** How many members have linked accounts (drives the roster line). */
  bindingCount: number
  /**
   * The member's binding is healthy but its GRANT predates the app's current
   * scope set (e.g. a P1 read-only Google Calendar grant after the P2 write
   * upgrade). Surfaces a "Reconnect to grant new permissions" hint — refresh
   * tokens never widen scope, only a fresh consent popup does.
   */
  needsScopeUpgrade: boolean
}

/** Identity scopes ride along for the binding email — not capabilities. */
const IDENTITY_SCOPES = new Set(["openid", "email"])

/**
 * A capability scope the app needs that the binding's grant doesn't cover.
 * Uses the SHARED `hasGrantedScope` hierarchy (not literal `includes`) so a
 * broader grant — e.g. `calendar` satisfying `calendar.events` — isn't
 * mis-flagged as missing, which would nag "reconnect" forever while writes
 * actually succeed server-side (the server gates on the same helper).
 */
const isMissingRequestedScopes = (
  app: ConnectionAppDescriptor,
  binding: IConnectionBinding
): boolean =>
  app.scopes.some(
    (scope) =>
      !IDENTITY_SCOPES.has(scope) && !hasGrantedScope(binding.scopes, scope)
  )

export function useConnections() {
  const { t } = useI18n()

  // Warm the GIS script the moment a Connections surface exists. The popup
  // in `requestAuthorizationCode` must open within the Connect click's user
  // activation — loading the script lazily on that first click spends the
  // activation on a network fetch and the browser blocks the popup. A
  // failed preload is ignored: `loadGis()` resets itself on error, so the
  // click path retries (and then surfaces the blocked/offline toast).
  // Pointless inside Tauri, which uses the system-browser flow instead.
  if (typeof window !== "undefined" && !isTauri.value) {
    void loadGis().catch(() => undefined)
  }

  const authStore = useAuthStore()
  const { currentTeamId, currentUser } = storeToRefs(authStore)

  const membershipStore = useMembershipStore()
  const { isOwner, isAdmin } = storeToRefs(membershipStore)
  /** Install/uninstall gate — mirrors `useIntegrations.canManage`. */
  const canManage = computed(() => isOwner.value || isAdmin.value)

  const connectionsQuery = useCollectionQuery<IConnection>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/connections`
      return { query: getConnectionsCollection(teamId), path }
    }
  )

  const connectionsByProvider = computed<Map<string, IConnection>>(() => {
    const map = new Map<string, IConnection>()
    for (const conn of connectionsQuery.data.value ?? []) {
      if (conn) map.set(conn.provider, conn)
    }
    return map
  })

  // One live bindings query per provider. `CONNECTION_PROVIDERS` is a static
  // compile-time list, so the loop count is fixed — safe in a setup context.
  const bindingsByProvider = new Map<
    ConnectionProvider,
    ReturnType<typeof useCollectionQuery<IConnectionBinding>>
  >()
  for (const app of CONNECTION_APPS) {
    bindingsByProvider.set(
      app.provider,
      useCollectionQuery<IConnectionBinding>(
        (): CollectionQuerySource | null => {
          const teamId = currentTeamId.value
          if (!teamId) return null
          // Only listen while installed — the collection is empty otherwise,
          // and gating avoids N idle listeners on never-installed apps.
          if (!connectionsByProvider.value.has(app.provider)) return null
          const path = `teams/${teamId}/connections/${app.provider}/bindings`
          return {
            query: getConnectionBindingsCollection(teamId, app.provider),
            path,
          }
        }
      )
    )
  }

  const rows: ComputedRef<ConnectionAppRow[]> = computed(() => {
    const uid = currentUser.value?.uid ?? null
    return CONNECTION_APPS.map((app) => {
      const connection = connectionsByProvider.value.get(app.provider) ?? null
      const bindings = (
        bindingsByProvider.get(app.provider)?.data.value ?? []
      ).filter((b): b is IConnectionBinding => !!b)
      const myBinding = uid
        ? (bindings.find((b) => b.id === uid) ?? null)
        : null
      return {
        app,
        installed: connection !== null,
        connection,
        disabled: connection?.status === "disabled",
        myBinding,
        bindings,
        bindingCount: bindings.length,
        needsScopeUpgrade:
          myBinding !== null &&
          myBinding.status === "connected" &&
          isMissingRequestedScopes(app, myBinding),
      }
    })
  })

  const isLoading = computed<boolean>(() => connectionsQuery.isLoading.value)

  // ── Verbs ──────────────────────────────────────────────────────────────────

  const requireTeam = (): string | null => {
    const teamId = currentTeamId.value
    if (!teamId) {
      toast.error(t("settings.connections.permissionRequired"))
      return null
    }
    return teamId
  }

  const install = async (provider: ConnectionProvider): Promise<void> => {
    if (!canManage.value) {
      toast.error(t("settings.connections.permissionRequired"))
      return
    }
    const teamId = requireTeam()
    if (!teamId) return
    try {
      await installConnectionFn({ teamId, provider })
      toast.success(t("settings.connections.addSuccess"))
    } catch (error) {
      console.error("[useConnections] install failed:", error)
      toast.error(t("settings.connections.addError"))
      throw error
    }
  }

  const uninstall = async (provider: ConnectionProvider): Promise<void> => {
    if (!canManage.value) {
      toast.error(t("settings.connections.permissionRequired"))
      return
    }
    const teamId = requireTeam()
    if (!teamId) return
    try {
      await uninstallConnectionFn({ teamId, provider })
      toast.success(t("settings.connections.removeSuccess"))
    } catch (error) {
      console.error("[useConnections] uninstall failed:", error)
      toast.error(t("settings.connections.removeError"))
      throw error
    }
  }

  /**
   * Owner/Admin team-wide kill switch — pause (true) or resume (false) the
   * app for everyone. Non-destructive: bindings and the contributed
   * integration docs stay put; the server stops registering tools, minting
   * tokens, and accepting new connects while paused.
   */
  const setDisabled = async (
    provider: ConnectionProvider,
    disabled: boolean
  ): Promise<void> => {
    if (!canManage.value) {
      toast.error(t("settings.connections.permissionRequired"))
      return
    }
    const teamId = requireTeam()
    if (!teamId) return
    try {
      await setConnectionDisabledFn({ teamId, provider, disabled })
      toast.success(
        t(
          disabled
            ? "settings.connections.disableSuccess"
            : "settings.connections.enableSuccess"
        )
      )
    } catch (error) {
      console.error("[useConnections] setDisabled failed:", error)
      toast.error(t("settings.connections.setDisabledError"))
      throw error
    }
  }

  /** Link the signed-in member's own account: GIS popup → code → callable. */
  const connect = async (provider: ConnectionProvider): Promise<void> => {
    const teamId = requireTeam()
    if (!teamId) return
    // Kill switch: the server rejects new grants while disabled — skip the
    // OAuth popup entirely rather than walking the member through a consent
    // screen that's doomed to fail.
    if (connectionsByProvider.value.get(provider)?.status === "disabled") {
      toast.error(t("settings.connections.disabledByAdmin"))
      return
    }
    const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as
      | string
      | undefined
    if (!clientId) {
      toast.error(t("settings.connections.notConfigured"))
      return
    }
    try {
      // Tauri: system-browser + loopback (the webview can't run the GIS
      // popup and Google rejects embedded webviews). Web: GIS popup.
      const grant = isTauri.value
        ? await requestAuthorizationCodeTauri(
            getConnectionApp(provider),
            clientId
          )
        : {
            code: await requestAuthorizationCode(
              getConnectionApp(provider),
              clientId
            ),
            redirectUri: undefined,
          }
      await completeConnectionBindingFn({
        teamId,
        provider,
        code: grant.code,
        ...(grant.redirectUri ? { redirectUri: grant.redirectUri } : {}),
      })
      toast.success(t("settings.connections.connectSuccess"))
    } catch (error) {
      const reason = error instanceof Error ? error.message : ""
      // The user closed the popup — a deliberate cancel, not a failure.
      if (reason.includes(GIS_POPUP_CLOSED)) return
      console.error("[useConnections] connect failed:", error)
      toast.error(
        t(
          reason.includes(GIS_POPUP_BLOCKED)
            ? "settings.connections.popupBlocked"
            : "settings.connections.connectError"
        )
      )
      throw error
    }
  }

  /** Unlink the signed-in member's own account (revokes server-side). */
  const disconnect = async (provider: ConnectionProvider): Promise<void> => {
    const teamId = requireTeam()
    if (!teamId) return
    try {
      await removeConnectionBindingFn({ teamId, provider })
      toast.success(t("settings.connections.disconnectSuccess"))
    } catch (error) {
      console.error("[useConnections] disconnect failed:", error)
      toast.error(t("settings.connections.disconnectError"))
      throw error
    }
  }

  return {
    canManage,
    isLoading,
    rows,
    install,
    uninstall,
    setDisabled,
    connect,
    disconnect,
  }
}

// ─── Lightweight per-feature availability ────────────────────────────────────

/**
 * useMyConnectionFeature — "can the signed-in member use {provider}-backed
 * features right now?" for surfaces OUTSIDE Settings → Connections (e.g. the
 * attachment sidebars' "Add from Drive" buttons).
 *
 * Deliberately NOT `useConnections()`: that composable preloads the GIS
 * script and opens a bindings-roster listener per provider — too heavy for
 * sidebars that mount everywhere. This one watches exactly two documents
 * (the connection doc + the member's OWN binding), both deduped with the
 * settings pages' subscriptions via the query cache.
 *
 * `available` is the three-condition gate, matching the server's own checks:
 *   1. the app is installed (connection doc exists),
 *   2. the Owner/Admin kill switch is off (`status !== "disabled"`),
 *   3. the member has linked their account (own binding doc exists — a
 *      `needs_reauth` binding still counts; the feature's own dialog
 *      surfaces the server's reconnect steer).
 * Settings → Connections stays the discovery surface: members who never
 * connected don't see the feature at all.
 */
export function useMyConnectionFeature(provider: ConnectionProvider) {
  const { currentTeamId, currentUser } = storeToRefs(useAuthStore())

  const connectionQuery = useDocumentQuery<IConnection>(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null
    return getConnectionRef(teamId, provider)
  })

  const bindingQuery = useDocumentQuery<IConnectionBinding>(() => {
    const teamId = currentTeamId.value
    const uid = currentUser.value?.uid
    // Only listen while installed — mirrors useConnections' roster gating.
    if (!teamId || !uid || !connectionQuery.data.value) return null
    return getConnectionBindingRef(teamId, provider, uid)
  })

  const available = computed<boolean>(() => {
    const connection = connectionQuery.data.value
    if (!connection || connection.status === "disabled") return false
    return !!bindingQuery.data.value
  })

  return { available }
}
