import {
  CONNECTION_BINDING_STATUSES,
  CONNECTION_PROVIDERS,
  CONNECTION_STATUSES,
} from "@lectornaut/shared/domain"
import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Connection schemas — client read-side validation for
 * `teams/{teamId}/connections/{provider}` and its `bindings/{uid}`
 * subcollection (docs/connections-feature.prompt.md).
 *
 * Both are written ONLY by functions (`connections.ts` callables; rules are
 * `allow write: if false`), so these are *read* schemas. The sibling
 * `bindingSecrets/{uid}` docs hold OAuth tokens and have NO client rules at
 * all — no schema exists for them here by design: a token must never have a
 * client-side read path.
 *
 * Strictness rule (cf. the "over-strict read schema silently drops rows"
 * scar): required only for fields every server write path sets; timestamps
 * stay `.optional()` like `memorySchema`'s.
 */

export const connectionProviderSchema = z.enum(CONNECTION_PROVIDERS)
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES)
export const connectionBindingStatusSchema = z.enum(CONNECTION_BINDING_STATUSES)

export const connectionSchema = z.object({
  /** Doc id == provider key (`"google-calendar"`). */
  id: connectionProviderSchema,
  // Injected from the doc path by the converter (`{ teamId: 1 }`) — the
  // location is canonical, so legacy/partial docs parse cleanly.
  teamId: z.string(),
  /** Mirror of the doc id, denormalized for query symmetry. */
  provider: connectionProviderSchema,
  status: connectionStatusSchema.default("active"),
  /** Admin who installed the app. */
  installedByUid: z.string(),
  /** OAuth scopes the provider's bindings request (declared, not granted). */
  scopes: z.array(z.string()).default([]),
  /**
   * Kill-switch provenance (`setConnectionDisabled`): set while
   * `status === "disabled"`, nulled on re-enable. Optional+nullable — docs
   * that were never disabled don't carry the fields.
   */
  disabledAt: timestampSchema.nullable().optional(),
  disabledByUid: z.string().nullable().optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
})

export const connectionBindingSchema = z.object({
  /** Doc id == the bound member's uid. */
  id: z.string(),
  // Path-injected (`{ teamId: 1, provider: 3 }`).
  teamId: z.string(),
  provider: connectionProviderSchema,
  status: connectionBindingStatusSchema.default("connected"),
  /**
   * The external account's email (from the OAuth `id_token`), for the
   * "Connected as you@…" row. Optional: the exchange can omit it.
   */
  email: z.string().optional(),
  /** Scopes actually granted on this binding. */
  scopes: z.array(z.string()).default([]),
  connectedAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
})

export type IConnection = z.infer<typeof connectionSchema>
export type IConnectionBinding = z.infer<typeof connectionBindingSchema>
export type IConnectionStatus = z.infer<typeof connectionStatusSchema>
export type IConnectionBindingStatus = z.infer<
  typeof connectionBindingStatusSchema
>
