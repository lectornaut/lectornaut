import { z } from "zod"
import { timestampSchema } from "./_primitives"

/**
 * Session schemas — mirror `src/types/session.ts`.
 *
 * Sessions are written by the device-sessions composable via the sync engine.
 * No write schema variant is defined yet because the sync engine's path
 * registry does not include session paths in PR 4; if a write path is added
 * later, extend with `{ createdAt: timestampInputSchema, lastActiveAt: … }`.
 */

export const deviceTypeSchema = z.enum(["desktop", "mobile", "tablet"])

export const userSessionSchema = z.object({
  id: z.string(),
  deviceName: z.string(),
  browser: z.string(),
  os: z.string(),
  deviceType: deviceTypeSchema,
  ip: z.string(),
  createdAt: timestampSchema,
  lastActiveAt: timestampSchema,
})
