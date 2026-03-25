import type { Timestamp } from "firebase/firestore"

export type SsoProtocol = "saml" | "oidc"

export interface ISamlConfig {
  idpEntityId: string
  ssoUrl: string
  certificate: string
}

export interface IOidcConfig {
  issuer: string
  clientId: string
}

export interface ISsoConfig {
  enabled: boolean
  protocol: SsoProtocol
  providerId: string
  domains: string[]
  enforced: boolean
  autoProvision: boolean
  defaultRole: "member" | "guest"
  saml?: ISamlConfig
  oidc?: IOidcConfig
}

export interface ILoginMethods {
  emailPassword: boolean
  magicLink: boolean
  google: boolean
  microsoft: boolean
  apple: boolean
  sso: boolean
}

export interface ITeamSecurityConfig {
  loginMethods: ILoginMethods
  approvedDomains: string[]
  sso: ISsoConfig
  configuredBy: string
  updatedAt: Timestamp
}

export interface ISsoResolveResult {
  sso: boolean
  providerId?: string
  enforced?: boolean
}

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
