export function settingsLifecycleStatus(
  enabled: boolean,
  archived: boolean
): "archived" | "disabled" | null {
  if (archived) return "archived"
  return enabled ? null : "disabled"
}
