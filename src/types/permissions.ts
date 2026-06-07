/**
 * Re-exports from the @lectornaut/shared workspace package (single source of truth).
 *
 * Client code should continue importing from "@/types/permissions" — this file
 * simply delegates to the canonical definitions in the shared workspace package.
 */
export {
  Capabilities,
  can,
  effectiveRole,
  hasExactRole,
  roleCan,
  type Capability,
  type IMembershipRole,
  type PermissionContext,
  type Scope,
} from "@lectornaut/shared/permissions"
