/**
 * Cloud Functions Instrumentation
 *
 * Provides a wrapper for function handlers that automatically logs:
 * - Handler name
 * - Duration (ms)
 * - Memory usage (MB) when accessible
 * - Error rate / error details
 * - Correlation ID for request tracing
 *
 * All logs are structured JSON for easy filtering in Cloud Logging.
 *
 * Usage:
 *   export const myFunction = onCall(CALLABLE_OPTS, withInstrumentation("myFunction", async (request) => {
 *     // your handler logic
 *   }))
 */

import * as logger from "firebase-functions/logger"
import { generateId } from "./utilities.js"

export interface InstrumentationContext {
  correlationId: string
  handler: string
}

/**
 * Wrap a callable/trigger handler with instrumentation.
 * Returns the same function signature, adding structured logging around it.
 */
export function withInstrumentation<TArgs extends unknown[], TResult>(
  handlerName: string,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const correlationId = generateId()
    const startTime = Date.now()
    const startMemory = process.memoryUsage()

    let error: unknown = null

    try {
      const result = await fn(...args)
      return result
    } catch (err) {
      error = err
      throw err
    } finally {
      const durationMs = Date.now() - startTime
      const endMemory = process.memoryUsage()
      const memoryUsageMB =
        Math.round(
          ((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024) * 100
        ) / 100

      const logEntry: Record<string, unknown> = {
        handler: handlerName,
        correlationId,
        durationMs,
        memoryUsageMB,
        heapUsedMB: Math.round((endMemory.heapUsed / 1024 / 1024) * 100) / 100,
        rssMB: Math.round((endMemory.rss / 1024 / 1024) * 100) / 100,
      }

      if (error) {
        logEntry.error = true
        logEntry.errorMessage =
          error instanceof Error ? error.message : String(error)
        logEntry.errorCode =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code: unknown }).code
            : undefined
        logger.error("[fn:instrumentation]", logEntry)
      } else {
        logger.info("[fn:instrumentation]", logEntry)
      }
    }
  }
}
