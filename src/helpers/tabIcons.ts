import {
  IconAiFill,
  IconCamera,
  IconCreditCard,
  IconLayers,
  IconLogOut,
  IconLogs,
  IconMail,
  IconRocket,
  IconSearch,
  IconUserRound,
  IconZap,
} from "@/data/icons"
import { defaultCreateMenu, defaultMenu } from "@/helpers/defaults"
import type { Component } from "vue"

export interface TabIconRule {
  id: string
  icon: Component
  matches: (path: string) => boolean
}

export interface ResolvedTabIcon {
  id: string
  icon: Component
  path: string
}

export function normalizeTabPath(value: string): string {
  const [rawPath] = value.split(/[?#]/)
  const path = rawPath || value || "/"

  if (path === "/") {
    return path
  }

  return path.replace(/\/+$/, "") || "/"
}

function exactPathRule(id: string, path: string, icon: Component): TabIconRule {
  const normalizedPath = normalizeTabPath(path)
  return {
    id,
    icon,
    matches: (value) => value === normalizedPath,
  }
}

function prefixPathRule(
  id: string,
  pathPrefix: string,
  icon: Component
): TabIconRule {
  const normalizedPrefix = normalizeTabPath(pathPrefix)
  return {
    id,
    icon,
    matches: (value) =>
      value === normalizedPrefix || value.startsWith(`${normalizedPrefix}/`),
  }
}

const createRouteRules = defaultCreateMenu.map((item) =>
  exactPathRule(`create:${item.id}`, item.action, item.icon)
)

const primaryRouteRules = defaultMenu.map((item) =>
  prefixPathRule(`menu:${item.id}`, item.url, item.icon)
)

export const tabIconRules: readonly TabIconRule[] = [
  ...createRouteRules,
  exactPathRule("new", "/new", IconZap),
  exactPathRule("start", "/start", IconRocket),
  exactPathRule("welcome", "/welcome", IconAiFill),
  exactPathRule("enter", "/enter", IconUserRound),
  exactPathRule("exit", "/exit", IconLogOut),
  exactPathRule("pricing", "/pricing", IconCreditCard),
  exactPathRule("changelog", "/changelog", IconLogs),
  exactPathRule("explore", "/explore", IconSearch),
  exactPathRule("file-capture", "/file-capture", IconCamera),
  exactPathRule("invitations", "/invitations", IconMail),
  ...primaryRouteRules,
] as const

export function resolveTabIcon(fullPath: string): ResolvedTabIcon {
  const normalizedPath = normalizeTabPath(fullPath)
  const matchedRule = tabIconRules.find((rule) => rule.matches(normalizedPath))

  return {
    id: matchedRule?.id ?? "default",
    icon: matchedRule?.icon ?? IconLayers,
    path: normalizedPath,
  }
}
