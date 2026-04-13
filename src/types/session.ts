import type { deviceTypeSchema, userSessionSchema } from "@/schemas/session"
import type { z } from "zod"

/**
 * Session type aliases — re-exported from `src/schemas/session.ts`.
 */

export type DeviceType = z.infer<typeof deviceTypeSchema>
export type IUserSession = z.infer<typeof userSessionSchema>
