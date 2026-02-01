import type { RouteLocationNormalizedLoaded } from "vue-router"

/**
 * Resolves the name of a route based on its metadata.
 * Prefers meta.breadcrumb (can be a function or a string) and falls back to route.name.
 * @param route The route to resolve the name for.
 * @returns The resolved name as a string.
 */
export const resolveRouteName = (
  route: RouteLocationNormalizedLoaded
): string => {
  const breadcrumb = route.meta?.breadcrumb

  if (typeof breadcrumb === "function") {
    try {
      return String(breadcrumb(route))
    } catch (error) {
      console.error("Failed to resolve breadcrumb function:", error)
    }
  }

  if (breadcrumb) {
    return String(breadcrumb)
  }

  return (route.name as string) || "New tab"
}
