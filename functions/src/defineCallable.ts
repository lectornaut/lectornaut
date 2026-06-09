/**
 * `defineCallable` — the depth behind the flat callable facade.
 *
 * `functions/src/index.ts` star-exports ~17 per-domain modules; behind it every
 * `onCall` re-implemented the same outer ring by hand — auth assertion, App
 * Check, input validation, runtime opts/secrets, and an error→HttpsError
 * boundary. This seam owns that ring DECLARATIVELY and leaves the handler to
 * write only business logic. The `export const X = defineCallable(...)` shape is
 * preserved, so the star-exports in `index.ts` need no change.
 *
 * It COMPOSES, never reabsorbs, the inner seams:
 *   - auth → `resolveAuth` (the shared `./auth.js` gates), and
 *   - (in the `defineMutation` variant) `authorize()` + `logEvent()` stay called
 *     from inside the handler/transaction, where they are authoritative and
 *     transaction-scoped.
 *
 * App Check + secrets + runtime opts are bound into the `onCall` OPTIONS object
 * so Firebase resolves them pre-handler / at deploy — they are NEVER moved into
 * a handler-side check.
 */

import * as logger from "firebase-functions/logger"
import type { SecretParam } from "firebase-functions/params"
import {
  HttpsError,
  onCall,
  type CallableOptions,
  type CallableRequest,
} from "firebase-functions/v2/https"
import type { ZodType } from "zod"

import { requireVerifiedAuth, type AuthData } from "./auth.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"

// ===========================================================================
// Auth policy
// ===========================================================================

export type AuthMode = "none" | "required" | "verified"

/**
 * `"none"` may legitimately have no caller (a bootstrap endpoint), so its
 * resolved auth is nullable; `"required"` / `"verified"` guarantee a caller, so
 * the handler gets a non-null {@link AuthData} and can read `auth.uid` directly.
 */
type ResolvedAuth<M extends AuthMode> = M extends "none"
  ? AuthData | undefined
  : AuthData

/**
 * Resolve the caller's auth per the declared policy. `"required"` reproduces the
 * (formerly six-times-copied) `assertAuthenticated` message; `"verified"`
 * delegates to the shared {@link requireVerifiedAuth}; `"none"` passes the
 * optional auth through untouched.
 */
export function resolveAuth<M extends AuthMode>(
  request: CallableRequest,
  mode: M
): ResolvedAuth<M> {
  if (mode === "verified") {
    return requireVerifiedAuth(request.auth) as ResolvedAuth<M>
  }
  if (mode === "none") {
    return (request.auth ?? undefined) as ResolvedAuth<M>
  }
  // "required"
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
  return request.auth as ResolvedAuth<M>
}

// ===========================================================================
// Input parsing
// ===========================================================================

/**
 * Parse `data` against a Zod schema, mapping any failure to `invalid-argument`
 * with a concise first-issue message. Replaces the per-file `assertString` /
 * ad-hoc `safeParse(...) → invalid-argument` sprawl with one typed step, so
 * `ctx.input` narrows to the schema's inferred type.
 */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const issue = result.error.issues[0]
  const path = issue?.path.join(".")
  const message = issue
    ? path
      ? `${path}: ${issue.message}`
      : issue.message
    : "Invalid request payload."
  throw new HttpsError("invalid-argument", message)
}

// ===========================================================================
// Error boundary
// ===========================================================================

/**
 * The error boundary: pass `HttpsError` through untouched (preserving the
 * handler's explicit `invalid-argument` / `permission-denied` / `not-found` /
 * `unauthenticated` codes) and mask everything else as `internal` after logging
 * it server-side — so an unexpected provider / Firestore error never leaks its
 * internals to the client.
 */
export function maskInternal(error: unknown, name: string): HttpsError {
  logger.error(`[${name}] unhandled error`, error)
  return new HttpsError("internal", "An internal error occurred.")
}

// ===========================================================================
// defineCallable
// ===========================================================================

/** Typed context handed to a {@link defineCallable} handler. */
export interface CallableCtx<In, M extends AuthMode = "required"> {
  /** The raw Firebase request (rawRequest, app, instanceIdToken, …). */
  request: CallableRequest<In>
  /** Resolved per `spec.auth`: non-null for required/verified, maybe-undefined for none. */
  auth: ResolvedAuth<M>
  /** `request.data` parsed through `spec.input`, or the raw data (as `In`) when no schema. */
  input: In
}

export interface CallableSpec<In, Out, M extends AuthMode> {
  /** Function name — used only to label masked-error server logs. */
  name: string
  /** Auth policy. Default `"required"`. */
  auth?: M
  /** Enforce Firebase App Check. Bound into the onCall OPTIONS (pre-handler). */
  appCheck?: boolean
  /** Zod schema; parsed once → typed `ctx.input`. Omit to pass `request.data` through as `In`. */
  input?: ZodType<In>
  /** A `runtimeConfig.ts` preset. Default `CALLABLE_OPTS`. */
  opts?: CallableOptions<In>
  /** `secrets.ts` refs, bound into the onCall OPTIONS. */
  secrets?: SecretParam[]
  /** Business logic. Throw `HttpsError` for client-facing failures; anything else is masked. */
  handler: (ctx: CallableCtx<In, M>) => Promise<Out>
}

/**
 * Declare a plain (non-Genkit) callable. Returns a standard `onCall` result, so
 * `export const X = defineCallable(...)` is a drop-in for `export const X =
 * onCall(...)` and `index.ts`'s star-exports need no change.
 *
 * Generics are inferred from the spec: `In` from `input` (the Zod schema), `Out`
 * from the handler's return, `M` from `auth`.
 */
export function defineCallable<
  In = unknown,
  Out = unknown,
  M extends AuthMode = "required",
>(spec: CallableSpec<In, Out, M>) {
  const options: CallableOptions<In> = {
    ...(spec.opts ?? (CALLABLE_OPTS as CallableOptions<In>)),
    ...(spec.appCheck !== undefined ? { enforceAppCheck: spec.appCheck } : {}),
    ...(spec.secrets ? { secrets: spec.secrets } : {}),
  }

  return onCall<In, Promise<Out>>(options, async (request) => {
    const auth = resolveAuth(request, (spec.auth ?? "required") as M)
    const input = spec.input
      ? parseOrThrow(spec.input, request.data)
      : (request.data as In)

    try {
      return await spec.handler({ request, auth, input })
    } catch (error) {
      throw error instanceof HttpsError ? error : maskInternal(error, spec.name)
    }
  })
}
