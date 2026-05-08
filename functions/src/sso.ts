import * as logger from "firebase-functions/logger"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { logEvent } from "./audit.js"
import { admin, auth, db } from "./firebase.js"
import { can } from "./permissions.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import { Actor, Capabilities, type IMembershipRole } from "./types.js"

// ============================================================================
// Helpers
// ============================================================================

function assertAuthenticated(
  request: CallableRequest
): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>
} {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
}

function assertString(value: unknown, field: string): string {
  if (!value || typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty string.`
    )
  }
  return trimmed
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-empty array.`
    )
  }
  return value.map((v, i) => assertString(v, `${field}[${i}]`).toLowerCase())
}

function buildContext(request: CallableRequest) {
  const raw = request.rawRequest
  const ip =
    (raw?.headers?.["x-forwarded-for"] as string | undefined) ??
    raw?.ip ??
    undefined
  const userAgent = raw?.headers?.["user-agent"] as string | undefined
  const context: Record<string, string> = {}
  if (ip) context.ip = ip
  if (userAgent) context.userAgent = userAgent
  return Object.keys(context).length > 0 ? context : undefined
}

async function requireTeamAdmin(
  teamId: string,
  userId: string
): Promise<{ role: IMembershipRole; actor: Actor }> {
  const membershipSnap = await db
    .doc(`teams/${teamId}/memberships/${userId}`)
    .get()

  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "User is not a team member.")
  }

  const role = membershipSnap.data()?.role as IMembershipRole
  if (
    !can(userId, Capabilities.MANAGE_SECURITY, {
      scope: "team",
      teamRole: role,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to manage security settings."
    )
  }

  const actor: Actor = {
    userId,
    email: membershipSnap.data()?.user?.email,
    role,
  }

  return { role, actor }
}

async function requireEnterprisePlan(teamId: string) {
  const teamSnap = await db.doc(`teams/${teamId}`).get()
  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.")
  }
  const billing = teamSnap.data()?.billing
  if (billing?.planKey !== "enterprise") {
    throw new HttpsError(
      "failed-precondition",
      "SSO is only available on the Enterprise plan."
    )
  }
}

function isValidDomain(domain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
    domain
  )
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function isValidPemCertificate(cert: string): boolean {
  const trimmed = cert.trim()
  return (
    trimmed.startsWith("-----BEGIN CERTIFICATE-----") &&
    trimmed.includes("-----END CERTIFICATE-----")
  )
}

// ============================================================================
// configureSso
// ============================================================================

export const configureSso = onCall({ ...CALLABLE_OPTS }, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const protocol = assertString(request.data?.protocol, "protocol")
  const domains = assertStringArray(request.data?.domains, "domains")
  const enforced = Boolean(request.data?.enforced)
  const autoProvision = Boolean(request.data?.autoProvision)
  const defaultRole = request.data?.defaultRole === "guest" ? "guest" : "member"

  if (protocol !== "saml" && protocol !== "oidc") {
    throw new HttpsError(
      "invalid-argument",
      'Protocol must be "saml" or "oidc".'
    )
  }

  if (domains.length > 50) {
    throw new HttpsError(
      "invalid-argument",
      "A maximum of 50 domains can be configured per team."
    )
  }

  // Validate domains
  for (const domain of domains) {
    if (!isValidDomain(domain)) {
      throw new HttpsError("invalid-argument", `Invalid domain: ${domain}`)
    }
  }

  // Auth + permission check
  const { actor } = await requireTeamAdmin(teamId, request.auth.uid)
  await requireEnterprisePlan(teamId)

  const providerId = protocol === "saml" ? `saml.${teamId}` : `oidc.${teamId}`

  // Register or update the Firebase Auth provider (idempotent, outside transaction)
  let ssoDoc: Record<string, unknown>

  if (protocol === "saml") {
    const idpEntityId = assertString(
      request.data?.saml?.idpEntityId,
      "saml.idpEntityId"
    )
    const ssoUrl = assertString(request.data?.saml?.ssoUrl, "saml.ssoUrl")
    const certificate = assertString(
      request.data?.saml?.certificate,
      "saml.certificate"
    )

    if (!isValidUrl(ssoUrl)) {
      throw new HttpsError("invalid-argument", "Invalid SAML SSO URL.")
    }
    if (!isValidPemCertificate(certificate)) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid SAML certificate. Must be PEM format."
      )
    }

    const projectId = admin.app().options.projectId
    const samlConfig = {
      providerId,
      displayName: `SSO for team ${teamId}`,
      enabled: true,
      idpEntityId,
      ssoURL: ssoUrl,
      x509Certificates: [certificate],
      rpEntityId: `firebase-${projectId}`,
      callbackURL: `https://${projectId}.firebaseapp.com/__/auth/handler`,
    }

    try {
      await auth.getProviderConfig(providerId)
      await auth.updateProviderConfig(providerId, samlConfig)
    } catch {
      await auth.createProviderConfig(samlConfig)
    }

    ssoDoc = {
      loginMethods: {
        emailPassword: true,
        magicLink: true,
        google: true,
        microsoft: true,
        apple: true,
        sso: true,
      },
      sso: {
        enabled: true,
        protocol: "saml",
        providerId,
        domains,
        enforced,
        autoProvision,
        defaultRole,
        saml: { idpEntityId, ssoUrl, certificate },
      },
      configuredBy: request.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
  } else {
    // OIDC
    const issuer = assertString(request.data?.oidc?.issuer, "oidc.issuer")
    const clientId = assertString(request.data?.oidc?.clientId, "oidc.clientId")
    const clientSecret = assertString(
      request.data?.oidc?.clientSecret,
      "oidc.clientSecret"
    )

    if (!isValidUrl(issuer)) {
      throw new HttpsError("invalid-argument", "Invalid OIDC issuer URL.")
    }

    const oidcConfig = {
      providerId,
      displayName: `SSO for team ${teamId}`,
      enabled: true,
      issuer,
      clientId,
      clientSecret,
      responseType: { idToken: true },
    }

    try {
      await auth.getProviderConfig(providerId)
      await auth.updateProviderConfig(providerId, oidcConfig)
    } catch {
      await auth.createProviderConfig(oidcConfig)
    }

    ssoDoc = {
      loginMethods: {
        emailPassword: true,
        magicLink: true,
        google: true,
        microsoft: true,
        apple: true,
        sso: true,
      },
      sso: {
        enabled: true,
        protocol: "oidc",
        providerId,
        domains,
        enforced,
        autoProvision,
        defaultRole,
        oidc: { issuer, clientId },
      },
      configuredBy: request.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
  }

  // Atomic transaction: domain conflict check + security doc + domain index writes
  await db.runTransaction(async (transaction) => {
    // Read security doc first (for stale domain cleanup)
    const existingSecuritySnap = await transaction.get(
      db.doc(`teams/${teamId}/settings/security`)
    )
    const previousDomains: string[] =
      existingSecuritySnap.data()?.sso?.domains ?? []

    // Batch-read all domain docs in one round-trip
    const domainRefs = domains.map((d) => db.doc(`sso-domains/${d}`))
    const domainSnaps = await transaction.getAll(...domainRefs)

    // Check domain conflicts inside the transaction
    for (let i = 0; i < domainSnaps.length; i++) {
      const snap = domainSnaps[i]
      if (snap.exists && snap.data()?.teamId !== teamId) {
        throw new HttpsError(
          "already-exists",
          `Domain "${domains[i]}" is already claimed by another team.`
        )
      }
    }

    // Write security doc
    transaction.set(db.doc(`teams/${teamId}/settings/security`), ssoDoc, {
      merge: true,
    })

    // Write domain index documents
    for (const domain of domains) {
      transaction.set(db.doc(`sso-domains/${domain}`), {
        teamId,
        providerId,
        enforced,
      })
    }

    // Remove stale domain index docs (domains previously assigned but now removed)
    const removedDomains = previousDomains.filter((d) => !domains.includes(d))
    for (const domain of removedDomains) {
      transaction.delete(db.doc(`sso-domains/${domain}`))
    }
  })

  // Audit log
  await logEvent({
    teamId,
    actor,
    action: "sso.configured",
    resource: { type: "security", id: teamId },
    context: buildContext(request),
    changes: {
      after: { protocol, domains, enforced, autoProvision, defaultRole },
      fields: [
        "protocol",
        "domains",
        "enforced",
        "autoProvision",
        "defaultRole",
      ],
    },
  })

  return { success: true, providerId }
})

// ============================================================================
// deleteSso
// ============================================================================

export const deleteSso = onCall({ ...CALLABLE_OPTS }, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const { actor } = await requireTeamAdmin(teamId, request.auth.uid)

  const securitySnap = await db.doc(`teams/${teamId}/settings/security`).get()
  if (!securitySnap.exists) {
    throw new HttpsError("not-found", "No SSO configuration found.")
  }

  const ssoConfig = securitySnap.data()?.sso
  if (!ssoConfig?.providerId) {
    throw new HttpsError("not-found", "No SSO provider configured.")
  }

  // Delete Firebase Auth provider
  try {
    await auth.deleteProviderConfig(ssoConfig.providerId)
  } catch (error) {
    logger.warn(
      `Failed to delete provider config ${ssoConfig.providerId}:`,
      error
    )
  }

  // Delete domain index docs and clear SSO config
  const batch = db.batch()
  const domains: string[] = ssoConfig.domains ?? []
  for (const domain of domains) {
    batch.delete(db.doc(`sso-domains/${domain}`))
  }

  batch.update(db.doc(`teams/${teamId}/settings/security`), {
    "sso.enabled": false,
    "sso.providerId": "",
    "sso.domains": [],
    "sso.enforced": false,
    "sso.autoProvision": false,
    "sso.saml": admin.firestore.FieldValue.delete(),
    "sso.oidc": admin.firestore.FieldValue.delete(),
    "loginMethods.sso": false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await batch.commit()

  await logEvent({
    teamId,
    actor,
    action: "sso.deleted",
    resource: { type: "security", id: teamId },
    context: buildContext(request),
  })

  return { success: true }
})

// ============================================================================
// testSsoConnection
// ============================================================================

export const testSsoConnection = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    await requireTeamAdmin(teamId, request.auth.uid)

    const protocol = assertString(request.data?.protocol, "protocol")

    if (protocol === "saml") {
      const certificate = assertString(
        request.data?.saml?.certificate,
        "saml.certificate"
      )
      const ssoUrl = assertString(request.data?.saml?.ssoUrl, "saml.ssoUrl")

      if (!isValidPemCertificate(certificate)) {
        return {
          valid: false,
          error:
            "Invalid certificate format. Must be a PEM-encoded X.509 certificate.",
        }
      }
      if (!isValidUrl(ssoUrl)) {
        return { valid: false, error: "Invalid SSO URL." }
      }

      return { valid: true }
    }

    if (protocol === "oidc") {
      const issuer = assertString(request.data?.oidc?.issuer, "oidc.issuer")

      if (!isValidUrl(issuer)) {
        return { valid: false, error: "Invalid issuer URL." }
      }

      // Try to fetch the OIDC discovery document (with timeout)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)
      try {
        const wellKnownUrl =
          issuer.replace(/\/$/, "") + "/.well-known/openid-configuration"
        const response = await fetch(wellKnownUrl, {
          signal: controller.signal,
        })
        if (!response.ok) {
          return {
            valid: false,
            error: `OIDC discovery failed: HTTP ${response.status}`,
          }
        }
        const data = (await response.json()) as Record<string, unknown>
        if (!data.issuer || !data.authorization_endpoint || !data.jwks_uri) {
          return {
            valid: false,
            error:
              "OIDC discovery document is missing required fields (issuer, authorization_endpoint, jwks_uri).",
          }
        }
        return { valid: true }
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? "OIDC issuer did not respond within 10 seconds."
            : `Could not reach OIDC issuer: ${
                error instanceof Error ? error.message : "unknown error"
              }`
        return { valid: false, error: message }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    return { valid: false, error: "Invalid protocol." }
  }
)

// ============================================================================
// resolveSsoProvider
// ============================================================================

/**
 * Resolve an email domain to its SSO provider (unauthenticated).
 *
 * Security note: This function is intentionally unauthenticated because it
 * runs before the user has signed in. An attacker could enumerate which email
 * domains have SSO configured, but this only reveals that a domain uses SSO —
 * not whether specific users exist. The maxInstances cap (20) provides
 * natural rate limiting. If domain enumeration becomes a concern, consider
 * adding a rate-limit check by IP (e.g., via a Firestore counter or Cloud
 * Armor policy).
 */
export const resolveSsoProvider = onCall(
  {
    ...CALLABLE_OPTS,
    maxInstances: 20,
  },
  async (request) => {
    const email = request.data?.email
    if (!email || typeof email !== "string") {
      return { sso: false }
    }

    const parts = email.trim().toLowerCase().split("@")
    if (parts.length !== 2) {
      return { sso: false }
    }

    const domain = parts[1]
    const domainSnap = await db.doc(`sso-domains/${domain}`).get()

    if (!domainSnap.exists) {
      return { sso: false }
    }

    const data = domainSnap.data()
    if (!data?.providerId || !data?.teamId) {
      return { sso: false }
    }

    // Two reads are intentional: the domain doc is a fast-lookup index, but we
    // verify against the canonical security config to ensure SSO hasn't been
    // disabled since the domain doc was written.
    const securitySnap = await db
      .doc(`teams/${data.teamId}/settings/security`)
      .get()
    const ssoConfig = securitySnap.data()?.sso
    if (!ssoConfig?.enabled) {
      return { sso: false }
    }

    return {
      sso: true,
      providerId: data.providerId,
      enforced: Boolean(data.enforced),
    }
  }
)

// ============================================================================
// updateTeamLoginMethods
// ============================================================================

export const updateTeamLoginMethods = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const { actor } = await requireTeamAdmin(teamId, request.auth.uid)
    await requireEnterprisePlan(teamId)

    const methods = request.data?.loginMethods
    if (!methods || typeof methods !== "object") {
      throw new HttpsError(
        "invalid-argument",
        "loginMethods must be an object."
      )
    }

    const loginMethods: Record<string, boolean> = {
      emailPassword: Boolean(methods.emailPassword),
      magicLink: Boolean(methods.magicLink),
      google: Boolean(methods.google),
      microsoft: Boolean(methods.microsoft),
      apple: Boolean(methods.apple),
      sso: Boolean(methods.sso),
    }

    // At least one non-SSO login method must remain enabled.
    // SSO alone is insufficient because it only covers users whose email domain
    // is configured — all other users (new invitees, personal emails, admins
    // outside the SSO domain) would be permanently locked out.
    const nonSsoMethods = [
      loginMethods.emailPassword,
      loginMethods.magicLink,
      loginMethods.google,
      loginMethods.microsoft,
      loginMethods.apple,
    ]
    if (!nonSsoMethods.some(Boolean)) {
      throw new HttpsError(
        "invalid-argument",
        "At least one non-SSO login method must remain enabled to prevent orphaned access."
      )
    }

    await db.doc(`teams/${teamId}/settings/security`).set(
      {
        loginMethods,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    await logEvent({
      teamId,
      actor,
      action: "security.login_methods.updated",
      resource: { type: "security", id: teamId },
      context: buildContext(request),
      changes: { after: loginMethods, fields: Object.keys(loginMethods) },
    })

    return { success: true }
  }
)

// ============================================================================
// updateTeamApprovedDomains
// ============================================================================

export const updateTeamApprovedDomains = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const { actor } = await requireTeamAdmin(teamId, request.auth.uid)
    await requireEnterprisePlan(teamId)

    const rawDomains = request.data?.approvedDomains
    if (!Array.isArray(rawDomains)) {
      throw new HttpsError(
        "invalid-argument",
        "approvedDomains must be an array."
      )
    }

    // Normalize and validate domains (empty array is valid — removes all)
    const approvedDomains: string[] = rawDomains
      .map((d: unknown) =>
        typeof d === "string" ? d.trim().toLowerCase() : ""
      )
      .filter(Boolean)

    for (const domain of approvedDomains) {
      if (!isValidDomain(domain)) {
        throw new HttpsError("invalid-argument", `Invalid domain: ${domain}`)
      }
    }

    await db.doc(`teams/${teamId}/settings/security`).set(
      {
        approvedDomains,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    await logEvent({
      teamId,
      actor,
      action: "security.approved_domains.updated",
      resource: { type: "security", id: teamId },
      context: buildContext(request),
      changes: { after: { approvedDomains }, fields: ["approvedDomains"] },
    })

    return { success: true }
  }
)
