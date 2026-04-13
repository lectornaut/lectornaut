import type {
  loginMethodsSchema,
  oidcConfigSchema,
  samlConfigSchema,
  ssoConfigSchema,
  ssoProtocolSchema,
  ssoResolveResultSchema,
  teamSecurityConfigSchema,
} from "@/schemas/sso"
import type { z } from "zod"

/**
 * SSO / team security type aliases — re-exported from `src/schemas/sso.ts`.
 *
 * Default-value constants (`defaultLoginMethods`, `defaultSsoConfig`) stay
 * here because they are runtime values consumed by the store and composable
 * layers during initial setup.
 */

export type SsoProtocol = z.infer<typeof ssoProtocolSchema>
export type ISamlConfig = z.infer<typeof samlConfigSchema>
export type IOidcConfig = z.infer<typeof oidcConfigSchema>
export type ISsoConfig = z.infer<typeof ssoConfigSchema>
export type ILoginMethods = z.infer<typeof loginMethodsSchema>
export type ITeamSecurityConfig = z.infer<typeof teamSecurityConfigSchema>
export type ISsoResolveResult = z.infer<typeof ssoResolveResultSchema>

export const defaultLoginMethods: ILoginMethods = {
  emailPassword: true,
  magicLink: true,
  google: true,
  microsoft: true,
  apple: true,
  sso: false,
}

export const defaultSsoConfig: ISsoConfig = {
  enabled: false,
  protocol: "saml",
  providerId: "",
  domains: [],
  enforced: false,
  autoProvision: false,
  defaultRole: "member",
}
