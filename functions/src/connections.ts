/**
 * Connections — install/uninstall external-account apps and manage per-member
 * OAuth bindings (docs/connections-feature.prompt.md).
 *
 * Storage (all writes callable-only; rules deny client writes):
 *   teams/{teamId}/connections/{provider}                  — registration
 *   teams/{teamId}/connections/{provider}/bindings/{uid}   — link metadata
 *   teams/{teamId}/connections/{provider}/bindingSecrets/{uid} — OAuth tokens
 *     (NO client rules at all — tokens never leave functions)
 *
 * The capabilities an app contributes are ordinary docs in the unified
 * integrations collection with the reserved `source: "published"` and
 * `id == sourceKey` — written here on install, archived on uninstall, and
 * from there they flow through every existing pipe (listDispatchable →
 * enabledBuiltInTools → pickChatTools; SettingsTools' enable axis).
 *
 * OAuth flow: the client runs the GIS popup code flow (`initCodeClient`,
 * `redirect_uri: "postmessage"`, `prompt: "consent"`) and posts the one-time
 * code to `completeConnectionBinding`; the exchange happens HERE because only
 * functions hold the client secret. Token refresh is on-demand at tool-call
 * time (`resolveBindingAccessToken`), with `invalid_grant` flipping the
 * binding to `needs_reauth` (reconnect heals it).
 */

import { FieldValue } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { HttpsError } from "firebase-functions/v2/https"
import { z } from "zod"
// Call-time-only use (lifecycle audit entries) — the direct audit ↔
// connections module cycle is init-safe: both edges are hoisted function
// declarations touched only inside handlers, same class as audit.ts's
// existing call-time import of cleanupMemberConnectionBindings from here.
import { buildContext, logEvent } from "./audit.js"
import { assertAdminRole } from "./authGuards.js"
import { getMembershipRole } from "./bot.js"
import { getConnectionProviderSpec } from "./connectionProviders.js"
import {
  classifyGoogleTokenFailure,
  isConnectionDisabled,
  parseGoogleTokenResponse,
  shouldRefreshAccessToken,
  type ParsedTokenResponse,
} from "./connectionsCore.js"
import { defineCallable } from "./defineCallable.js"
import { CONNECTION_PROVIDERS, type ConnectionProvider } from "./domain.js"
import { db } from "./firebase.js"
import {
  integrationDocPath,
  invalidateIntegrationsCache,
} from "./integrations.js"
import { googleOauthClientId, googleOauthClientSecret } from "./secrets.js"

// ─── Paths ───────────────────────────────────────────────────────────────────

const connectionDocPath = (teamId: string, provider: string): string =>
  `teams/${teamId}/connections/${provider}`
const bindingDocPath = (
  teamId: string,
  provider: string,
  uid: string
): string => `${connectionDocPath(teamId, provider)}/bindings/${uid}`
const bindingSecretDocPath = (
  teamId: string,
  provider: string,
  uid: string
): string => `${connectionDocPath(teamId, provider)}/bindingSecrets/${uid}`

// ─── Google OAuth endpoints ──────────────────────────────────────────────────

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
/** GIS popup code flow's fixed pseudo redirect — pinned server-side. */
const POSTMESSAGE_REDIRECT_URI = "postmessage"

interface OauthClientConfig {
  clientId: string
  clientSecret: string
}

/**
 * Bound secrets surface as env vars, so this works in any function that
 * DECLARES the two secrets (the connection callables here, plus the chat /
 * workflow entry points whose turns may refresh a token mid-tool-call).
 * Null = the running function forgot to bind them — a config failure the
 * caller reports without throwing.
 */
function readOauthClientConfig(): OauthClientConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

type TokenRequestResult =
  | { ok: true; parsed: ParsedTokenResponse }
  | {
      ok: false
      kind: "invalid_grant" | "transient" | "rejected"
      message: string
    }

async function postTokenRequest(
  form: Record<string, string>
): Promise<TokenRequestResult> {
  let status = 0
  let body: unknown = null
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    })
    status = response.status
    body = await response.json().catch(() => null)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, kind: "transient", message }
  }
  if (status >= 200 && status < 300) {
    const parsed = parseGoogleTokenResponse(body, Date.now())
    if (parsed) return { ok: true, parsed }
    return {
      ok: false,
      kind: "rejected",
      message: "Token endpoint returned an unusable body.",
    }
  }
  const kind = classifyGoogleTokenFailure(status, body)
  const detail =
    typeof body === "object" && body !== null
      ? String((body as Record<string, unknown>).error ?? status)
      : String(status)
  return { ok: false, kind, message: `Token request failed (${detail}).` }
}

/** Best-effort token revocation — never throws, never blocks the caller. */
async function revokeTokenBestEffort(token: string | null): Promise<void> {
  if (!token) return
  try {
    await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch (error) {
    logger.warn("[connections] token revocation failed (ignored)", error)
  }
}

// ─── Callable: installConnection ─────────────────────────────────────────────

const providerInputSchema = z.object({
  teamId: z.string().min(1),
  provider: z.enum(CONNECTION_PROVIDERS),
})

export const installConnection = defineCallable({
  name: "installConnection",
  auth: "verified",
  appCheck: true,
  input: providerInputSchema,
  handler: async ({ request, auth, input }) => {
    const { teamId, provider } = input
    const role = await assertAdminRole(teamId, auth.uid)
    const spec = getConnectionProviderSpec(provider)

    const connRef = db.doc(connectionDocPath(teamId, provider))
    const toolRefs = spec.tools.map((tool) =>
      db.doc(integrationDocPath(teamId, tool.sourceKey))
    )
    await db.runTransaction(async (tx) => {
      const [connSnap, ...toolSnaps] = await tx.getAll(connRef, ...toolRefs)
      const now = FieldValue.serverTimestamp()
      tx.set(
        connRef,
        {
          provider,
          status: "active",
          installedByUid: auth.uid,
          scopes: spec.scopes,
          updatedAt: now,
          ...(connSnap.exists ? {} : { createdAt: now }),
        },
        { merge: true }
      )
      spec.tools.forEach((tool, index) => {
        const snap = toolSnaps[index]
        if (snap?.exists) {
          // Reinstall: un-archive + re-enable the published doc.
          tx.set(
            snap.ref,
            { archivedAt: null, enabled: true, updatedAt: now },
            { merge: true }
          )
          return
        }
        // First install: materialize the published integration doc. Unlike
        // built-ins there is no virtual overlay row — doc-backed means opt-in.
        tx.set(toolRefs[index]!, {
          type: "tool",
          source: "published",
          sourceKey: tool.sourceKey,
          name: tool.name,
          description: tool.description,
          avatarSeed: tool.avatarSeed,
          spec: null,
          enabled: true,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
          createdByUid: auth.uid,
        })
      })
      // Audited atomically with the install (covers reinstall too — that's
      // still an availability change worth a trail).
      await logEvent(
        {
          teamId,
          actor: {
            userId: auth.uid,
            email: auth.token.email ?? undefined,
            role,
          },
          action: "connection.install",
          resource: { type: "connection", id: provider, parentId: teamId },
          context: buildContext(request),
          changes: {
            fields: ["status", "scopes"],
            after: { status: "active", scopes: spec.scopes },
          },
        },
        { transaction: tx }
      )
    })
    invalidateIntegrationsCache(teamId)
    return { ok: true as const }
  },
})

// ─── Callable: uninstallConnection ───────────────────────────────────────────

export const uninstallConnection = defineCallable({
  name: "uninstallConnection",
  auth: "verified",
  appCheck: true,
  input: providerInputSchema,
  handler: async ({ request, auth, input }) => {
    const { teamId, provider } = input
    const role = await assertAdminRole(teamId, auth.uid)
    const spec = getConnectionProviderSpec(provider)

    const connRef = db.doc(connectionDocPath(teamId, provider))
    const connSnap = await connRef.get()
    if (!connSnap.exists) {
      throw new HttpsError("not-found", "Connection not installed.")
    }

    // Revoke every binding's tokens at Google first (best-effort — a failed
    // revocation must not strand the uninstall; deleting our copies is the
    // part we control).
    const secretsSnap = await db
      .collection(`${connectionDocPath(teamId, provider)}/bindingSecrets`)
      .get()
    for (const doc of secretsSnap.docs) {
      const data = doc.data()
      await revokeTokenBestEffort(
        typeof data.refreshToken === "string" ? data.refreshToken : null
      )
    }

    const bindingsSnap = await db
      .collection(`${connectionDocPath(teamId, provider)}/bindings`)
      .get()
    const batch = db.batch()
    for (const doc of secretsSnap.docs) batch.delete(doc.ref)
    for (const doc of bindingsSnap.docs) batch.delete(doc.ref)
    batch.delete(connRef)
    const now = FieldValue.serverTimestamp()
    for (const tool of spec.tools) {
      // Archive (not delete): archived tools don't dispatch, and reinstall
      // un-archives — the same soft lifecycle every integration follows.
      batch.set(
        db.doc(integrationDocPath(teamId, tool.sourceKey)),
        { archivedAt: now, updatedAt: now },
        { merge: true }
      )
    }
    await batch.commit()
    invalidateIntegrationsCache(teamId)
    // Post-commit, like the other multi-write deletions (deleteWorkspace):
    // the batch can't carry the log atomically, and auditing a SUCCEEDED
    // uninstall matters more than failing it over a log write. `bindings`
    // records how many member grants the uninstall revoked.
    await logEvent({
      teamId,
      actor: { userId: auth.uid, email: auth.token.email ?? undefined, role },
      action: "connection.uninstall",
      resource: { type: "connection", id: provider, parentId: teamId },
      context: buildContext(request),
      changes: {
        fields: ["status", "bindings"],
        before: {
          status: connSnap.data()?.status ?? "active",
          bindings: bindingsSnap.size,
        },
      },
    })
    return { ok: true as const }
  },
})

// ─── Callable: setConnectionDisabled ─────────────────────────────────────────

/**
 * The Owner/Admin team-wide kill switch (Settings → Connections → info
 * dialog). Non-destructive pause — bindings, tokens, and the contributed
 * integration docs all stay intact — distinct from uninstall (removal).
 * Three server gates key on the flipped `status`:
 *   - tool registration: `listIntegrations` force-resolves the connection's
 *     published docs to `enabled: false`, so neither interactive chats nor
 *     headless workflow runs register the tools;
 *   - token minting: `resolveBindingAccessToken` returns `disabled` — the
 *     hard guarantee behind any registration race (5s integrations cache);
 *   - new connects: `completeConnectionBinding` rejects.
 * `removeConnectionBinding` deliberately stays open — members can always
 * pull their own credentials out, disabled or not.
 */
export const setConnectionDisabled = defineCallable({
  name: "setConnectionDisabled",
  auth: "verified",
  appCheck: true,
  input: providerInputSchema.extend({ disabled: z.boolean() }),
  handler: async ({ request, auth, input }) => {
    const { teamId, provider, disabled } = input
    const role = await assertAdminRole(teamId, auth.uid)

    const connRef = db.doc(connectionDocPath(teamId, provider))
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(connRef)
      if (!snap.exists) {
        throw new HttpsError("not-found", "Connection not installed.")
      }
      const prevStatus = isConnectionDisabled(snap.data())
        ? "disabled"
        : "active"
      const nextStatus = disabled ? "disabled" : "active"
      // No-op flip (double-click, stale UI): write nothing, log nothing — a
      // phantom "disabled" entry with no state change would pollute the trail.
      if (prevStatus === nextStatus) return
      const now = FieldValue.serverTimestamp()
      tx.set(
        connRef,
        {
          status: nextStatus,
          // Admin-tab provenance; cleared on re-enable so a later disable
          // never shows a stale actor/time pair.
          disabledAt: disabled ? now : null,
          disabledByUid: disabled ? auth.uid : null,
          updatedAt: now,
        },
        { merge: true }
      )
      // Audited atomically with the flip — the kill switch is the
      // governance action this trail exists for.
      await logEvent(
        {
          teamId,
          actor: {
            userId: auth.uid,
            email: auth.token.email ?? undefined,
            role,
          },
          action: disabled ? "connection.disable" : "connection.enable",
          resource: { type: "connection", id: provider, parentId: teamId },
          context: buildContext(request),
          changes: {
            fields: ["status"],
            before: { status: prevStatus },
            after: { status: nextStatus },
          },
        },
        { transaction: tx }
      )
    })
    // The dispatch gate reads connection status through the integrations
    // cache — drop it so the flip takes effect on the next turn, not in ≤5s.
    invalidateIntegrationsCache(teamId)
    return { ok: true as const }
  },
})

// ─── Callable: completeConnectionBinding ─────────────────────────────────────

/**
 * Loopback-only allowlist for the desktop (Tauri) authorization flow —
 * RFC 8252's native-app pattern. The exchange's `redirect_uri` must equal
 * the one used in the authorization request, so the desktop client sends
 * the loopback address it listened on. Restricting to loopback hosts keeps
 * this parameter harmless: the code is single-use, bound to this exact URI
 * at issuance, and a loopback URI can't route the redirect anywhere but the
 * user's own machine.
 */
const LOOPBACK_REDIRECT_RE =
  /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}(\/[A-Za-z0-9/_-]*)?$/

export const completeConnectionBinding = defineCallable({
  name: "completeConnectionBinding",
  auth: "verified",
  appCheck: true,
  secrets: [googleOauthClientId, googleOauthClientSecret],
  input: providerInputSchema.extend({
    /** One-time authorization code from the GIS popup code flow. */
    code: z.string().min(1).max(2048),
    /**
     * Desktop (Tauri) flow only: the loopback redirect the system-browser
     * authorization used. Omitted by the web GIS popup flow (which pins
     * `postmessage`).
     */
    redirectUri: z.string().max(200).regex(LOOPBACK_REDIRECT_RE).optional(),
  }),
  handler: async ({ request, auth, input }) => {
    const { teamId, provider, code, redirectUri } = input
    // Member gate — any team member may bind their OWN account.
    const role = await getMembershipRole(teamId, auth.uid)

    const connSnap = await db.doc(connectionDocPath(teamId, provider)).get()
    if (!connSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "This app isn't installed for the team."
      )
    }
    // Kill switch: no NEW grants while an admin has the app paused. Existing
    // bindings are left alone (disconnect stays available; tokens just can't
    // be minted — see resolveBindingAccessToken).
    if (isConnectionDisabled(connSnap.data())) {
      throw new HttpsError(
        "failed-precondition",
        "This app is disabled for the team."
      )
    }

    const config = readOauthClientConfig()
    if (!config) {
      throw new HttpsError(
        "failed-precondition",
        "The server's Google OAuth client isn't configured."
      )
    }

    const result = await postTokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri ?? POSTMESSAGE_REDIRECT_URI,
    })
    if (!result.ok) {
      logger.warn("[connections] code exchange failed", {
        teamId,
        provider,
        kind: result.kind,
        // Google's error token (e.g. redirect_uri_mismatch, invalid_client) —
        // the discriminator that turns a generic "rejected" into a diagnosis.
        detail: result.message,
        redirectUri: redirectUri ?? "postmessage",
      })
      throw new HttpsError(
        result.kind === "transient" ? "unavailable" : "invalid-argument",
        "Couldn't complete the Google authorization. Try connecting again."
      )
    }

    const secretRef = db.doc(bindingSecretDocPath(teamId, provider, auth.uid))
    // `prompt: "consent"` on the client makes Google reissue the refresh
    // token, but keep the stored one as a fallback for the odd response
    // that omits it (re-consent races, policy edge cases).
    const existingSecret = (await secretRef.get()).data()
    const refreshToken =
      result.parsed.refreshToken ??
      (typeof existingSecret?.refreshToken === "string"
        ? existingSecret.refreshToken
        : null)
    if (!refreshToken) {
      throw new HttpsError(
        "failed-precondition",
        "Google didn't issue a long-lived grant. Try connecting again."
      )
    }

    const now = FieldValue.serverTimestamp()
    const batch = db.batch()
    batch.set(secretRef, {
      refreshToken,
      accessToken: result.parsed.accessToken,
      accessTokenExpiresAtMs: result.parsed.expiresAtMs,
      // Granted scopes ride on the secret doc too (not just the
      // member-visible binding doc) so `resolveBindingAccessToken` can hand
      // write tools the grant without a second read.
      scopes: result.parsed.scope ? result.parsed.scope.split(" ") : [],
      updatedAt: now,
    })
    batch.set(
      db.doc(bindingDocPath(teamId, provider, auth.uid)),
      {
        status: "connected",
        ...(result.parsed.email ? { email: result.parsed.email } : {}),
        scopes: result.parsed.scope ? result.parsed.scope.split(" ") : [],
        updatedAt: now,
        ...(existingSecret ? {} : { connectedAt: now }),
      },
      { merge: true }
    )
    await batch.commit()
    // Post-commit: an OAuth grant entering the system is the credential
    // event an audit trail is for. Reconnects/re-consents land here too —
    // each is a fresh grant. `after` mirrors the binding doc (email +
    // granted scopes), which members can already read.
    await logEvent({
      teamId,
      actor: { userId: auth.uid, email: auth.token.email ?? undefined, role },
      action: "connection.binding.create",
      resource: { type: "connection", id: provider, parentId: teamId },
      context: buildContext(request),
      changes: {
        fields: ["email", "scopes"],
        after: {
          email: result.parsed.email ?? null,
          scopes: result.parsed.scope ? result.parsed.scope.split(" ") : [],
        },
      },
    })
    return { ok: true as const, email: result.parsed.email }
  },
})

// ─── Callable: removeConnectionBinding ───────────────────────────────────────

export const removeConnectionBinding = defineCallable({
  name: "removeConnectionBinding",
  auth: "verified",
  appCheck: true,
  input: providerInputSchema,
  handler: async ({ request, auth, input }) => {
    const { teamId, provider } = input
    // Members disconnect their OWN account only (path is keyed by auth.uid).
    const role = await getMembershipRole(teamId, auth.uid)

    // Read before the delete so the trail records WHICH account was
    // unlinked; a disconnect with no binding is a no-op worth no entry.
    const bindingSnap = await db
      .doc(bindingDocPath(teamId, provider, auth.uid))
      .get()
    await revokeAndDeleteBinding(teamId, provider, auth.uid)
    if (bindingSnap.exists) {
      const email = bindingSnap.data()?.email
      await logEvent({
        teamId,
        actor: { userId: auth.uid, email: auth.token.email ?? undefined, role },
        action: "connection.binding.delete",
        resource: { type: "connection", id: provider, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["email"],
          before: { email: typeof email === "string" ? email : null },
        },
      })
    }
    return { ok: true as const }
  },
})

// ─── Binding teardown (shared by self-disconnect + member-removal cascade) ──

/**
 * Revoke a member's grant at Google (best-effort) and delete both binding
 * docs for ONE provider. The deletes are the part we control and must land;
 * a failed revocation is logged and ignored (the token also dies with the
 * grant's natural expiry, and uninstall/disconnect retries it).
 */
async function revokeAndDeleteBinding(
  teamId: string,
  provider: ConnectionProvider,
  uid: string
): Promise<void> {
  const secretRef = db.doc(bindingSecretDocPath(teamId, provider, uid))
  const secretSnap = await secretRef.get()
  if (secretSnap.exists) {
    const data = secretSnap.data()
    await revokeTokenBestEffort(
      typeof data?.refreshToken === "string" ? data.refreshToken : null
    )
  }
  const batch = db.batch()
  batch.delete(secretRef)
  batch.delete(db.doc(bindingDocPath(teamId, provider, uid)))
  await batch.commit()
}

/**
 * Member-removal cascade (docs/connections-feature.prompt.md): tear down
 * every connection binding the departing member holds in this team — revoke
 * the Google grant and delete `bindings/{uid}` + `bindingSecrets/{uid}`
 * across all providers. Stored-token minimization + an honest
 * "N members connected" count; the workflow executor's live-membership gate
 * (`resolveRunActsAsUid`) already stops removed members from powering runs,
 * so this is hygiene, not the security boundary.
 *
 * Iterates the static `CONNECTION_PROVIDERS` list rather than reading the
 * connections collection: deletes on absent docs are no-ops, so this also
 * sweeps stragglers from providers uninstalled through any historical path.
 * NEVER throws — it runs as a post-transaction best-effort cascade alongside
 * `removeMemberFromWorkspaces`, and the membership removal must stand even
 * when Google or Firestore hiccups here.
 *
 * Deliberately NOT audit-logged per binding: the `membership.remove` entry
 * already records the removal that triggered this, and per-provider sweep
 * noise (mostly no-ops) would dilute the trail.
 */
export async function cleanupMemberConnectionBindings(
  teamId: string,
  uid: string
): Promise<void> {
  for (const provider of CONNECTION_PROVIDERS) {
    try {
      await revokeAndDeleteBinding(teamId, provider, uid)
    } catch (error) {
      logger.warn("[connections] member binding cleanup failed (ignored)", {
        teamId,
        provider,
        uid,
        error,
      })
    }
  }
}

// ─── Tool-side token resolution ──────────────────────────────────────────────

export type BindingTokenResult =
  | {
      ok: true
      accessToken: string
      /**
       * Scopes Google actually granted on this binding (empty when the
       * stored secret predates scope persistence — P1 bindings heal on
       * their next refresh). Write tools gate on this via
       * `hasGrantedScope` and steer stale grants to reconnect.
       */
      grantedScopes: string[]
    }
  | {
      ok: false
      reason:
        | "not_connected"
        | "needs_reauth"
        | "config"
        | "transient"
        | "disabled"
    }

/**
 * Resolve a fresh access token for (team, provider, member) — the seam the
 * connection tools call per invocation. Refreshes when the stored token is
 * stale; `invalid_grant` flips the binding to `needs_reauth` (and a later
 * successful reconnect heals it). NEVER throws — tool handlers must map the
 * failure reasons to narratable output (a throw would abort the whole turn).
 *
 * This seam is also the kill switch's HARD gate: every connection tool call
 * funnels through here for its token, so checking the connection doc's
 * `status` per invocation guarantees no token leaves while an admin has the
 * app disabled — even when a tool registered before the flip (registration
 * resolves through a 5s cache) or a future registration path forgets the
 * gate.
 */
export async function resolveBindingAccessToken(
  teamId: string,
  provider: ConnectionProvider,
  uid: string | undefined
): Promise<BindingTokenResult> {
  if (!uid) return { ok: false, reason: "not_connected" }

  const connRef = db.doc(connectionDocPath(teamId, provider))
  const secretRef = db.doc(bindingSecretDocPath(teamId, provider, uid))
  let connSnap, secretSnap
  try {
    ;[connSnap, secretSnap] = await Promise.all([
      connRef.get(),
      secretRef.get(),
    ])
  } catch (error) {
    logger.warn("[connections] binding secret read failed", error)
    return { ok: false, reason: "transient" }
  }
  // Disabled outranks every other state: a missing binding on a disabled app
  // must say "disabled", not steer the user into a Connect that the server
  // would reject anyway.
  if (isConnectionDisabled(connSnap.data())) {
    return { ok: false, reason: "disabled" }
  }
  if (!secretSnap.exists) return { ok: false, reason: "not_connected" }
  const secret = secretSnap.data() ?? {}
  const accessToken =
    typeof secret.accessToken === "string" ? secret.accessToken : null
  const refreshToken =
    typeof secret.refreshToken === "string" ? secret.refreshToken : null
  const expiresAtMs =
    typeof secret.accessTokenExpiresAtMs === "number"
      ? secret.accessTokenExpiresAtMs
      : null
  const storedScopes = Array.isArray(secret.scopes)
    ? (secret.scopes as unknown[]).filter(
        (s): s is string => typeof s === "string"
      )
    : []

  if (accessToken && !shouldRefreshAccessToken(expiresAtMs, Date.now())) {
    return { ok: true, accessToken, grantedScopes: storedScopes }
  }
  if (!refreshToken) return { ok: false, reason: "needs_reauth" }

  const config = readOauthClientConfig()
  if (!config) return { ok: false, reason: "config" }

  const result = await postTokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })
  const bindingRef = db.doc(bindingDocPath(teamId, provider, uid))
  if (!result.ok) {
    if (result.kind === "invalid_grant") {
      // The grant is dead — surface it in Settings and to the model. Best-
      // effort write: the tool's narratable failure matters more than the flag.
      try {
        await bindingRef.set(
          { status: "needs_reauth", updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
      } catch (error) {
        logger.warn("[connections] needs_reauth flag write failed", error)
      }
      return { ok: false, reason: "needs_reauth" }
    }
    return { ok: false, reason: "transient" }
  }

  // The refresh response restates the grant — prefer it over the stored
  // copy (it also HEALS P1-era secret docs that predate scope persistence).
  const refreshedScopes = result.parsed.scope
    ? result.parsed.scope.split(" ")
    : storedScopes
  try {
    await secretRef.set(
      {
        accessToken: result.parsed.accessToken,
        accessTokenExpiresAtMs: result.parsed.expiresAtMs,
        // Google occasionally rotates the refresh token on refresh.
        ...(result.parsed.refreshToken
          ? { refreshToken: result.parsed.refreshToken }
          : {}),
        ...(result.parsed.scope ? { scopes: refreshedScopes } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    // A refresh that succeeds after a needs_reauth flag heals the binding.
    await bindingRef.set(
      { status: "connected", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
  } catch (error) {
    // Persisting the refreshed token is an optimization — the token itself
    // is still valid for this call.
    logger.warn("[connections] refreshed token persist failed", error)
  }
  return {
    ok: true,
    accessToken: result.parsed.accessToken,
    grantedScopes: refreshedScopes,
  }
}
