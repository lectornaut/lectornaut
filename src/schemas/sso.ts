import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Team security + SSO schemas — mirror `src/types/sso.ts`.
 *
 * `ITeamSecurityConfig` is read via `useSsoConfig` composable and written
 * through `mutateWithCoordinator`. Per-protocol sub-configs (`saml`, `oidc`)
 * are optional on the parent to let teams store either without the other.
 */

export const ssoProtocolSchema = z.enum(["saml", "oidc"])

export const samlConfigSchema = z.object({
  idpEntityId: z.string(),
  ssoUrl: z.string(),
  certificate: z.string(),
})

export const oidcConfigSchema = z.object({
  issuer: z.string(),
  clientId: z.string(),
})

export const ssoConfigSchema = z.object({
  enabled: z.boolean(),
  protocol: ssoProtocolSchema,
  providerId: z.string(),
  domains: z.array(z.string()),
  enforced: z.boolean(),
  autoProvision: z.boolean(),
  defaultRole: z.enum(["member", "guest"]),
  saml: samlConfigSchema.optional(),
  oidc: oidcConfigSchema.optional(),
})

export const loginMethodsSchema = z.object({
  emailPassword: z.boolean(),
  magicLink: z.boolean(),
  google: z.boolean(),
  microsoft: z.boolean(),
  apple: z.boolean(),
  sso: z.boolean(),
})

export const teamSecurityConfigSchema = z.object({
  loginMethods: loginMethodsSchema,
  approvedDomains: z.array(z.string()),
  sso: ssoConfigSchema,
  configuredBy: z.string(),
  updatedAt: timestampSchema,
})

export const ssoResolveResultSchema = z.object({
  sso: z.boolean(),
  providerId: z.string().optional(),
  enforced: z.boolean().optional(),
})
