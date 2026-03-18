/**
 * Re-exports from the shared permissions module (single source of truth).
 *
 * Functions code should continue importing from "./permissions.js" — this file
 * simply delegates to the canonical definitions copied from shared/ at build time.
 */
export { can, roleCan } from "./shared/permissions.js"
