/**
 * Re-exports from the shared permissions module (single source of truth).
 *
 * Client code should continue importing from "@/types/permissions" — this file
 * simply delegates to the canonical definitions in shared/permissions.ts.
 */
export {
  Capabilities,
  can,
  hasExactRole,
  roleCan,
  type Capability,
  type IMembershipRole,
  type PermissionContext,
  type Scope,
} from "@shared/permissions"
