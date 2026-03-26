export type SessionVerificationStatus = "exists" | "missing" | "indeterminate"
export type SessionVerificationDecision = "recover" | "revoke" | "keep_alive"

const SESSION_MONITOR_RECOVERY_CODES = new Set([
  "cancelled",
  "deadline-exceeded",
  "failed-precondition",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated",
  "unavailable",
])

export function isSessionMonitorRecoveryCode(code: unknown): boolean {
  return typeof code === "string" && SESSION_MONITOR_RECOVERY_CODES.has(code)
}

export function getSessionVerificationDecision(
  statuses: readonly SessionVerificationStatus[]
): SessionVerificationDecision {
  if (statuses.includes("missing")) return "revoke"
  if (statuses.includes("exists")) return "recover"
  return "keep_alive"
}
