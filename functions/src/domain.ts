/**
 * Re-exports from the @lectornaut/shared workspace package (single source of truth).
 *
 * Functions code should import domain vocabulary from "./domain.js" — this shim
 * delegates to the workspace package. At build time, esbuild inlines the shared
 * module into the deploy bundle, so it doesn't need to be installed in Cloud
 * Build. Mirrors `functions/src/permissions.ts`.
 */
export * from "@lectornaut/shared/domain"
