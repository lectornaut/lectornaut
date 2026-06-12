import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore"
import { FieldValue } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import * as logger from "firebase-functions/logger"
import { type SecretParam } from "firebase-functions/params"
import {
  CallableRequest,
  HttpsError,
  onCall,
  type CallableOptions,
} from "firebase-functions/v2/https"
import Stripe from "stripe"
import { z, type ZodType } from "zod"
import { assertAuthenticated, type AuthData } from "./auth.js"
import { authorize, requireAuthorized } from "./authorize.js"
import { BUILT_IN_AGENTS_BY_ID, isBuiltInAgentId } from "./builtInAgents.js"
import { COST_BUDGET } from "./costBudget.js"
import { defineCallable } from "./defineCallable.js"
import { db } from "./firebase.js"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  botSessionAttachmentsCollectionPath,
  isBotSessionAttachmentStoragePath,
  isWorkspaceNodeAttachmentStoragePath,
  normalizeAttachmentDisplayName,
  workspaceNodeAttachmentsCollectionPath,
} from "./nodeAttachments.js"
import { can, effectiveRole, type Capability } from "./permissions.js"
import { CALLABLE_OPTS, DESTRUCTIVE_CALLABLE_OPTS } from "./runtimeConfig.js"
import { stripeSecretKey } from "./secrets.js"
import {
  Actor,
  Capabilities,
  Changes,
  Context,
  IMembershipRole,
  InvitationData,
  isMembershipRole,
  LogEntry,
  LogEventParams,
  NodeType,
  WorkspaceNodeScope,
} from "./types.js"
// Call-time-only use (post-removal cascade) — the module cycle
// audit → connections → bot → botNodeTools → audit is init-safe, same class
// as the existing authGuards ↔ bot edge.
import { cleanupMemberConnectionBindings } from "./connections.js"
import { removeMemberFromWorkspaces } from "./workspaceMembership.js"

// =============================================================================
// Audit Log Types
// =============================================================================

// =============================================================================
// Audit Log Utilities
// =============================================================================

function mapAuthType(provider?: string): Context["authType"] | undefined {
  if (!provider) return undefined
  if (provider === "password") return "password"
  if (provider === "custom") return "api"
  return "sso"
}

/**
 * Derive the request-context slice of a log entry (IP / user-agent / auth
 * type) from the callable request. Exported for callables that wire
 * `logEvent` by hand outside this module (e.g. the connection lifecycle in
 * connections.ts).
 */
export function buildContext(request: CallableRequest): Context | undefined {
  const raw = request.rawRequest
  const ip =
    (raw?.headers?.["x-forwarded-for"] as string | undefined) ??
    raw?.ip ??
    undefined
  const userAgent = raw?.headers?.["user-agent"] as string | undefined
  const authType = mapAuthType(request.auth?.token?.firebase?.sign_in_provider)

  const context: Context = {}
  if (ip) context.ip = ip
  if (userAgent) context.userAgent = userAgent
  if (authType) context.authType = authType

  return Object.keys(context).length > 0 ? context : undefined
}

function normalizeActor(actor: Actor): Actor {
  // `userId` is optional (a headless Workflows run has no driving human — only
  // an agent identity). Add it conditionally like every other field: leaking
  // `userId: undefined` into the Firestore write throws "Cannot use 'undefined'
  // as a Firestore value" (the SDK has no `ignoreUndefinedProperties`), and
  // because `logEvent` shares the caller's transaction that abort silently
  // rolls back the node mutation it was auditing — an agent edit that vanishes.
  const normalized: Actor = {}
  if (actor.userId) normalized.userId = actor.userId
  if (actor.email) normalized.email = actor.email
  if (actor.role) normalized.role = actor.role
  if (actor.agentId) normalized.agentId = actor.agentId
  if (actor.agentName) normalized.agentName = actor.agentName
  return normalized
}

function normalizeChanges(changes?: Changes): Changes | undefined {
  if (!changes) return undefined
  const normalized: Changes = {}

  if (changes.before && Object.keys(changes.before).length > 0) {
    normalized.before = changes.before
  }
  if (changes.after && Object.keys(changes.after).length > 0) {
    normalized.after = changes.after
  }
  if (changes.fields && changes.fields.length > 0) {
    normalized.fields = changes.fields
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function buildChanges(
  before: Record<string, unknown>,
  updates: Record<string, unknown>
): Changes | undefined {
  const fields: string[] = []
  const beforeValues: Record<string, unknown> = {}
  const afterValues: Record<string, unknown> = {}

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) return
    const beforeValue = before[key]
    if (Object.is(beforeValue, value)) return
    fields.push(key)
    beforeValues[key] = beforeValue ?? null
    afterValues[key] = value
  })

  if (fields.length === 0) return undefined

  return {
    fields,
    before: beforeValues,
    after: afterValues,
  }
}

export async function logEvent(
  params: LogEventParams,
  options?: { transaction?: Transaction }
): Promise<DocumentReference> {
  const logRef = db.collection("logs").doc()
  const entry: LogEntry = {
    id: logRef.id,
    timestamp: FieldValue.serverTimestamp(),
    teamId: params.teamId,
    actor: normalizeActor(params.actor),
    action: params.action,
    resource: params.resource,
  }

  if (params.workspaceId) entry.workspaceId = params.workspaceId
  if (params.context) entry.context = params.context

  const normalizedChanges = normalizeChanges(params.changes)
  if (normalizedChanges) entry.changes = normalizedChanges

  if (options?.transaction) {
    options.transaction.set(logRef, entry)
    return logRef
  }

  await logRef.set(entry)
  return logRef
}

/**
 * Run a content mutation inside a Firestore transaction and emit its audit log
 * entry atomically within the SAME transaction. The body returns the caller's
 * `result` plus the `audit` params to log — or `audit: null` to skip the log (a
 * no-op mutation with no changes). Returns the result and the generated log id
 * (absent when nothing was logged).
 *
 * Owns the "open transaction → run body → log iff changed" shape that every
 * single-transaction audited mutation repeated by hand. Mutations with
 * out-of-band side effects (attachment storage I/O) or a batched subtree purge
 * compose `authorize` + `logEvent` directly instead, since they cannot live
 * inside a single transaction.
 */
export async function runAuditedTransaction<T>(
  body: (
    transaction: Transaction
  ) => Promise<{ result: T; audit: LogEventParams | null }>
): Promise<{ result: T; logId?: string }> {
  return db.runTransaction(async (transaction) => {
    const { result, audit } = await body(transaction)
    if (!audit) return { result }
    const logRef = await logEvent(audit, { transaction })
    return { result, logId: logRef.id }
  })
}

// ===========================================================================
// defineMutation — the audited-transaction variant of defineCallable
// ===========================================================================

/**
 * The body-computed half of the audit entry; `defineMutation` supplies the rest.
 * `workspaceId` is optional here so a create-with-generated-id mutation can audit
 * against an id that didn't exist at parse time (else it defaults to the
 * `context` scope's workspaceId).
 */
type MutationAuditBits = Pick<
  LogEventParams,
  "resource" | "changes" | "workspaceId"
>

/** Typed context handed to a {@link defineMutation} handler. */
interface MutationCtx<In> {
  /** The raw Firebase request — for the rare handler that needs rawRequest/app. */
  request: CallableRequest<In>
  /** The authenticated caller (non-null: mutations are `"required"` or `"verified"`). */
  auth: AuthData
  /** `request.data` parsed through `spec.input` (or the raw data when no schema). */
  input: In
  /** The mutation's open transaction — do all reads/writes through it. */
  tx: Transaction
  /** `auth.uid` — the audit actor + the `createdBy`/`updatedBy` stamp. */
  actorId: string
  /** `auth.token.email`, if present. */
  actorEmail: string | undefined
  /** The role `authorize` resolved for the actor (undefined without a `capability` slot). */
  teamRole: IMembershipRole | undefined
}

interface MutationSpec<In, Out, M extends "required" | "verified"> {
  name: string
  /** Auth policy. Default `"required"` (the legacy `assertAuthenticated` gate). */
  auth?: M
  appCheck?: boolean
  input?: ZodType<In>
  opts?: CallableOptions<In>
  secrets?: SecretParam[]
  /** When set, gate the mutation on this capability via `authorize` + `requireAuthorized`. */
  capability?: Capability
  /** Derive the authorize scope AND the audit log's teamId/workspaceId from the parsed input. */
  context: (input: In) => { teamId: string; workspaceId?: string }
  /** Per-callable deny message for the `insufficient-capability` case. */
  denyMessage?: string
  /** The audit action (static per callable). */
  action: LogEventParams["action"]
  /**
   * Domain logic. Read/write via `ctx.tx`; return the client `result` plus the
   * audit's `resource` + `changes` (or `audit: null` to skip the log for a no-op).
   */
  handler: (
    ctx: MutationCtx<In>
  ) => Promise<{ result: Out; audit: MutationAuditBits | null }>
}

/**
 * The audited-transaction-composing variant of {@link defineCallable}.
 *
 * A content mutation's outer ring is identical every time: assert auth, derive
 * the actor, open a transaction, `authorize()` inside it, do the write, emit a
 * `logEvent` in the SAME transaction, and return `{ ...result, logId }`. This
 * seam owns all of that DECLARATIVELY and composes the existing inner seams —
 * {@link authorize} / {@link requireAuthorized} and {@link runAuditedTransaction}
 * — rather than re-implementing them. Both stay transaction-scoped: `authorize`
 * reads through the mutation's transaction, and `logEvent` writes inside it.
 *
 * The handler is left with ONLY the domain work: read/write via `ctx.tx`,
 * compute the `changes`, and return the result + the audit's `resource`/`changes`.
 * `defineMutation` fills the audit's `teamId`/`workspaceId` (from `context`),
 * `actor` (the caller + the role `authorize` resolved), `action` (the static
 * slot), and request `context` (IP / UA), then appends the generated `logId`.
 */
export function defineMutation<
  In = unknown,
  Out = unknown,
  M extends "required" | "verified" = "required",
>(spec: MutationSpec<In, Out, M>) {
  return defineCallable<In, Out & { logId?: string }, M>({
    name: spec.name,
    auth: spec.auth,
    appCheck: spec.appCheck,
    input: spec.input,
    opts: spec.opts,
    secrets: spec.secrets,
    handler: async ({ request, auth, input }) => {
      const actorId = auth.uid
      const actorEmail = auth.token.email ?? undefined
      const scope = spec.context(input)

      const { result, logId } = await runAuditedTransaction<Out>(async (tx) => {
        let teamRole: IMembershipRole | undefined
        if (spec.capability) {
          teamRole =
            requireAuthorized(
              await authorize(actorId, spec.capability, {
                teamId: scope.teamId,
                workspaceId: scope.workspaceId,
                transaction: tx,
              }),
              spec.denyMessage
            ).teamRole ?? undefined
        }

        const out = await spec.handler({
          request,
          auth,
          input,
          tx,
          actorId,
          actorEmail,
          teamRole,
        })

        if (!out.audit) return { result: out.result, audit: null }

        const workspaceId = out.audit.workspaceId ?? scope.workspaceId
        const audit: LogEventParams = {
          teamId: scope.teamId,
          ...(workspaceId ? { workspaceId } : {}),
          actor: { userId: actorId, email: actorEmail, role: teamRole },
          action: spec.action,
          resource: out.audit.resource,
          context: buildContext(request),
          ...(out.audit.changes ? { changes: out.audit.changes } : {}),
        }
        return { result: out.result, audit }
      })

      return { ...result, logId }
    },
  })
}

async function requireTeamRole(
  transaction: Transaction,
  teamId: string,
  userId: string
): Promise<IMembershipRole> {
  const membershipRef = db.doc(`teams/${teamId}/memberships/${userId}`)
  const membershipSnap = await transaction.get(membershipRef)

  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "User is not a team member.")
  }

  const role = membershipSnap.data()?.role as IMembershipRole | undefined
  if (!role) {
    throw new HttpsError(
      "permission-denied",
      "Team membership role is missing."
    )
  }

  return role
}

async function getTeamRole(
  teamId: string,
  userId: string
): Promise<IMembershipRole> {
  const membershipRef = db.doc(`teams/${teamId}/memberships/${userId}`)
  const membershipSnap = await membershipRef.get()

  if (!membershipSnap.exists) {
    throw new HttpsError("permission-denied", "User is not a team member.")
  }

  const role = membershipSnap.data()?.role as IMembershipRole | undefined
  if (!role) {
    throw new HttpsError(
      "permission-denied",
      "Team membership role is missing."
    )
  }

  return role
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

function assertMembershipRole(value: unknown, field: string): IMembershipRole {
  const role = assertString(value, field)
  if (!isMembershipRole(role)) {
    throw new HttpsError("invalid-argument", "Invalid role provided.")
  }
  return role
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null
  const normalized = email.trim().toLowerCase()
  return normalized ? normalized : null
}

type TeamStripeBillingRefs = {
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripeScheduleId: string | null
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete_expired",
])

let stripeClient: Stripe | null = null

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const secret = stripeSecretKey.value()
    if (!secret) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe secret key is not configured."
      )
    }
    stripeClient = new Stripe(secret)
  }
  return stripeClient
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getTeamStripeBillingRefs(
  teamData: Record<string, unknown>
): TeamStripeBillingRefs {
  const billingRaw = teamData.billing
  const billing =
    billingRaw && typeof billingRaw === "object"
      ? (billingRaw as Record<string, unknown>)
      : {}

  return {
    stripeCustomerId: toOptionalString(billing.stripeCustomerId),
    stripeSubscriptionId: toOptionalString(billing.stripeSubscriptionId),
    stripeScheduleId: toOptionalString(billing.stripeScheduleId),
  }
}

function normalizeScheduleId(
  schedule: string | Stripe.SubscriptionSchedule | null | undefined
): string | null {
  if (!schedule) return null
  return typeof schedule === "string" ? schedule : schedule.id
}

function selectSubscriptionCandidate(
  subscriptions: Stripe.Subscription[]
): Stripe.Subscription | null {
  const candidates = subscriptions
    .filter(
      (subscription) => !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)
    )
    .sort((left, right) => {
      const leftPeriodEnd = left.items.data[0]?.current_period_end ?? 0
      const rightPeriodEnd = right.items.data[0]?.current_period_end ?? 0
      return rightPeriodEnd - leftPeriodEnd
    })

  return candidates[0] ?? null
}

function isStripeResourceMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code
  return code === "resource_missing"
}

async function resolveTeamSubscriptionForDeletion(
  stripe: Stripe,
  refs: TeamStripeBillingRefs
): Promise<Stripe.Subscription | null> {
  const preferredSubscriptionId = refs.stripeSubscriptionId

  if (preferredSubscriptionId) {
    try {
      return await stripe.subscriptions.retrieve(preferredSubscriptionId)
    } catch (error) {
      if (!isStripeResourceMissingError(error)) {
        throw error
      }
      logger.warn("Stripe subscription referenced by team was not found", {
        subscriptionId: preferredSubscriptionId,
      })
    }
  }

  if (!refs.stripeCustomerId) {
    return null
  }

  const listed = await stripe.subscriptions.list({
    customer: refs.stripeCustomerId,
    status: "all",
    limit: 20,
  })
  return selectSubscriptionCandidate(listed.data)
}

async function cleanupTeamBillingBeforeDelete(
  teamId: string,
  teamData: Record<string, unknown>
): Promise<void> {
  const refs = getTeamStripeBillingRefs(teamData)
  if (
    !refs.stripeSubscriptionId &&
    !refs.stripeCustomerId &&
    !refs.stripeScheduleId
  ) {
    return
  }

  const stripe = getStripeClient()
  const subscription = await resolveTeamSubscriptionForDeletion(stripe, refs)
  const scheduleId =
    refs.stripeScheduleId ?? normalizeScheduleId(subscription?.schedule)

  if (scheduleId) {
    try {
      await stripe.subscriptionSchedules.release(scheduleId, {})
      logger.info(
        "Released Stripe subscription schedule before team deletion",
        {
          teamId,
          scheduleId,
        }
      )
    } catch (error) {
      if (!isStripeResourceMissingError(error)) {
        throw error
      }
      logger.warn("Stripe schedule referenced by team was not found", {
        teamId,
        scheduleId,
      })
    }
  }

  if (
    subscription &&
    !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)
  ) {
    await stripe.subscriptions.cancel(subscription.id)
    logger.info("Cancelled Stripe subscription before team deletion", {
      teamId,
      subscriptionId: subscription.id,
      status: subscription.status,
    })
  }
}

const PUBLIC_USERNAME_MIN_LENGTH = 3
const PUBLIC_USERNAME_MAX_LENGTH = 30
const PUBLIC_USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const RESERVED_PUBLIC_USERNAMES = new Set([
  "home",
  "login",
  "logout",
  "signin",
  "signout",
  "signup",
  "register",
  "enter",
  "exit",
  "profile",
  "settings",
  "account",
  "dashboard",
  "admin",
  "administrator",
  "editor",
  "api",
  "app",
  "about",
  "help",
  "support",
  "contact",
  "pricing",
  "billing",
  "subscription",
  "subscriptions",
  "explore",
  "search",
  "discover",
  "browse",
  "feed",
  "notifications",
  "messages",
  "inbox",
  "chat",
  "teams",
  "team",
  "org",
  "organization",
  "organizations",
  "create",
  "new",
  "edit",
  "delete",
  "remove",
  "update",
  "manage",
  "agents",
  "agent",
  "runs",
  "run",
  "tasks",
  "task",
  "flows",
  "flow",
  "changelog",
  "blog",
  "docs",
  "documentation",
  "legal",
  "terms",
  "privacy",
  "security",
  "cookies",
  "welcome",
  "start",
  "write",
  "test",
  "system",
  "root",
  "null",
  "undefined",
  "anonymous",
  "guest",
  "user",
  "users",
  "member",
  "members",
  "viewer",
  "moderator",
  "mod",
  "staff",
  "owner",
  "bot",
  "bots",
  "official",
  "verified",
  "lectornaut",
  "lector",
  "naut",
  "www",
  "mail",
  "email",
  "ftp",
  "ssl",
  "ssh",
  "cdn",
  "assets",
  "static",
  "public",
  "private",
  "internal",
  "external",
])

const getUserPreferencesRef = (userId: string) =>
  db.doc(`users/${userId}/settings/preferences`)

function readSelectedTeamId(
  snapshot: DocumentSnapshot
): string | null | undefined {
  if (!snapshot.exists) return undefined

  const currentTeamId = snapshot.data()?.currentTeamId
  if (currentTeamId === null) return null
  return typeof currentTeamId === "string" ? currentTeamId : undefined
}

async function getSelectedTeamId(
  transaction: Transaction,
  userId: string
): Promise<string | null> {
  const preferencesSnap = await transaction.get(getUserPreferencesRef(userId))
  return readSelectedTeamId(preferencesSnap) ?? null
}

async function getSelectedTeamIdDirect(userId: string): Promise<string | null> {
  const preferencesSnap = await getUserPreferencesRef(userId).get()
  return readSelectedTeamId(preferencesSnap) ?? null
}

function isTeamUsernameClaim(
  data: FirebaseFirestore.DocumentData | undefined,
  teamId: string
): boolean {
  return !!data && data.entityType === "team" && data.entityId === teamId
}

function normalizePublicUsername(username: string): string {
  let normalized = username.trim().toLowerCase()
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1)
  }
  return normalized
}

function assertPublicUsername(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a valid username.`
    )
  }

  const normalized = normalizePublicUsername(value)

  if (
    normalized.length < PUBLIC_USERNAME_MIN_LENGTH ||
    normalized.length > PUBLIC_USERNAME_MAX_LENGTH
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be between ${PUBLIC_USERNAME_MIN_LENGTH} and ${PUBLIC_USERNAME_MAX_LENGTH} characters.`
    )
  }

  if (!PUBLIC_USERNAME_REGEX.test(normalized)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} can only contain letters, numbers, underscores, and hyphens.`
    )
  }

  if (/[-_]{2,}/.test(normalized)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} cannot have consecutive underscores or hyphens.`
    )
  }

  if (/[-_]$/.test(normalized)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} cannot end with an underscore or hyphen.`
    )
  }

  if (RESERVED_PUBLIC_USERNAMES.has(normalized)) {
    throw new HttpsError("invalid-argument", `${field} is reserved.`)
  }

  return normalized
}

function parseOptionalPublicUsername(
  value: unknown,
  field: string
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a string, null, or undefined.`
    )
  }

  if (!value.trim()) {
    return null
  }

  return assertPublicUsername(value, field)
}

function parseOptionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", `${field} must be a boolean.`)
  }
  return value
}

const ROOT_PARENT_ID = "root"
const NODE_NAME_MAX_LENGTH = 128

function normalizeNodeName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

function toNameLower(name: string): string {
  return normalizeNodeName(name).toLowerCase()
}

function getTypeOrder(type: NodeType): number {
  return type === "folder" ? 0 : 1
}

function assertWorkspaceNodeScope(value: unknown): WorkspaceNodeScope {
  if (value !== "code" && value !== "write") {
    throw new HttpsError(
      "invalid-argument",
      "scope must be either code or write."
    )
  }
  return value
}

function workspaceNodesCollectionPath(
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope
): string {
  return `teams/${teamId}/workspaces/${workspaceId}/${scope}`
}

function workspaceNodeAttachmentDocumentPath(
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope,
  nodeId: string,
  attachmentId: string
): string {
  return `${workspaceNodeAttachmentsCollectionPath(teamId, workspaceId, scope, nodeId)}/${attachmentId}`
}

function assertAttachmentDisplayName(value: unknown, field: string): string {
  const normalized = normalizeAttachmentDisplayName(assertString(value, field))
  if (!normalized.length || normalized.length > ATTACHMENT_NAME_MAX_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be between 1 and ${ATTACHMENT_NAME_MAX_LENGTH} characters.`
    )
  }
  return normalized
}

function assertAttachmentStoragePath(
  value: unknown,
  params: {
    teamId: string
    workspaceId: string
    scope: WorkspaceNodeScope
    nodeId: string
    attachmentId: string
  }
): string {
  const storagePath = assertString(value, "storagePath")
  if (!isWorkspaceNodeAttachmentStoragePath(storagePath, params)) {
    throw new HttpsError(
      "invalid-argument",
      "storagePath does not match the expected attachment location."
    )
  }
  return storagePath
}

async function readStorageObjectMetadata(storagePath: string): Promise<{
  mimeType: string | null
  size: number | null
}> {
  const file = getStorage().bucket().file(storagePath)
  const [exists] = await file.exists()
  if (!exists) {
    throw new HttpsError(
      "failed-precondition",
      "Uploaded attachment file was not found in storage."
    )
  }

  const [metadata] = await file.getMetadata()
  const size =
    typeof metadata.size === "string" && metadata.size.length > 0
      ? Number.parseInt(metadata.size, 10)
      : null

  return {
    mimeType: metadata.contentType ?? null,
    size: Number.isFinite(size) ? size : null,
  }
}

export async function deleteStorageObjectIfExists(
  storagePath: string | null | undefined
): Promise<void> {
  if (!storagePath) return

  try {
    await getStorage().bucket().file(storagePath).delete({
      ignoreNotFound: true,
    })
  } catch (error) {
    logger.warn("Failed to delete storage object", {
      storagePath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Best-effort recursive Storage cleanup by prefix — deletes every object under
 * `prefix`. Used when a whole team/workspace is deleted (`recursiveDelete` only
 * covers Firestore, not Cloud Storage). ALWAYS pass a trailing slash so the
 * prefix can't bleed into a sibling id (`teams/abc/` must not match
 * `teams/abcd/`). Never throws — the entity is already gone, so any leftover
 * object is harmless dead data (logged), not a reason to fail the deletion.
 */
export async function deleteStoragePrefix(
  prefix: string | null | undefined
): Promise<void> {
  if (!prefix) return

  try {
    await getStorage().bucket().deleteFiles({ prefix, force: true })
  } catch (error) {
    logger.warn("Failed to delete storage objects under prefix", {
      prefix,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const IN_QUERY_CHUNK_SIZE = 10
const DELETE_BATCH_SIZE = 450

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]

  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function collectNodeAttachmentDeletes(
  nodesCollection: CollectionReference,
  nodeIds: string[]
): Promise<{
  refs: DocumentReference[]
  storagePaths: string[]
}> {
  const refs: DocumentReference[] = []
  const storagePaths = new Set<string>()

  for (const batchIds of chunkArray(nodeIds, IN_QUERY_CHUNK_SIZE)) {
    const attachmentSnaps = await Promise.all(
      batchIds.map((id) =>
        nodesCollection.doc(id).collection("attachments").get()
      )
    )

    attachmentSnaps.forEach((attachmentsSnap) => {
      attachmentsSnap.docs.forEach((attachmentSnap) => {
        refs.push(attachmentSnap.ref)

        const storagePath = attachmentSnap.data()?.storagePath
        if (typeof storagePath === "string" && storagePath.length > 0) {
          storagePaths.add(storagePath)
        }
      })
    })
  }

  return {
    refs,
    storagePaths: [...storagePaths],
  }
}

// =============================================================================
// Team CRUD Operations
// =============================================================================

export const createTeam = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const name = assertString(request.data?.name, "name")
  const photoURL =
    typeof request.data?.photoURL === "string"
      ? request.data.photoURL.trim() || null
      : null

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const teamRef = db.collection("teams").doc()
  const now = FieldValue.serverTimestamp()

  const teamData = {
    id: teamRef.id,
    name,
    photoURL,
    username: null,
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  }

  // Create owner membership
  const membershipRef = db.doc(`teams/${teamRef.id}/memberships/${actorId}`)
  const userRef = db.doc(`users/${actorId}`)

  await db.runTransaction(async (transaction) => {
    // Get user data for membership
    const userSnap = await transaction.get(userRef)
    const userData = userSnap.exists
      ? userSnap.data()
      : {
          uid: actorId,
          email: actorEmail,
          displayName: request.auth.token.name ?? null,
          photoURL: request.auth.token.picture ?? null,
        }

    const membershipData = {
      userId: actorId,
      teamId: teamRef.id,
      role: "owner" as IMembershipRole,
      user: userData,
      team: teamData,
      createdAt: now,
      updatedAt: now,
    }

    transaction.set(teamRef, teamData)
    transaction.set(membershipRef, membershipData)

    // Store the current team as user-scoped preference state.
    transaction.set(
      getUserPreferencesRef(actorId),
      {
        currentTeamId: teamRef.id,
        updatedAt: now,
      },
      { merge: true }
    )

    // Log the event
    await logEvent(
      {
        teamId: teamRef.id,
        actor: { userId: actorId, email: actorEmail, role: "owner" },
        action: "team.create",
        resource: { type: "team", id: teamRef.id },
        context: buildContext(request),
        changes: {
          fields: ["name", "photoURL", "username", "isPublic"],
          after: { name, photoURL, username: null, isPublic: false },
        },
      },
      { transaction }
    )
  })

  return {
    teamId: teamRef.id,
  }
})

export const updateTeam = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const name =
    typeof request.data?.name === "string"
      ? request.data.name.trim()
      : undefined
  const photoURL =
    request.data?.photoURL === null
      ? null
      : typeof request.data?.photoURL === "string"
        ? request.data.photoURL.trim() || null
        : undefined
  const username = parseOptionalPublicUsername(
    request.data?.username,
    "username"
  )
  const isPublic = parseOptionalBoolean(request.data?.isPublic, "isPublic")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.EDIT_TEAM, {
          teamId,
          transaction,
        }),
        "You do not have permission to update this team."
      ).teamRole ?? undefined

    const teamRef = db.doc(`teams/${teamId}`)
    const teamSnap = await transaction.get(teamRef)

    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found.")
    }

    const before = teamSnap.data() ?? {}
    const previousUsername =
      typeof before.username === "string"
        ? normalizePublicUsername(before.username)
        : null
    const previousIsPublic = before.isPublic === true
    const nextUsername = username !== undefined ? username : previousUsername
    let nextIsPublic = isPublic !== undefined ? isPublic : previousIsPublic

    // Keep behavior aligned with public user profiles: clearing handle turns off visibility.
    if (username === null && isPublic === undefined && previousIsPublic) {
      nextIsPublic = false
    }

    if (nextIsPublic && !nextUsername) {
      throw new HttpsError(
        "invalid-argument",
        "Public teams require a username."
      )
    }

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (photoURL !== undefined) updates.photoURL = photoURL
    if (username !== undefined) updates.username = username
    if (isPublic !== undefined || (username === null && previousIsPublic)) {
      updates.isPublic = nextIsPublic
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "At least one field must be provided for update."
      )
    }

    if (username !== undefined && username !== previousUsername) {
      if (username) {
        const usernameRef = db.doc(`usernames/${username}`)
        const usernameSnap = await transaction.get(usernameRef)

        if (usernameSnap.exists) {
          const usernameData = usernameSnap.data() ?? {}
          const isSameTeamOwner = isTeamUsernameClaim(usernameData, teamId)

          if (!isSameTeamOwner) {
            throw new HttpsError("already-exists", "Username already taken.")
          }
        }

        transaction.set(usernameRef, {
          entityType: "team",
          entityId: teamId,
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      if (previousUsername) {
        const oldUsernameRef = db.doc(`usernames/${previousUsername}`)
        const oldUsernameSnap = await transaction.get(oldUsernameRef)
        const oldUsernameData = oldUsernameSnap.data() ?? {}

        if (
          oldUsernameSnap.exists &&
          isTeamUsernameClaim(oldUsernameData, teamId)
        ) {
          transaction.delete(oldUsernameRef)
        }
      }
    }

    const changes = buildChanges(before, updates)

    if (!changes) {
      return { teamId, updated: false }
    }

    transaction.update(teamRef, {
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // COST OPTIMIZATION: Use select() to fetch minimal fields for denormalization.
    // We only need the doc refs to update them — no need to read full membership data.
    const membershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .select()
      .get()
    membershipsSnap.docs.forEach((doc) => {
      transaction.update(doc.ref, {
        "team.name": updates.name ?? before.name,
        "team.photoURL": updates.photoURL ?? before.photoURL,
        "team.username": updates.username ?? before.username ?? null,
        "team.isPublic": updates.isPublic ?? previousIsPublic,
        "team.updatedAt": FieldValue.serverTimestamp(),
      })
    })

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "team.update",
        resource: { type: "team", id: teamId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      teamId,
      updated: true,
      fields: changes.fields ?? [],
      logId: logRef.id,
    }
  })
})

export const deleteTeam = onCall(
  {
    ...DESTRUCTIVE_CALLABLE_OPTS,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined

    // Verify role outside a transaction — the delete runs as a recursive
    // delete, not a transaction.
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.DELETE_TEAM, { teamId }),
        "You do not have permission to delete this team."
      ).teamRole ?? undefined

    // Get team data for logging
    const teamRef = db.doc(`teams/${teamId}`)
    const teamSnap = await teamRef.get()

    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found.")
    }

    const teamData = teamSnap.data() ?? {}
    const teamUsername =
      typeof teamData.username === "string"
        ? normalizePublicUsername(teamData.username)
        : null

    try {
      await cleanupTeamBillingBeforeDelete(
        teamId,
        teamData as Record<string, unknown>
      )
    } catch (error) {
      logger.error("Unable to clean up billing before team deletion", {
        teamId,
        message: error instanceof Error ? error.message : String(error),
      })
      throw new HttpsError(
        "internal",
        "Unable to clean up billing before deleting team."
      )
    }

    // =========================================================================
    // COST FIX: Recursively delete ALL subcollections under the team.
    //
    // Before: only deleted workspace docs and membership docs, leaving orphaned
    // subcollections (code/, write/, workspace-memberships, membership-layouts)
    // consuming storage and index costs indefinitely.
    //
    // After: uses db.recursiveDelete() which traverses and deletes all nested
    // documents in subcollections automatically. This is the recommended
    // approach from Firebase for deep document trees.
    //
    // Document tree under teams/{teamId}:
    //   /memberships/{userId}
    //     /workspaces/{workspaceId}
    //       /layout/{layoutId}              ← was orphaned
    //   /workspaces/{workspaceId}
    //     /code/{nodeId}                    ← was orphaned
    //     /write/{nodeId}                   ← was orphaned
    //     /memberships/{userId}             ← was orphaned
    // =========================================================================

    // Clear the selected team if the deleted team was active for this user.
    const selectedTeamId = await getSelectedTeamIdDirect(actorId)
    if (selectedTeamId === teamId) {
      await getUserPreferencesRef(actorId).set(
        {
          currentTeamId: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }

    // Recursively delete the entire team document tree (all subcollections)
    await db.recursiveDelete(teamRef)

    // Cloud Storage cleanup (recursiveDelete only touches Firestore). One sweep
    // each clears the team's own photo + every workspace and group avatar
    // (images/) and every node/bot attachment (attachments/). Best-effort.
    await Promise.all([
      deleteStoragePrefix(`images/teams/${teamId}/`),
      deleteStoragePrefix(`attachments/teams/${teamId}/`),
    ])

    // Also delete related invitations for this team
    const invitationsSnap = await db
      .collection("invitations")
      .where("teamId", "==", teamId)
      .select()
      .get()

    if (!invitationsSnap.empty) {
      const inviteBatches = chunkArray(invitationsSnap.docs, DELETE_BATCH_SIZE)
      for (const batchDocs of inviteBatches) {
        const batch = db.batch()
        batchDocs.forEach((doc) => batch.delete(doc.ref))
        await batch.commit()
      }
    }

    // Release public username/handle mapping when the team is deleted.
    if (teamUsername) {
      const usernameRef = db.doc(`usernames/${teamUsername}`)
      const usernameSnap = await usernameRef.get()
      const usernameData = usernameSnap.data() ?? {}
      if (usernameSnap.exists && isTeamUsernameClaim(usernameData, teamId)) {
        await usernameRef.delete()
      }
    }

    // Log the event (outside transaction since team is deleted)
    await logEvent({
      teamId,
      actor: { userId: actorId, email: actorEmail, role },
      action: "team.delete",
      resource: { type: "team", id: teamId },
      context: buildContext(request),
      changes: {
        fields: ["name", "photoURL", "username", "isPublic"],
        before: {
          name: teamData.name ?? null,
          photoURL: teamData.photoURL ?? null,
          username: teamData.username ?? null,
          isPublic: teamData.isPublic ?? false,
        },
      },
    })

    return {
      teamId,
      deleted: true,
    }
  }
)

// =============================================================================
// Workspace CRUD Operations
// =============================================================================

// ---------------------------------------------------------------------------
// Shared content-mutation input schemas + scope helpers (workspace + node)
// ---------------------------------------------------------------------------
// Structural fields validate BEFORE `authorize` runs (matching the old
// `assertString` / `assertWorkspaceNodeScope` ordering); `name` reuses
// `normalizeNodeName` so the stored value is identical, and `parentId` keeps the
// lenient "anything non-string/blank → root" fallback the hand-rolled parse had.
const nonEmptyString = z.string().trim().min(1)

const nodeNameSchema = z
  .string()
  .transform((value) => normalizeNodeName(value))
  .refine(
    (value) => value.length >= 1 && value.length <= NODE_NAME_MAX_LENGTH,
    {
      message: `name must be between 1 and ${NODE_NAME_MAX_LENGTH} characters.`,
    }
  )

const parentIdSchema = z
  .unknown()
  .transform((value) =>
    typeof value === "string" && value.trim() ? value.trim() : ROOT_PARENT_ID
  )

const nodeTargetSchema = z.object({
  teamId: nonEmptyString,
  workspaceId: nonEmptyString,
  scope: z.enum(["code", "write"]),
  nodeId: nonEmptyString,
})

/** Every node mutation authorizes + audits on the same (team, workspace). */
const workspaceContentScope = (input: {
  teamId: string
  workspaceId: string
}) => ({ teamId: input.teamId, workspaceId: input.workspaceId })

const MANAGE_CONTENT_DENY =
  "You do not have permission to manage workspace content."

export const createWorkspace = defineMutation({
  name: "createWorkspace",
  input: z.object({
    teamId: nonEmptyString,
    name: nonEmptyString,
    description: z
      .unknown()
      .transform((value) =>
        typeof value === "string" ? value.trim() || null : null
      ),
  }),
  capability: Capabilities.CREATE_WORKSPACE,
  context: (input) => ({ teamId: input.teamId }),
  denyMessage: "You do not have permission to create workspaces.",
  action: "workspace.create",
  handler: async ({ input, tx }) => {
    const { teamId, name, description } = input

    // Seed memberUids = the team's human members (airtight list-level
    // participation; agents excluded). Read in-transaction for consistency.
    const membersSnap = await tx.get(
      db.collection(`teams/${teamId}/memberships`)
    )
    const memberUids = membersSnap.docs
      .filter((memberDoc) => memberDoc.data()?.kind !== "agent")
      .map((memberDoc) => memberDoc.id)

    const workspaceRef = db.collection(`teams/${teamId}/workspaces`).doc()
    const now = FieldValue.serverTimestamp()

    const workspaceData = {
      id: workspaceRef.id,
      teamId,
      name,
      description,
      photoURL: null,
      memberUids,
      createdAt: now,
      updatedAt: now,
    }

    tx.set(workspaceRef, workspaceData)

    return {
      result: { workspaceId: workspaceRef.id },
      audit: {
        workspaceId: workspaceRef.id,
        resource: { type: "workspace", id: workspaceRef.id, parentId: teamId },
        changes: {
          fields: ["name", "description"],
          after: { name, description },
        },
      },
    }
  },
})

export const updateWorkspace = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")

  const name =
    typeof request.data?.name === "string"
      ? request.data.name.trim()
      : undefined
  const description =
    request.data?.description === null
      ? null
      : typeof request.data?.description === "string"
        ? request.data.description.trim() || null
        : undefined
  const photoURL =
    request.data?.photoURL === null
      ? null
      : typeof request.data?.photoURL === "string"
        ? request.data.photoURL.trim() || null
        : undefined

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description
  if (photoURL !== undefined) updates.photoURL = photoURL

  if (Object.keys(updates).length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "At least one field must be provided for update."
    )
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    // EDIT_WORKSPACE is checked at team scope first, then per-workspace
    // (CAPABILITY_SCOPES): a team owner/admin can edit any workspace — and one
    // excluded from the workspace keeps that entity-level right — while a member
    // elevated to admin/owner in THIS workspace can too. `authorize` walks those
    // ordered scopes and short-circuits.
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.EDIT_WORKSPACE, {
          teamId,
          workspaceId,
          transaction,
        }),
        "You do not have permission to update workspaces."
      ).teamRole ?? undefined

    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await transaction.get(workspaceRef)

    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    const before = workspaceSnap.data() ?? {}
    const changes = buildChanges(before, updates)

    if (!changes) {
      return {
        workspaceId,
        updated: false,
      }
    }

    transaction.update(workspaceRef, {
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    })

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role },
        action: "workspace.update",
        resource: { type: "workspace", id: workspaceId, parentId: teamId },
        context: buildContext(request),
        changes,
      },
      { transaction }
    )

    return {
      workspaceId,
      updated: true,
      fields: changes.fields ?? [],
      logId: logRef.id,
    }
  })
})

/**
 * Remove references to a deleted workspace that live OUTSIDE its document
 * subtree, so `recursiveDelete(workspaceRef)` doesn't reach them: each member's
 * per-workspace override at `teams/{t}/memberships/{uid}/workspaces/{wid}`
 * (role / excluded / the denormalized group `groupRole`). Harmless once the
 * workspace is gone (nothing reads them), but left behind they accumulate as
 * dead data and clutter the role editor. Pruned best-effort after deletion.
 *
 * The workspace's `groupGrants` subcollection lives INSIDE the workspace
 * subtree, so `recursiveDelete(workspaceRef)` already drops it — and deleting
 * the override docs below removes the `groupRole` denorm those grants fed. So
 * both sides of a group grant are cleaned by the workspace deletion.
 */
async function cleanupDeletedWorkspaceReferences(
  teamId: string,
  workspaceId: string
): Promise<void> {
  // Delete each member's per-workspace override doc for this workspace. These
  // sit under memberships/{uid}/workspaces/{wid}, outside the deleted subtree.
  // getAll first so we only write deletes for docs that actually exist.
  const membersSnap = await db
    .collection(`teams/${teamId}/memberships`)
    .select()
    .get()
  const overrideRefs = membersSnap.docs.map((m) =>
    db.doc(`teams/${teamId}/memberships/${m.id}/workspaces/${workspaceId}`)
  )
  for (const chunk of chunkArray(overrideRefs, 300)) {
    const snaps = await db.getAll(...chunk)
    const batch = db.batch()
    let writes = 0
    for (const snap of snaps) {
      if (snap.exists) {
        batch.delete(snap.ref)
        writes++
      }
    }
    if (writes > 0) await batch.commit()
  }
}

export const deleteWorkspace = onCall(
  DESTRUCTIVE_CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")

    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined

    // Step 1: Verify permissions and capture data for logging in a transaction
    const { role, workspaceData } = await db.runTransaction(
      async (transaction) => {
        // DELETE_WORKSPACE walks team scope then per-workspace
        // (CAPABILITY_SCOPES): a team owner/admin (even one excluded from the
        // workspace) can delete it, as can a member elevated to admin/owner in
        // THIS workspace.
        const memberRole =
          requireAuthorized(
            await authorize(actorId, Capabilities.DELETE_WORKSPACE, {
              teamId,
              workspaceId,
              transaction,
            }),
            "You do not have permission to delete workspaces."
          ).teamRole ?? undefined

        const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
        const workspaceSnap = await transaction.get(workspaceRef)

        if (!workspaceSnap.exists) {
          throw new HttpsError("not-found", "Workspace not found.")
        }

        return {
          role: memberRole,
          workspaceData: workspaceSnap.data() ?? {},
        }
      }
    )

    // Step 2: Recursively delete the workspace and ALL subcollections.
    //
    // COST FIX: Previously only deleted the workspace doc, leaving orphaned:
    //   /code/{nodeId}        — code content nodes
    //   /write/{nodeId}       — write content nodes
    //   /memberships/{userId} — workspace-level memberships
    //   /workflows, /workflowRuns — automations + run history (nested here now)
    //
    // db.recursiveDelete() handles deep traversal automatically,
    // deleting all nested documents and subcollections.
    // NOTE: This cannot run inside a transaction, hence the two-step approach.
    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    await db.recursiveDelete(workspaceRef)

    // Step 2b: Prune references that live outside the workspace subtree
    // (per-member overrides keyed by this workspace). Best-effort — the
    // workspace is already gone, so leftovers are harmless dead data; log and
    // continue rather than failing a completed deletion.
    try {
      await cleanupDeletedWorkspaceReferences(teamId, workspaceId)
    } catch (error) {
      logger.error("Failed to prune references for deleted workspace", {
        teamId,
        workspaceId,
        error,
      })
    }

    // Step 2c: Cloud Storage cleanup (recursiveDelete only touches Firestore).
    // Clears the workspace photo (images/) + every node & bot-session attachment
    // (attachments/). Best-effort, by prefix scoped to this workspace.
    await Promise.all([
      deleteStoragePrefix(`images/teams/${teamId}/workspaces/${workspaceId}/`),
      deleteStoragePrefix(
        `attachments/teams/${teamId}/workspaces/${workspaceId}/`
      ),
    ])

    // Step 3: Log the event
    const logRef = await logEvent({
      teamId,
      workspaceId,
      actor: { userId: actorId, email: actorEmail, role },
      action: "workspace.delete",
      resource: { type: "workspace", id: workspaceId, parentId: teamId },
      context: buildContext(request),
      changes: {
        fields: ["name", "description"],
        before: {
          name: workspaceData.name ?? null,
          description: workspaceData.description ?? null,
        },
      },
    })

    return {
      workspaceId,
      deleted: true,
      logId: logRef.id,
    }
  }
)

// =============================================================================
// Workspace Node Operations
// =============================================================================

export const createWorkspaceNode = defineMutation({
  name: "createWorkspaceNode",
  input: z.object({
    teamId: nonEmptyString,
    workspaceId: nonEmptyString,
    scope: z.enum(["code", "write"]),
    parentId: parentIdSchema,
    name: nodeNameSchema,
    type: z.enum(["folder", "file"]),
  }),
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: workspaceContentScope,
  denyMessage: MANAGE_CONTENT_DENY,
  action: "content.create",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, scope, parentId, name, type } = input

    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await tx.get(workspaceRef)
    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    if (parentId !== ROOT_PARENT_ID) {
      const parentRef = db.doc(
        `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${parentId}`
      )
      const parentSnap = await tx.get(parentRef)
      if (!parentSnap.exists) {
        throw new HttpsError("not-found", "Parent folder not found.")
      }
      const parentData = parentSnap.data() ?? {}
      if (parentData.type !== "folder") {
        throw new HttpsError("failed-precondition", "Parent must be a folder.")
      }
      if (parentData.isArchived) {
        throw new HttpsError(
          "failed-precondition",
          "Parent folder is archived."
        )
      }
    }

    const nodeRef = db
      .collection(workspaceNodesCollectionPath(teamId, workspaceId, scope))
      .doc()
    const now = FieldValue.serverTimestamp()
    const nameLower = toNameLower(name)

    const nodeData = {
      workspaceId,
      type,
      typeOrder: getTypeOrder(type),
      name,
      nameLower,
      parentId,
      isArchived: false,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      sortKey: nameLower,
      ...(type === "file" ? { content: "" } : {}),
    }

    tx.set(nodeRef, nodeData)

    return {
      result: { nodeId: nodeRef.id },
      audit: {
        resource: { type: "content", id: nodeRef.id, parentId: workspaceId },
        changes: {
          fields: ["name", "type", "parentId"],
          after: { name, type, parentId },
        },
      },
    }
  },
})

export const renameWorkspaceNode = defineMutation({
  name: "renameWorkspaceNode",
  input: nodeTargetSchema.extend({ name: nodeNameSchema }),
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: workspaceContentScope,
  denyMessage: MANAGE_CONTENT_DENY,
  action: "content.rename",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, scope, nodeId, name } = input

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await tx.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot rename an archived node."
      )
    }

    const nameLower = toNameLower(name)
    const now = FieldValue.serverTimestamp()

    tx.update(nodeRef, {
      name,
      nameLower,
      sortKey: nameLower,
      updatedAt: now,
      updatedBy: actorId,
    })

    return {
      result: { nodeId, updated: true },
      audit: {
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        changes: buildChanges(before, { name }),
      },
    }
  },
})

export const moveWorkspaceNode = defineMutation({
  name: "moveWorkspaceNode",
  input: nodeTargetSchema
    .extend({ parentId: parentIdSchema })
    .refine((data) => data.nodeId !== data.parentId, {
      message: "A node cannot be its own parent.",
    }),
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: workspaceContentScope,
  denyMessage: MANAGE_CONTENT_DENY,
  action: "content.move",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, scope, nodeId, parentId } = input

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await tx.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot move an archived node."
      )
    }

    if (parentId !== ROOT_PARENT_ID) {
      const parentRef = db.doc(
        `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${parentId}`
      )
      const parentSnap = await tx.get(parentRef)
      if (!parentSnap.exists) {
        throw new HttpsError("not-found", "Parent folder not found.")
      }
      const parentData = parentSnap.data() ?? {}
      if (parentData.type !== "folder") {
        throw new HttpsError("failed-precondition", "Parent must be a folder.")
      }
      if (parentData.isArchived) {
        throw new HttpsError(
          "failed-precondition",
          "Parent folder is archived."
        )
      }
    }

    const now = FieldValue.serverTimestamp()
    tx.update(nodeRef, {
      parentId,
      updatedAt: now,
      updatedBy: actorId,
    })

    return {
      result: { nodeId, updated: true },
      audit: {
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        changes: buildChanges(before, { parentId }),
      },
    }
  },
})

export const archiveWorkspaceNode = defineMutation({
  name: "archiveWorkspaceNode",
  input: nodeTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: workspaceContentScope,
  denyMessage: MANAGE_CONTENT_DENY,
  action: "content.archive",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, scope, nodeId } = input

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await tx.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.isArchived) {
      throw new HttpsError("failed-precondition", "Node is already archived.")
    }

    const now = FieldValue.serverTimestamp()
    tx.update(nodeRef, {
      isArchived: true,
      archivedAt: now,
      archivedBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    })

    return {
      result: { nodeId, archived: true },
      audit: {
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        changes: buildChanges(before, { isArchived: true }),
      },
    }
  },
})

export const unarchiveWorkspaceNode = defineMutation({
  name: "unarchiveWorkspaceNode",
  input: nodeTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: workspaceContentScope,
  denyMessage: MANAGE_CONTENT_DENY,
  action: "content.unarchive",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, scope, nodeId } = input

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await tx.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (!before.isArchived) {
      throw new HttpsError("failed-precondition", "Node is not archived.")
    }

    const now = FieldValue.serverTimestamp()
    tx.update(nodeRef, {
      isArchived: false,
      archivedAt: FieldValue.delete(),
      archivedBy: FieldValue.delete(),
      updatedAt: now,
      updatedBy: actorId,
    })

    return {
      result: { nodeId, unarchived: true },
      audit: {
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        changes: buildChanges(before, { isArchived: false }),
      },
    }
  },
})

export const deleteWorkspaceNode = onCall(
  DESTRUCTIVE_CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const scope = assertWorkspaceNodeScope(request.data?.scope)
    const nodeId = assertString(request.data?.nodeId, "nodeId")

    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage workspace content."
      ).teamRole ?? undefined

    const nodesCollection = db.collection(
      workspaceNodesCollectionPath(teamId, workspaceId, scope)
    )
    const nodeRef = nodesCollection.doc(nodeId)
    const nodeSnap = await nodeRef.get()

    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}

    const idsToDelete = new Set<string>([nodeId])
    const queue: string[] = [nodeId]

    while (queue.length) {
      const parentIds = queue.splice(0, IN_QUERY_CHUNK_SIZE)
      const descendantsSnap = await nodesCollection
        .where("parentId", "in", parentIds)
        .get()

      descendantsSnap.docs.forEach((docSnap) => {
        if (idsToDelete.has(docSnap.id)) return
        idsToDelete.add(docSnap.id)
        queue.push(docSnap.id)
      })
    }

    const deleteIds = [...idsToDelete]
    const {
      refs: attachmentRefsToDelete,
      storagePaths: attachmentStoragePaths,
    } = await collectNodeAttachmentDeletes(nodesCollection, deleteIds)

    const refsToDelete = [
      ...attachmentRefsToDelete,
      ...deleteIds.map((id) => nodesCollection.doc(id)),
    ]

    const batches = chunkArray(refsToDelete, DELETE_BATCH_SIZE)
    for (const batchRefs of batches) {
      const batch = db.batch()
      batchRefs.forEach((ref) => {
        batch.delete(ref)
      })
      await batch.commit()
    }

    for (const storagePathBatch of chunkArray(
      attachmentStoragePaths,
      IN_QUERY_CHUNK_SIZE
    )) {
      await Promise.all(
        storagePathBatch.map((storagePath) =>
          deleteStorageObjectIfExists(storagePath)
        )
      )
    }

    const logRef = await logEvent({
      teamId,
      workspaceId,
      actor: { userId: actorId, email: actorEmail, role },
      action: "content.delete",
      resource: { type: "content", id: nodeId, parentId: workspaceId },
      context: buildContext(request),
      changes: {
        fields: ["deleted", "deletedCount"],
        before: {
          name: before.name ?? null,
          isArchived: before.isArchived ?? false,
        },
        after: {
          deleted: true,
          deletedCount: deleteIds.length,
        },
      },
    })

    return {
      nodeId,
      deleted: true,
      deletedCount: deleteIds.length,
      logId: logRef.id,
    }
  }
)

export const updateWorkspaceNodeContent = defineMutation({
  name: "updateWorkspaceNodeContent",
  input: nodeTargetSchema.extend({
    // Lenient like the old hand-rolled parse: a non-string `content` → "".
    content: z
      .unknown()
      .transform((value) => (typeof value === "string" ? value : "")),
  }),
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: workspaceContentScope,
  denyMessage: MANAGE_CONTENT_DENY,
  action: "content.update",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, scope, nodeId, content } = input

    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await tx.get(nodeRef)
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const before = nodeSnap.data() ?? {}
    if (before.type !== "file") {
      throw new HttpsError("failed-precondition", "Only files can be updated.")
    }
    if (before.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot edit an archived file."
      )
    }

    const now = FieldValue.serverTimestamp()
    tx.update(nodeRef, {
      content,
      updatedAt: now,
      updatedBy: actorId,
    })

    return {
      result: { nodeId, updated: true },
      audit: {
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        changes: { fields: ["content"] },
      },
    }
  },
})

/**
 * Transactional core of node-attachment creation — shared by the direct
 * upload callable below and the Drive import (`importDriveNodeAttachment` in
 * driveImport.ts) so both apply the same gates (node exists, not archived,
 * no attachment-id collision), the same node touch, and the same
 * `content.attachment.create` audit entry. `mimeType`/`size` come from the
 * caller: the upload path re-reads them from Storage metadata (never trusts
 * the client), while the Drive import wrote the blob itself so its values
 * are authoritative. Capability checks are the CALLER's responsibility.
 */
export async function createNodeAttachmentDoc(opts: {
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  nodeId: string
  attachmentId: string
  displayName: string
  originalName: string
  storagePath: string
  mimeType: string | null
  size: number | null
  actorId: string
  actorEmail: string | undefined
  role: IMembershipRole | undefined
  context: Context | undefined
}): Promise<{ attachmentId: string; logId: string }> {
  const {
    teamId,
    workspaceId,
    scope,
    nodeId,
    attachmentId,
    displayName,
    originalName,
    storagePath,
    actorId,
  } = opts

  return db.runTransaction(async (transaction) => {
    const nodeRef = db.doc(
      `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
    )
    const nodeSnap = await transaction.get(nodeRef)

    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }

    const nodeData = nodeSnap.data() ?? {}
    if (nodeData.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot add attachments to an archived node."
      )
    }

    const attachmentRef = db.doc(
      workspaceNodeAttachmentDocumentPath(
        teamId,
        workspaceId,
        scope,
        nodeId,
        attachmentId
      )
    )
    const attachmentSnap = await transaction.get(attachmentRef)

    if (attachmentSnap.exists) {
      throw new HttpsError("already-exists", "Attachment already exists.")
    }

    const now = FieldValue.serverTimestamp()

    transaction.set(attachmentRef, {
      workspaceId,
      nodeId,
      scope,
      displayName,
      originalName,
      storagePath,
      mimeType: opts.mimeType,
      size: opts.size,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    })
    transaction.update(nodeRef, {
      updatedAt: now,
      updatedBy: actorId,
    })

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: opts.actorEmail, role: opts.role },
        action: "content.attachment.create",
        resource: { type: "content", id: nodeId, parentId: workspaceId },
        context: opts.context,
        changes: {
          fields: [
            "attachmentId",
            "displayName",
            "originalName",
            "storagePath",
          ],
          after: {
            attachmentId,
            displayName,
            originalName,
            storagePath,
          },
        },
      },
      { transaction }
    )

    return { attachmentId, logId: logRef.id }
  })
}

export const createWorkspaceNodeAttachment = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const scope = assertWorkspaceNodeScope(request.data?.scope)
    const nodeId = assertString(request.data?.nodeId, "nodeId")
    const attachmentId = assertString(
      request.data?.attachmentId,
      "attachmentId"
    )
    const displayName = assertAttachmentDisplayName(
      request.data?.displayName,
      "displayName"
    )
    const originalName = assertString(
      request.data?.originalName,
      "originalName"
    )
    const storagePath = assertAttachmentStoragePath(request.data?.storagePath, {
      teamId,
      workspaceId,
      scope,
      nodeId,
      attachmentId,
    })

    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage workspace attachments."
      ).teamRole ?? undefined

    const storageMetadata = await readStorageObjectMetadata(storagePath)

    const created = await createNodeAttachmentDoc({
      teamId,
      workspaceId,
      scope,
      nodeId,
      attachmentId,
      displayName,
      originalName,
      storagePath,
      mimeType: storageMetadata.mimeType,
      size: storageMetadata.size,
      actorId,
      actorEmail,
      role,
      context: buildContext(request),
    })

    return {
      attachmentId: created.attachmentId,
      created: true,
      logId: created.logId,
    }
  }
)

export const updateWorkspaceNodeAttachment = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const scope = assertWorkspaceNodeScope(request.data?.scope)
    const nodeId = assertString(request.data?.nodeId, "nodeId")
    const attachmentId = assertString(
      request.data?.attachmentId,
      "attachmentId"
    )
    const displayName = assertAttachmentDisplayName(
      request.data?.displayName,
      "displayName"
    )
    const hasReplacement = request.data?.storagePath !== undefined

    if (request.data?.originalName !== undefined && !hasReplacement) {
      throw new HttpsError(
        "invalid-argument",
        "originalName can only be provided when replacing the attachment file."
      )
    }

    const nextStoragePath = hasReplacement
      ? assertAttachmentStoragePath(request.data?.storagePath, {
          teamId,
          workspaceId,
          scope,
          nodeId,
          attachmentId,
        })
      : undefined
    const nextOriginalName = hasReplacement
      ? assertString(request.data?.originalName, "originalName")
      : undefined

    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage workspace attachments."
      ).teamRole ?? undefined

    const storageMetadata =
      hasReplacement && nextStoragePath
        ? await readStorageObjectMetadata(nextStoragePath)
        : null

    const result = await db.runTransaction(async (transaction) => {
      const nodeRef = db.doc(
        `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
      )
      const nodeSnap = await transaction.get(nodeRef)

      if (!nodeSnap.exists) {
        throw new HttpsError("not-found", "Node not found.")
      }

      const nodeData = nodeSnap.data() ?? {}
      if (nodeData.isArchived) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot edit attachments on an archived node."
        )
      }

      const attachmentRef = db.doc(
        workspaceNodeAttachmentDocumentPath(
          teamId,
          workspaceId,
          scope,
          nodeId,
          attachmentId
        )
      )
      const attachmentSnap = await transaction.get(attachmentRef)

      if (!attachmentSnap.exists) {
        throw new HttpsError("not-found", "Attachment not found.")
      }

      const before = attachmentSnap.data() ?? {}
      const updates: Record<string, unknown> = {
        displayName,
      }

      if (hasReplacement) {
        updates.originalName = nextOriginalName ?? before.originalName ?? null
        updates.storagePath = nextStoragePath
        updates.mimeType = storageMetadata?.mimeType ?? null
        updates.size = storageMetadata?.size ?? null
      }

      const changes = buildChanges(before, updates)
      if (!changes) {
        return {
          attachmentId,
          updated: false,
          previousStoragePath:
            typeof before.storagePath === "string" ? before.storagePath : null,
          nextStoragePath: nextStoragePath ?? null,
          logId: undefined,
        }
      }

      const now = FieldValue.serverTimestamp()
      transaction.update(attachmentRef, {
        ...updates,
        updatedAt: now,
        updatedBy: actorId,
      })
      transaction.update(nodeRef, {
        updatedAt: now,
        updatedBy: actorId,
      })

      const logRef = await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorId, email: actorEmail, role },
          action: hasReplacement
            ? "content.attachment.update"
            : "content.attachment.rename",
          resource: { type: "content", id: nodeId, parentId: workspaceId },
          context: buildContext(request),
          changes,
        },
        { transaction }
      )

      return {
        attachmentId,
        updated: true,
        previousStoragePath:
          typeof before.storagePath === "string" ? before.storagePath : null,
        nextStoragePath: nextStoragePath ?? null,
        logId: logRef.id,
      }
    })

    if (
      hasReplacement &&
      result.updated &&
      result.previousStoragePath &&
      result.previousStoragePath !== result.nextStoragePath
    ) {
      await deleteStorageObjectIfExists(result.previousStoragePath)
    }

    return {
      attachmentId,
      updated: result.updated,
      logId: result.logId,
    }
  }
)

export const deleteWorkspaceNodeAttachment = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const scope = assertWorkspaceNodeScope(request.data?.scope)
    const nodeId = assertString(request.data?.nodeId, "nodeId")
    const attachmentId = assertString(
      request.data?.attachmentId,
      "attachmentId"
    )

    const actorId = request.auth.uid
    const actorEmail = request.auth.token.email ?? undefined
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage workspace attachments."
      ).teamRole ?? undefined

    const result = await db.runTransaction(async (transaction) => {
      const nodeRef = db.doc(
        `${workspaceNodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
      )
      const nodeSnap = await transaction.get(nodeRef)

      if (!nodeSnap.exists) {
        throw new HttpsError("not-found", "Node not found.")
      }

      const nodeData = nodeSnap.data() ?? {}
      if (nodeData.isArchived) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot delete attachments from an archived node."
        )
      }

      const attachmentRef = db.doc(
        workspaceNodeAttachmentDocumentPath(
          teamId,
          workspaceId,
          scope,
          nodeId,
          attachmentId
        )
      )
      const attachmentSnap = await transaction.get(attachmentRef)

      if (!attachmentSnap.exists) {
        throw new HttpsError("not-found", "Attachment not found.")
      }

      const before = attachmentSnap.data() ?? {}
      const storagePath =
        typeof before.storagePath === "string" ? before.storagePath : null
      const now = FieldValue.serverTimestamp()

      transaction.delete(attachmentRef)
      transaction.update(nodeRef, {
        updatedAt: now,
        updatedBy: actorId,
      })

      const logRef = await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorId, email: actorEmail, role },
          action: "content.attachment.delete",
          resource: { type: "content", id: nodeId, parentId: workspaceId },
          context: buildContext(request),
          changes: {
            fields: [
              "attachmentId",
              "displayName",
              "originalName",
              "storagePath",
            ],
            before: {
              attachmentId,
              displayName: before.displayName ?? null,
              originalName: before.originalName ?? null,
              storagePath,
            },
            after: {
              deleted: true,
            },
          },
        },
        { transaction }
      )

      return {
        attachmentId,
        deleted: true,
        storagePath,
        logId: logRef.id,
      }
    })

    await deleteStorageObjectIfExists(result.storagePath)

    return {
      attachmentId,
      deleted: result.deleted,
      logId: result.logId,
    }
  }
)

// =============================================================================
// Bot Chat Session Attachments
// =============================================================================
//
// Mirror of the node-attachment callables above, keyed on a chat session
// instead of a workspace node. Two differences: no audit-log writes (chat
// uploads are ephemeral), and an extra session-writability check so a PRIVATE
// chat's attachments can't be modified by other members. Bytes upload
// client→Storage directly (gated by storage.rules); these callables write the
// metadata doc after re-reading the object's authoritative content-type + size.

function botSessionDocPath(
  teamId: string,
  workspaceId: string,
  sessionId: string
): string {
  return `teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`
}

function botSessionAttachmentDocumentPath(
  teamId: string,
  workspaceId: string,
  sessionId: string,
  attachmentId: string
): string {
  return `${botSessionAttachmentsCollectionPath(teamId, workspaceId, sessionId)}/${attachmentId}`
}

function assertBotSessionAttachmentStoragePath(
  value: unknown,
  params: {
    teamId: string
    workspaceId: string
    sessionId: string
    attachmentId: string
  }
): string {
  const storagePath = assertString(value, "storagePath")
  if (!isBotSessionAttachmentStoragePath(storagePath, params)) {
    throw new HttpsError(
      "invalid-argument",
      "storagePath does not match the expected session-attachment location."
    )
  }
  return storagePath
}

/**
 * Gate mutations on the chat session's own access model: only the owner, a
 * shared/public session, or a team admin may modify its attachments. Runs
 * inside the transaction where the session doc is available; the team-level
 * `MANAGE_WORKSPACE_CONTENT` capability is checked separately by each callable.
 * Exported for the Drive import callable (driveImport.ts), which creates
 * session attachments server-side and must apply the SAME access model.
 */
export function assertBotSessionAttachmentWritable(
  sessionData: Record<string, unknown>,
  actorId: string,
  role: unknown
): void {
  if (sessionData.archivedAt) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot modify attachments on an archived chat session."
    )
  }
  const ownerUid =
    typeof sessionData.ownerUid === "string" ? sessionData.ownerUid : null
  const visibility =
    typeof sessionData.visibility === "string"
      ? sessionData.visibility
      : "private"
  const isOwner = ownerUid === actorId
  const isAdmin = role === "owner" || role === "admin"
  const isShared = visibility === "shared" || visibility === "public"
  if (!isOwner && !isShared && !isAdmin) {
    throw new HttpsError(
      "permission-denied",
      "You can't modify attachments on this chat session."
    )
  }
}

export const createBotSessionAttachment = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const sessionId = assertString(request.data?.sessionId, "sessionId")
    const attachmentId = assertString(
      request.data?.attachmentId,
      "attachmentId"
    )
    const displayName = assertAttachmentDisplayName(
      request.data?.displayName,
      "displayName"
    )
    const originalName = assertString(
      request.data?.originalName,
      "originalName"
    )
    const storagePath = assertBotSessionAttachmentStoragePath(
      request.data?.storagePath,
      { teamId, workspaceId, sessionId, attachmentId }
    )

    const actorId = request.auth.uid
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage chat attachments."
      ).teamRole ?? undefined

    const storageMetadata = await readStorageObjectMetadata(storagePath)

    return db.runTransaction(async (transaction) => {
      const sessionRef = db.doc(
        botSessionDocPath(teamId, workspaceId, sessionId)
      )
      const sessionSnap = await transaction.get(sessionRef)
      if (!sessionSnap.exists) {
        throw new HttpsError("not-found", "Chat session not found.")
      }
      assertBotSessionAttachmentWritable(
        sessionSnap.data() ?? {},
        actorId,
        role
      )

      const attachmentRef = db.doc(
        botSessionAttachmentDocumentPath(
          teamId,
          workspaceId,
          sessionId,
          attachmentId
        )
      )
      const attachmentSnap = await transaction.get(attachmentRef)
      if (attachmentSnap.exists) {
        throw new HttpsError("already-exists", "Attachment already exists.")
      }

      const now = FieldValue.serverTimestamp()
      transaction.set(attachmentRef, {
        workspaceId,
        sessionId,
        displayName,
        originalName,
        storagePath,
        mimeType: storageMetadata.mimeType,
        size: storageMetadata.size,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      })

      return { attachmentId, created: true }
    })
  }
)

export const updateBotSessionAttachment = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const sessionId = assertString(request.data?.sessionId, "sessionId")
    const attachmentId = assertString(
      request.data?.attachmentId,
      "attachmentId"
    )
    const displayName = assertAttachmentDisplayName(
      request.data?.displayName,
      "displayName"
    )
    const hasReplacement = request.data?.storagePath !== undefined

    if (request.data?.originalName !== undefined && !hasReplacement) {
      throw new HttpsError(
        "invalid-argument",
        "originalName can only be provided when replacing the attachment file."
      )
    }

    const nextStoragePath = hasReplacement
      ? assertBotSessionAttachmentStoragePath(request.data?.storagePath, {
          teamId,
          workspaceId,
          sessionId,
          attachmentId,
        })
      : undefined
    const nextOriginalName = hasReplacement
      ? assertString(request.data?.originalName, "originalName")
      : undefined

    const actorId = request.auth.uid
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage chat attachments."
      ).teamRole ?? undefined

    const storageMetadata =
      hasReplacement && nextStoragePath
        ? await readStorageObjectMetadata(nextStoragePath)
        : null

    const result = await db.runTransaction(async (transaction) => {
      const sessionRef = db.doc(
        botSessionDocPath(teamId, workspaceId, sessionId)
      )
      const sessionSnap = await transaction.get(sessionRef)
      if (!sessionSnap.exists) {
        throw new HttpsError("not-found", "Chat session not found.")
      }
      assertBotSessionAttachmentWritable(
        sessionSnap.data() ?? {},
        actorId,
        role
      )

      const attachmentRef = db.doc(
        botSessionAttachmentDocumentPath(
          teamId,
          workspaceId,
          sessionId,
          attachmentId
        )
      )
      const attachmentSnap = await transaction.get(attachmentRef)
      if (!attachmentSnap.exists) {
        throw new HttpsError("not-found", "Attachment not found.")
      }

      const before = attachmentSnap.data() ?? {}
      const previousStoragePath =
        typeof before.storagePath === "string" ? before.storagePath : null

      const updates: Record<string, unknown> = { displayName }
      if (hasReplacement) {
        updates.originalName = nextOriginalName ?? before.originalName ?? null
        updates.storagePath = nextStoragePath
        updates.mimeType = storageMetadata?.mimeType ?? null
        updates.size = storageMetadata?.size ?? null
      }

      const now = FieldValue.serverTimestamp()
      transaction.update(attachmentRef, {
        ...updates,
        updatedAt: now,
        updatedBy: actorId,
      })

      return { previousStoragePath, nextStoragePath: nextStoragePath ?? null }
    })

    if (
      hasReplacement &&
      result.previousStoragePath &&
      result.previousStoragePath !== result.nextStoragePath
    ) {
      await deleteStorageObjectIfExists(result.previousStoragePath)
    }

    return { attachmentId, updated: true }
  }
)

export const deleteBotSessionAttachment = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const sessionId = assertString(request.data?.sessionId, "sessionId")
    const attachmentId = assertString(
      request.data?.attachmentId,
      "attachmentId"
    )

    const actorId = request.auth.uid
    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage chat attachments."
      ).teamRole ?? undefined

    const result = await db.runTransaction(async (transaction) => {
      const sessionRef = db.doc(
        botSessionDocPath(teamId, workspaceId, sessionId)
      )
      const sessionSnap = await transaction.get(sessionRef)
      if (!sessionSnap.exists) {
        throw new HttpsError("not-found", "Chat session not found.")
      }
      assertBotSessionAttachmentWritable(
        sessionSnap.data() ?? {},
        actorId,
        role
      )

      const attachmentRef = db.doc(
        botSessionAttachmentDocumentPath(
          teamId,
          workspaceId,
          sessionId,
          attachmentId
        )
      )
      const attachmentSnap = await transaction.get(attachmentRef)
      if (!attachmentSnap.exists) {
        throw new HttpsError("not-found", "Attachment not found.")
      }

      const before = attachmentSnap.data() ?? {}
      const storagePath =
        typeof before.storagePath === "string" ? before.storagePath : null
      transaction.delete(attachmentRef)
      return { storagePath }
    })

    await deleteStorageObjectIfExists(result.storagePath)

    return { attachmentId, deleted: true }
  }
)

// =============================================================================
// Membership CRUD Operations
// =============================================================================

export const assignRoleToUser = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const targetUserId = assertString(request.data?.userId, "userId")
  const role = assertMembershipRole(request.data?.role, "role")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to change roles."
      )
    }

    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await transaction.get(membershipRef)

    if (!membershipSnap.exists) {
      throw new HttpsError("not-found", "Membership not found.")
    }

    const beforeRole = membershipSnap.data()?.role as
      | IMembershipRole
      | undefined

    if (!beforeRole) {
      throw new HttpsError(
        "failed-precondition",
        "Target membership role is missing."
      )
    }

    if (beforeRole === role) {
      return {
        teamId,
        userId: targetUserId,
        role,
        updated: false,
      }
    }

    // Owner role transitions are owner-only.
    if (actorRole !== "owner" && (beforeRole === "owner" || role === "owner")) {
      throw new HttpsError(
        "permission-denied",
        "Only team owners can manage owner roles."
      )
    }

    // Check if changing from owner - must have at least one owner
    // COST OPTIMIZATION: limit(2) is sufficient — we only need to know
    // if there's more than 1 owner, not the exact count.
    if (beforeRole === "owner" && role !== "owner") {
      const membershipsSnap = await db
        .collection(`teams/${teamId}/memberships`)
        .where("role", "==", "owner")
        .select()
        .limit(COST_BUDGET.OWNER_CHECK_LIMIT)
        .get()
      if (membershipsSnap.size <= 1) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot change role: Team must have at least one owner."
        )
      }
    }

    transaction.update(membershipRef, {
      role,
      updatedAt: FieldValue.serverTimestamp(),
    })

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "membership.role.update",
        resource: { type: "membership", id: targetUserId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["role"],
          before: { role: beforeRole },
          after: { role },
        },
      },
      { transaction }
    )

    return {
      teamId,
      userId: targetUserId,
      role,
      updated: true,
      logId: logRef.id,
    }
  })
})

export const assignWorkspaceRole = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
  const targetUserId = assertString(request.data?.userId, "userId")

  // Partial patch — `role` and `excluded` are independently optional:
  //   - role:     omitted = leave unchanged; null = clear the override; a role = set it.
  //   - excluded: omitted = leave unchanged; boolean = set workspace participation.
  // `excluded: true` makes the member a non-member of this workspace and is
  // ENFORCED everywhere: it removes the uid from `memberUids` (list query +
  // workspace read rule), getWorkspaceRoleOverride throws on it (collab/bot/
  // content callables), and rules deny excluded reads (nodes/snapshots/sessions)
  // and writes (canManageWorkspaceContentIn). Deny beats every elevation.
  const roleProvided = request.data?.role !== undefined
  const role: IMembershipRole | null | undefined = roleProvided
    ? request.data?.role === null
      ? null
      : assertMembershipRole(request.data?.role, "role")
    : undefined
  const excluded: boolean | undefined =
    typeof request.data?.excluded === "boolean"
      ? (request.data?.excluded as boolean)
      : undefined

  if (role === undefined && excluded === undefined) {
    throw new HttpsError(
      "invalid-argument",
      "Provide a role and/or an excluded flag to update."
    )
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    // Per-workspace roles are a team-admin act (same gate as team-role
    // assignment) in this phase; a future workspace-admin delegation can
    // relax this without changing the storage shape.
    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to change workspace roles."
      )
    }

    // Granting `owner` — even scoped to one workspace — is owner-only, mirroring
    // assignRoleToUser's owner-transition guard.
    if (role === "owner" && actorRole !== "owner") {
      throw new HttpsError(
        "permission-denied",
        "Only team owners can grant the owner role."
      )
    }

    // The target must already be a team member: a per-workspace role is an
    // overlay on top of team membership, never a standalone grant.
    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await transaction.get(membershipRef)
    if (!membershipSnap.exists) {
      throw new HttpsError("not-found", "Membership not found.")
    }

    // The workspace must exist within the team.
    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await transaction.get(workspaceRef)
    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    const overrideRef = db.doc(
      `teams/${teamId}/memberships/${targetUserId}/workspaces/${workspaceId}`
    )
    const overrideSnap = await transaction.get(overrideRef)
    const overrideData = overrideSnap.data() ?? {}
    const beforeRole =
      (overrideData.role as IMembershipRole | null | undefined) ?? null
    const beforeExcluded = overrideData.excluded === true

    // Excluding a member from the workspace strips their uid from `memberUids`,
    // now the SOLE gate on workspace visibility (the workspace read rule + the
    // `memberUids array-contains` list query). Two exclusions create an
    // unrecoverable state, so reject them up front — mirroring the self-/last-
    // owner guards in removeMember and assignRoleToUser:
    //   - Excluding YOURSELF drops the workspace from your own list, leaving no
    //     way back into WorkspaceDialog to re-include yourself (self-lockout;
    //     only another admin could undo it).
    //   - Excluding an OWNER strands the team's highest-privilege member — and
    //     if they are the sole owner, nobody can restore them.
    // Gated on the transition (excluded && !beforeExcluded) so re-inclusion
    // (excluded: false) and no-op re-exclusions of legacy data still pass.
    if (excluded === true && !beforeExcluded) {
      if (targetUserId === actorId) {
        throw new HttpsError(
          "failed-precondition",
          "You cannot exclude yourself from a workspace. Ask another admin to remove you."
        )
      }
      // Effective role = max(team role, direct override). A team owner or a
      // workspace owner-override both count.
      const targetEffectiveRole = effectiveRole(
        membershipSnap.data()?.role as IMembershipRole | null | undefined,
        beforeRole
      )
      if (targetEffectiveRole === "owner") {
        throw new HttpsError(
          "failed-precondition",
          "You cannot exclude an owner from a workspace. Change their role first."
        )
      }
    }

    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    }
    const fields: string[] = []
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (role !== undefined && role !== beforeRole) {
      patch.role = role
      fields.push("workspaceRole")
      before.workspaceRole = beforeRole
      after.workspaceRole = role
    }
    if (excluded !== undefined && excluded !== beforeExcluded) {
      patch.excluded = excluded
      fields.push("excluded")
      before.excluded = beforeExcluded
      after.excluded = excluded
    }

    if (fields.length === 0) {
      return {
        teamId,
        workspaceId,
        userId: targetUserId,
        role: beforeRole,
        excluded: beforeExcluded,
        updated: false,
      }
    }

    transaction.set(overrideRef, patch, { merge: true })

    // Keep the workspace's participation list in sync for the airtight
    // list-level rule + client query: excluded → drop the uid, included → add.
    if (excluded !== undefined && excluded !== beforeExcluded) {
      transaction.update(workspaceRef, {
        memberUids: excluded
          ? FieldValue.arrayRemove(targetUserId)
          : FieldValue.arrayUnion(targetUserId),
      })
    }

    const logRef = await logEvent(
      {
        teamId,
        workspaceId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "membership.workspace_role.update",
        resource: {
          type: "membership",
          id: targetUserId,
          parentId: workspaceId,
        },
        context: buildContext(request),
        changes: { fields, before, after },
      },
      { transaction }
    )

    return {
      teamId,
      workspaceId,
      userId: targetUserId,
      role: role !== undefined ? role : beforeRole,
      excluded: excluded !== undefined ? excluded : beforeExcluded,
      updated: true,
      logId: logRef.id,
    }
  })
})

/**
 * List the per-workspace overrides set for a workspace, keyed by member uid.
 * Admin-gated (same capability as assigning them) — powers the role-assignment
 * UI. Reads each member's override doc directly rather than via a
 * collectionGroup query, since the `workspaces` collection id collides with the
 * top-level `teams/{t}/workspaces`. Only members WITH a stored override (an
 * explicit role and/or an `excluded` participation flag) are returned; absent
 * means "member, inherits the team role".
 */
export const listWorkspaceMemberRoles = onCall(
  CALLABLE_OPTS,
  async (request) => {
    assertAuthenticated(request)

    const teamId = assertString(request.data?.teamId, "teamId")
    const workspaceId = assertString(request.data?.workspaceId, "workspaceId")
    const actorId = request.auth.uid

    const actorRole = await getTeamRole(teamId, actorId)
    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to view workspace roles."
      )
    }

    const membershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .select()
      .get()

    type Entry = {
      userId: string
      role: IMembershipRole | null
      excluded: boolean
    }
    const roles = (
      await Promise.all(
        membershipsSnap.docs.map(async (memberDoc) => {
          const overrideSnap = await db
            .doc(
              `teams/${teamId}/memberships/${memberDoc.id}/workspaces/${workspaceId}`
            )
            .get()
          if (!overrideSnap.exists) return null
          const data = overrideSnap.data() ?? {}
          const role = isMembershipRole(data.role) ? data.role : null
          const excluded = data.excluded === true
          if (role === null && !excluded) return null
          return { userId: memberDoc.id, role, excluded }
        })
      )
    ).filter((entry): entry is Entry => Boolean(entry))

    return { teamId, workspaceId, roles }
  }
)

export const removeMember = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const targetUserId = assertString(request.data?.userId, "userId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined
  const isRemovingSelf = actorId === targetUserId

  const result = await db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    // If removing someone else, check permission
    if (!isRemovingSelf) {
      if (
        !can(actorId, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: actorRole,
        })
      ) {
        throw new HttpsError(
          "permission-denied",
          "You do not have permission to remove members."
        )
      }
    }

    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await transaction.get(membershipRef)

    if (!membershipSnap.exists) {
      throw new HttpsError("not-found", "Membership not found.")
    }

    const membershipData = membershipSnap.data()
    const targetRole = membershipData?.role as IMembershipRole
    const targetEmail = membershipData?.user?.email ?? undefined

    if (targetRole === "owner" && actorRole !== "owner") {
      throw new HttpsError(
        "permission-denied",
        "Only team owners can remove owners."
      )
    }

    // Check if removing last owner
    // COST OPTIMIZATION: limit(2) + select() — only need to know if >1 owner exists
    if (targetRole === "owner") {
      const membershipsSnap = await db
        .collection(`teams/${teamId}/memberships`)
        .where("role", "==", "owner")
        .select()
        .limit(COST_BUDGET.OWNER_CHECK_LIMIT)
        .get()
      if (membershipsSnap.size <= 1) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot remove the last owner. Assign another owner first."
        )
      }
    }

    // Check if removing last member
    // COST OPTIMIZATION: limit(2) + select() — only need to know if >1 member exists
    const allMembershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .select()
      .limit(COST_BUDGET.MEMBER_CHECK_LIMIT)
      .get()
    if (allMembershipsSnap.size <= 1) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove the last member. Delete the team instead."
      )
    }

    transaction.delete(membershipRef)

    // Update user's current team if removing self
    if (
      isRemovingSelf &&
      (await getSelectedTeamId(transaction, actorId)) === teamId
    ) {
      transaction.set(
        getUserPreferencesRef(actorId),
        {
          currentTeamId: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: isRemovingSelf ? "membership.leave" : "membership.remove",
        resource: { type: "membership", id: targetUserId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["userId", "role", "email"],
          before: {
            userId: targetUserId,
            role: targetRole,
            email: targetEmail,
          },
        },
      },
      { transaction }
    )

    return {
      teamId,
      userId: targetUserId,
      removed: true,
      logId: logRef.id,
    }
  })

  // Post-removal cascades (best-effort, outside the authoritative txn):
  // drop the removed member from every workspace's participation list, and
  // tear down their connection OAuth bindings (revoke + delete tokens —
  // connections.ts; never throws).
  await Promise.all([
    removeMemberFromWorkspaces(teamId, targetUserId),
    cleanupMemberConnectionBindings(teamId, targetUserId),
  ])

  return result
})

export const removeMembers = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const userIds = request.data?.userIds

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "userIds must be a non-empty array."
    )
  }

  // Validate all userIds are strings
  for (const id of userIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw new HttpsError("invalid-argument", "All userIds must be strings.")
    }
  }

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined
  const isRemovingSelf = userIds.includes(actorId)

  const result = await db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    // Check permission (must have permission to remove others)
    const removingOthers = userIds.some((id) => id !== actorId)
    if (removingOthers) {
      if (
        !can(actorId, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: actorRole,
        })
      ) {
        throw new HttpsError(
          "permission-denied",
          "You do not have permission to remove members."
        )
      }
    }

    // Get all memberships being removed
    const membershipRefs = userIds.map((userId) =>
      db.doc(`teams/${teamId}/memberships/${userId}`)
    )
    const membershipSnaps = await Promise.all(
      membershipRefs.map((ref) => transaction.get(ref))
    )

    const membershipsToRemove: Array<{
      userId: string
      role: IMembershipRole
      email?: string
    }> = []

    for (let i = 0; i < membershipSnaps.length; i++) {
      const snap = membershipSnaps[i]
      if (!snap || !snap.exists) {
        throw new HttpsError(
          "not-found",
          `Membership not found for user ${userIds[i]}.`
        )
      }
      const data = snap.data()
      membershipsToRemove.push({
        userId: userIds[i],
        role: data?.role as IMembershipRole,
        email: data?.user?.email,
      })
    }

    const includesOwner = membershipsToRemove.some(
      (membership) => membership.role === "owner"
    )
    if (includesOwner && actorRole !== "owner") {
      throw new HttpsError(
        "permission-denied",
        "Only team owners can remove owners."
      )
    }

    // Get all memberships to check constraints
    // COST OPTIMIZATION: select("role") — we only need the role field for the constraint check
    const allMembershipsSnap = await db
      .collection(`teams/${teamId}/memberships`)
      .select("role")
      .get()

    const userIdSet = new Set(userIds)
    const remainingMembers = allMembershipsSnap.docs.filter(
      (doc) => !userIdSet.has(doc.id)
    )

    if (remainingMembers.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove all members. Delete the team instead."
      )
    }

    const remainingOwners = remainingMembers.filter(
      (doc) => doc.data().role === "owner"
    )
    if (remainingOwners.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove all owners. Assign another owner first."
      )
    }

    // Delete all memberships
    membershipRefs.forEach((ref) => transaction.delete(ref))

    // Update user's current team if removing self
    if (
      isRemovingSelf &&
      (await getSelectedTeamId(transaction, actorId)) === teamId
    ) {
      transaction.set(
        getUserPreferencesRef(actorId),
        {
          currentTeamId: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }

    // Log for each removed member
    const logIds: string[] = []
    for (const member of membershipsToRemove) {
      const logRef = await logEvent(
        {
          teamId,
          actor: { userId: actorId, email: actorEmail, role: actorRole },
          action:
            member.userId === actorId
              ? "membership.leave"
              : "membership.remove",
          resource: { type: "membership", id: member.userId, parentId: teamId },
          context: buildContext(request),
          changes: {
            fields: ["userId", "role", "email"],
            before: {
              userId: member.userId,
              role: member.role,
              email: member.email,
            },
          },
        },
        { transaction }
      )
      logIds.push(logRef.id)
    }

    return {
      teamId,
      userIds,
      removed: true,
      count: userIds.length,
      logIds,
    }
  })

  // Post-removal cascades (best-effort, outside the authoritative txn):
  // workspace participation lists + connection OAuth binding teardown for
  // every removed member (revoke + delete tokens — connections.ts).
  await Promise.all(
    (userIds as string[]).flatMap((userId) => [
      removeMemberFromWorkspaces(teamId, userId),
      cleanupMemberConnectionBindings(teamId, userId),
    ])
  )

  return result
})

// =============================================================================
// Agent Membership Operations
// =============================================================================
//
// Agents (team personas — custom Firestore docs OR shipped built-ins) can
// be added to a team as members. Unlike humans, there's no email/accept
// handshake: an admin adds the agent and the membership doc is written
// directly. Agent memberships share the `teams/{teamId}/memberships`
// collection, keyed by `agentId`, discriminated by `kind: "agent"`, and
// are ALWAYS role "member" (no owner/admin escalation, no role changes).
// The doc carries a denormalized `agent` snapshot so list views render
// without resolving the agents collection (built-ins have no doc at all).

const AGENT_MEMBER_ROLE: IMembershipRole = "member"

interface AgentMemberSnapshot {
  id: string
  name: string
  description: string
  avatarSeed: string
  isBuiltIn: boolean
}

/**
 * Resolve the denormalized snapshot for an agent being added as a member.
 * Built-ins come from the in-process registry (no Firestore doc); custom
 * agents are read from the unified `teams/{teamId}/integrations/{agentId}`
 * collection. Archived custom
 * agents are rejected — they're being deprecated, so they shouldn't gain
 * a fresh membership (mirrors the client's selectable-agents filter).
 */
async function resolveAgentMemberSnapshot(
  transaction: Transaction,
  teamId: string,
  agentId: string
): Promise<AgentMemberSnapshot> {
  if (isBuiltInAgentId(agentId)) {
    const definition = BUILT_IN_AGENTS_BY_ID[agentId]
    if (!definition) {
      throw new HttpsError("not-found", "Built-in agent not found.")
    }
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      avatarSeed: definition.avatarSeed,
      isBuiltIn: true,
    }
  }

  const agentRef = db.doc(`teams/${teamId}/integrations/${agentId}`)
  const agentSnap = await transaction.get(agentRef)
  if (!agentSnap.exists) {
    throw new HttpsError("not-found", "Agent not found.")
  }
  const data = agentSnap.data() ?? {}
  if (data.archivedAt) {
    throw new HttpsError(
      "failed-precondition",
      "Archived agents cannot be added as members. Restore it first."
    )
  }
  return {
    id: agentId,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    isBuiltIn: false,
  }
}

/**
 * Add an agent to a team as a member. Admin/owner only (INVITE_MEMBER).
 * Idempotency: throws `already-exists` if the agent is already a member —
 * the client treats that as a no-op success.
 */
export const addTeamAgentMember = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const agentId = assertString(request.data?.agentId, "agentId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to add agents."
      )
    }

    const teamRef = db.doc(`teams/${teamId}`)
    const teamSnap = await transaction.get(teamRef)
    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team no longer exists.")
    }

    const agentSnapshot = await resolveAgentMemberSnapshot(
      transaction,
      teamId,
      agentId
    )

    const membershipRef = db.doc(`teams/${teamId}/memberships/${agentId}`)
    const membershipSnap = await transaction.get(membershipRef)
    if (membershipSnap.exists) {
      throw new HttpsError("already-exists", "Agent is already a member.")
    }

    transaction.set(membershipRef, {
      kind: "agent",
      agentId,
      teamId,
      role: AGENT_MEMBER_ROLE,
      agent: agentSnapshot,
      team: teamSnap.data() ?? {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "membership.agent.add",
        resource: { type: "membership", id: agentId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["role"],
          after: { role: AGENT_MEMBER_ROLE, agentName: agentSnapshot.name },
        },
      },
      { transaction }
    )

    return {
      teamId,
      agentId,
      role: AGENT_MEMBER_ROLE,
      added: true,
      logId: logRef.id,
    }
  })
})

/**
 * Remove an agent membership from a team. Admin/owner only (REMOVE_MEMBER).
 * Idempotent: a missing membership resolves as success. Only removes the
 * membership — the underlying agent persona (custom doc / built-in) is
 * untouched and remains available for chat.
 */
export const removeTeamAgentMember = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const agentId = assertString(request.data?.agentId, "agentId")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  return db.runTransaction(async (transaction) => {
    const actorRole = await requireTeamRole(transaction, teamId, actorId)

    if (
      !can(actorId, Capabilities.REMOVE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to remove agents."
      )
    }

    const membershipRef = db.doc(`teams/${teamId}/memberships/${agentId}`)
    const membershipSnap = await transaction.get(membershipRef)
    if (!membershipSnap.exists) {
      return { teamId, agentId, removed: true }
    }

    const data = membershipSnap.data()
    if (data?.kind !== "agent") {
      throw new HttpsError(
        "failed-precondition",
        "Target membership is not an agent."
      )
    }

    const agentName =
      typeof data?.agent?.name === "string" ? data.agent.name : undefined

    transaction.delete(membershipRef)

    const logRef = await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "membership.agent.remove",
        resource: { type: "membership", id: agentId, parentId: teamId },
        context: buildContext(request),
        changes: {
          fields: ["role"],
          before: { role: AGENT_MEMBER_ROLE, agentName },
        },
      },
      { transaction }
    )

    return { teamId, agentId, removed: true, logId: logRef.id }
  })
})

// =============================================================================
// Invitation Operations
// =============================================================================

/**
 * Send a new invitation to join a team.
 */
export const sendInvitation = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const teamId = assertString(request.data?.teamId, "teamId")
  const email = assertString(request.data?.email, "email").toLowerCase()
  const role = assertMembershipRole(request.data?.role, "role")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  // COST OPTIMIZATION: Parallelize independent reads.
  // Permission check, user-exists check, pending-invitation check, and team-doc fetch
  // have no data dependencies and can run concurrently (~4 round-trips → ~1).
  const [actorRole, userQuery, existingInvites, teamSnap] = await Promise.all([
    getTeamRole(teamId, actorId),
    db.collection("users").where("email", "==", email).select().limit(1).get(),
    db
      .collection("invitations")
      .where("teamId", "==", teamId)
      .where("email", "==", email)
      .where("status", "==", "pending")
      .select()
      .limit(1)
      .get(),
    db.doc(`teams/${teamId}`).get(),
  ])

  // 1. Check Permissions
  if (
    !can(actorId, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: actorRole,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to invite members."
    )
  }

  if (role === "owner" && actorRole !== "owner") {
    throw new HttpsError(
      "permission-denied",
      "Only team owners can invite owners."
    )
  }

  // 2. Check if user is already a member
  if (!userQuery.empty) {
    const targetUserId = userQuery.docs[0].id
    const membershipRef = db.doc(`teams/${teamId}/memberships/${targetUserId}`)
    const membershipSnap = await membershipRef.get()

    if (membershipSnap.exists) {
      throw new HttpsError(
        "already-exists",
        "User is already a member of this team."
      )
    }
  }

  // 3. Check for existing pending invitation
  if (!existingInvites.empty) {
    throw new HttpsError(
      "already-exists",
      "A pending invitation already exists for this email."
    )
  }

  // 4. Get team data for invitation
  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.")
  }
  const teamName = teamSnap.data()?.name || "Team"

  const inviterName =
    request.auth.token.name || request.auth.token.email || "Someone"

  const code = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const now = FieldValue.serverTimestamp()
  const invitationRef = db.collection("invitations").doc()

  const invitationData: InvitationData = {
    teamId,
    teamName,
    inviterName,
    inviterEmail: actorEmail || "",
    email,
    role,
    status: "pending",
    code,
    createdAt: now,
  }

  await invitationRef.set(invitationData)

  // 5. Audit Log
  // Using 'content' type as invitation is a content-like resource in this context, or maybe 'membership' related
  await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role: actorRole },
    action: "invitation.create",
    resource: { type: "membership", id: invitationRef.id, parentId: teamId }, // It leads to membership
    context: buildContext(request),
    changes: {
      after: { email, role, code },
    },
  })

  return { invitationId: invitationRef.id }
})

/**
 * Resend an existing invitation.
 */
export const resendInvitation = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const invRef = db.doc(`invitations/${invitationId}`)
  const invSnap = await invRef.get()

  if (!invSnap.exists) {
    throw new HttpsError("not-found", "Invitation not found.")
  }

  const invitation = invSnap.data() as InvitationData
  const teamId = invitation.teamId

  // Check Permissions
  const actorRole = await getTeamRole(teamId, actorId)
  if (
    !can(actorId, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: actorRole,
    })
  ) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to resend invitations."
    )
  }

  // Update invitation
  await invRef.update({
    resentAt: FieldValue.serverTimestamp(),
    status: "pending", // Reset status if it was declined? Usually yes.
  })

  // Audit Log
  await logEvent({
    teamId,
    actor: { userId: actorId, email: actorEmail, role: actorRole },
    action: "invitation.resend",
    resource: { type: "membership", id: invitationId, parentId: teamId },
    context: buildContext(request),
  })

  return { success: true }
})

/**
 * Update the role of a pending invitation.
 */
export const updateInvitationRole = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const role = assertMembershipRole(request.data?.role, "role")

  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const invRef = db.doc(`invitations/${invitationId}`)

  return db.runTransaction(async (transaction) => {
    const invSnap = await transaction.get(invRef)
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }
    const invitation = invSnap.data() as InvitationData
    const teamId = invitation.teamId

    // Check Permissions
    const actorRole = await requireTeamRole(transaction, teamId, actorId)
    // Using UPDATE_MEMBER_ROLE capability as proxy for updating invitation role
    if (
      !can(actorId, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to update invitations."
      )
    }

    if (
      actorRole !== "owner" &&
      (invitation.role === "owner" || role === "owner")
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only team owners can manage owner invitations."
      )
    }

    transaction.update(invRef, { role })

    await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "invitation.update",
        resource: { type: "membership", id: invitationId, parentId: teamId },
        context: buildContext(request),
        changes: {
          before: { role: invitation.role },
          after: { role },
        },
      },
      { transaction }
    )
  })
})

/**
 * Cancel/Delete an invitation.
 */
export const cancelInvitation = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const actorId = request.auth.uid
  const actorEmail = request.auth.token.email ?? undefined

  const invRef = db.doc(`invitations/${invitationId}`)

  return db.runTransaction(async (transaction) => {
    const invSnap = await transaction.get(invRef)
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }
    const invitation = invSnap.data() as InvitationData
    const teamId = invitation.teamId

    // Check Permissions
    const actorRole = await requireTeamRole(transaction, teamId, actorId)
    if (
      !can(actorId, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to delete invitations."
      )
    }

    transaction.delete(invRef)

    await logEvent(
      {
        teamId,
        actor: { userId: actorId, email: actorEmail, role: actorRole },
        action: "invitation.delete",
        resource: { type: "membership", id: invitationId, parentId: teamId },
        context: buildContext(request),
        changes: {
          before: { email: invitation.email, role: invitation.role },
        },
      },
      { transaction }
    )
  })
})

/**
 * Decline an invitation (called by the user who was invited).
 */
export const declineInvitation = onCall(CALLABLE_OPTS, async (request) => {
  assertAuthenticated(request)

  const invitationId = assertString(request.data?.invitationId, "invitationId")
  const actorId = request.auth.uid
  const actorEmail = normalizeEmail(request.auth.token.email)

  const invRef = db.doc(`invitations/${invitationId}`)

  return db.runTransaction(async (transaction) => {
    const invSnap = await transaction.get(invRef)
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invitation not found.")
    }
    const invitation = invSnap.data() as InvitationData

    // Verify the user declining is the one invited
    if (!actorEmail || normalizeEmail(invitation.email) !== actorEmail) {
      throw new HttpsError(
        "permission-denied",
        "This invitation is not for you."
      )
    }

    transaction.update(invRef, { status: "declined" })

    // No audit log needed for decline? Or maybe yes.
    // We'll log it as a membership event
    await logEvent(
      {
        teamId: invitation.teamId,
        actor: { userId: actorId, email: actorEmail ?? undefined },
        action: "invitation.decline",
        resource: {
          type: "membership",
          id: invitationId,
          parentId: invitation.teamId,
        },
        context: buildContext(request),
      },
      { transaction }
    )
  })
})
