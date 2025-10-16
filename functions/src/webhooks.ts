import type { Request } from "express"
import { getApps, initializeApp } from "firebase-admin/app"
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { logger } from "firebase-functions/logger"
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https"
import { performance } from "node:perf_hooks"
import { TextDecoder } from "node:util"
import { fetch } from "undici"
import { VM } from "vm2"
import { z } from "zod"

const MAX_RESPONSE_BYTES = 64 * 1024
const TRANSFORMATION_TIMEOUT_MS = 1_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_LIMIT = 3

const app = getApps().length ? getApps()[0] : initializeApp()
const db = getFirestore(app)

type ConsoleLevel = "log" | "info" | "warn" | "error"

type ConsoleLogEntry = {
  level: ConsoleLevel
  message: string
  timestamp: string
}

type SerializedError = {
  name: string
  message: string
  stack?: string
}

type RequestWithRawBody = Request & {
  rawBody?: Buffer
}

const querySchema = z.object({
  token: z.string().min(1),
})

const testSchema = z.object({
  script: z.string().optional(),
  payload: z.any().optional(),
})

const channelSchema = z
  .object({
    targetUrl: z.string().url().optional(),
    secret: z.string().min(1).optional(),
    webhookSecret: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    transformationScript: z.string().optional(),
    transformation: z
      .object({
        script: z.string().optional(),
      })
      .optional(),
    webhook: z
      .object({
        secret: z.string().optional(),
        targetUrl: z.string().url().optional(),
        transformationScript: z.string().optional(),
      })
      .optional(),
    timeoutMs: z.number().int().positive().optional(),
    retryLimit: z.number().int().min(1).max(5).optional(),
    stats: z
      .object({
        successCount: z.number().int().nonnegative().optional(),
        failureCount: z.number().int().nonnegative().optional(),
        avgResponseMs: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough()

export const processProjectWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.set("Allow", "POST")
    res.status(405).json({ success: false, error: "Method not allowed" })
    return
  }

  const channelId = extractChannelId(req.path)
  if (!channelId) {
    res.status(404).json({ success: false, error: "Channel not found" })
    return
  }

  const tokenValue = Array.isArray(req.query.token)
    ? req.query.token[0]
    : req.query.token
  const validatedToken = querySchema.safeParse({ token: tokenValue })

  if (!validatedToken.success) {
    res.status(400).json({ success: false, error: "Missing or invalid token" })
    return
  }

  const channelRef = db.collection("channels").doc(channelId)
  const channelSnapshot = await channelRef.get()

  if (!channelSnapshot.exists) {
    res.status(404).json({ success: false, error: "Channel not found" })
    return
  }

  const channelDataParse = channelSchema.safeParse(channelSnapshot.data())

  if (!channelDataParse.success) {
    logger.error("Channel document failed validation", {
      channelId,
      issues: channelDataParse.error.issues,
    })
    res
      .status(500)
      .json({ success: false, error: "Channel configuration invalid" })
    return
  }

  const channel = channelDataParse.data
  const secret = resolveChannelSecret(channel)

  if (!secret || secret !== validatedToken.data.token) {
    logger.warn("Webhook secret validation failed", { channelId })
    res.status(401).json({ success: false, error: "Unauthorized" })
    return
  }

  const targetUrl = channel.webhook?.targetUrl ?? channel.targetUrl
  if (!targetUrl) {
    logger.error("Channel is missing targetUrl", { channelId })
    res
      .status(500)
      .json({ success: false, error: "Channel target not configured" })
    return
  }

  const requestPayload = normalizeRequestPayload(req as RequestWithRawBody)
  const consoleLogs: ConsoleLogEntry[] = []

  let transformedPayload: unknown
  try {
    transformedPayload = await runTransformation(
      resolveTransformationScript(channel),
      requestPayload,
      consoleLogs
    )
  } catch (error) {
    const serializedError = serializeError(error)
    logger.error("Transformation execution failed", {
      channelId,
      error: serializedError,
    })

    await persistChannelLog(channelRef, {
      attempts: 0,
      success: false,
      requestPayload,
      transformedPayload: null,
      targetUrl,
      consoleLogs,
      error: serializedError,
    })

    await updateChannelStats(channelRef, false, undefined)

    res.status(500).json({ success: false, error: "Transformation failed" })
    return
  }

  const delivery = await deliverWithRetry(targetUrl, transformedPayload, {
    timeoutMs: channel.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxAttempts: channel.retryLimit ?? DEFAULT_RETRY_LIMIT,
  })

  await persistChannelLog(channelRef, {
    attempts: delivery.attempts,
    success: delivery.success,
    statusCode: delivery.response?.statusCode ?? null,
    durationMs: delivery.response?.durationMs ?? null,
    responseBody: delivery.response?.body ?? null,
    responseBytes: delivery.response?.bytes ?? null,
    responseHeaders: delivery.response?.headers ?? {},
    requestPayload,
    transformedPayload,
    targetUrl,
    consoleLogs,
    error: delivery.error,
  })

  await updateChannelStats(
    channelRef,
    delivery.success,
    delivery.response?.durationMs
  )

  if (!delivery.success) {
    const status = delivery.response?.statusCode ?? 502
    res.status(status).json({
      success: false,
      error: delivery.error?.message ?? "Delivery failed",
      attempts: delivery.attempts,
    })
    return
  }

  res.status(200).json({
    success: true,
    attempts: delivery.attempts,
    statusCode: delivery.response?.statusCode,
    durationMs: delivery.response?.durationMs,
  })
})

export const testChannelTransformation = onCall(
  {
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required")
    }

    const parsed = testSchema.safeParse(request.data)
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", "Invalid test payload")
    }

    const { script, payload } = parsed.data
    const consoleLogs: ConsoleLogEntry[] = []

    try {
      const result = await runTransformation(script, payload, consoleLogs)

      return {
        success: true,
        result,
        logs: consoleLogs,
      }
    } catch (error) {
      const serializedError = serializeError(error)
      logger.error("Transformation preview failed", {
        error: serializedError,
        uid: request.auth.uid,
      })

      return {
        success: false,
        error: serializedError,
        logs: consoleLogs,
      }
    }
  }
)

type DeliveryOptions = {
  timeoutMs: number
  maxAttempts: number
}

type DeliveryResponse = {
  statusCode: number
  durationMs: number
  headers: Record<string, string>
  body: string | null
  bytes: number | null
}

type DeliveryResult = {
  success: boolean
  attempts: number
  response?: DeliveryResponse
  error?: SerializedError | null
}

async function deliverWithRetry(
  url: string,
  payload: unknown,
  options: DeliveryOptions
): Promise<DeliveryResult> {
  let attempts = 0
  let lastError: SerializedError | null = null
  let lastResponse: DeliveryResponse | undefined

  while (attempts < options.maxAttempts) {
    attempts += 1
    try {
      const response = await performDelivery(url, payload, options.timeoutMs)
      lastResponse = response

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return {
          success: true,
          attempts,
          response,
        }
      }

      lastError = {
        name: "HTTPError",
        message: `Target responded with status ${response.statusCode}`,
      }

      if (response.statusCode >= 400 && response.statusCode < 500) {
        break
      }
    } catch (error) {
      lastError = serializeError(error)
      logger.warn("Delivery attempt failed", {
        url,
        attempts,
        error: lastError,
      })
    }
  }

  return {
    success: false,
    attempts,
    response: lastResponse,
    error: lastError,
  }
}

async function performDelivery(
  url: string,
  payload: unknown,
  timeoutMs: number
): Promise<DeliveryResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    const normalized = normalizeOutgoingPayload(payload)
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": normalized.contentType,
      },
      body: normalized.body,
      signal: controller.signal,
    })

    const durationMs = Math.round(performance.now() - started)
    const headers = Object.fromEntries(response.headers.entries())

    const arrayBuffer = await response.arrayBuffer()
    const bytes = arrayBuffer.byteLength
    let body: string | null = null

    if (bytes > 0) {
      const slice =
        bytes > MAX_RESPONSE_BYTES
          ? arrayBuffer.slice(0, MAX_RESPONSE_BYTES)
          : arrayBuffer

      const decoder = new TextDecoder()
      body = decoder.decode(slice)

      if (bytes > MAX_RESPONSE_BYTES) {
        body += `\n/* truncated after ${MAX_RESPONSE_BYTES} bytes */`
      }
    }

    return {
      statusCode: response.status,
      durationMs,
      headers,
      body,
      bytes,
    }
  } catch (error) {
    const serializedError = serializeError(error)

    if (serializedError.name === "AbortError") {
      serializedError.message = `Request to ${url} timed out after ${timeoutMs}ms`
    }

    throw serializedError
  } finally {
    clearTimeout(timeout)
  }
}

async function runTransformation(
  script: string | undefined,
  payload: unknown,
  consoleLogs: ConsoleLogEntry[]
): Promise<unknown> {
  if (!script || !script.trim()) {
    return payload
  }

  const vm = new VM({
    timeout: TRANSFORMATION_TIMEOUT_MS,
    sandbox: {
      console: createSandboxConsole(consoleLogs),
    },
    eval: false,
    wasm: false,
  })

  try {
    const runner = vm.run(`module.exports = async (payload) => { ${script}\n }`)

    if (typeof runner !== "function") {
      throw new Error("Transformation script must export a function")
    }

    const result = await runner(deepClone(payload))
    return result ?? payload
  } catch (error) {
    throw serializeError(error)
  }
}

function createSandboxConsole(
  logs: ConsoleLogEntry[]
): Record<ConsoleLevel, (...args: unknown[]) => void> {
  const record = (level: ConsoleLevel, args: unknown[]) => {
    logs.push({
      level,
      message: args.map(formatConsoleArg).join(" "),
      timestamp: new Date().toISOString(),
    })
  }

  return {
    log: (...args: unknown[]) => record("log", args),
    info: (...args: unknown[]) => record("info", args),
    warn: (...args: unknown[]) => record("warn", args),
    error: (...args: unknown[]) => record("error", args),
  }
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === "string") return value
  return safeStringify(value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(error)
  }
}

function deepClone<T>(value: T): T {
  const structured = (
    globalThis as {
      structuredClone?: <U>(input: U) => U
    }
  ).structuredClone

  if (typeof structured === "function") {
    return structured(value)
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    logger.warn("Failed to deep clone value", { error })
    return value
  }
}

function normalizeOutgoingPayload(value: unknown): {
  body: string | Uint8Array
  contentType: string
} {
  if (typeof value === "string") {
    return {
      body: value,
      contentType: "text/plain; charset=utf-8",
    }
  }

  if (value instanceof Uint8Array) {
    return {
      body: value,
      contentType: "application/octet-stream",
    }
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    const copy = new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    )
    return {
      body: copy,
      contentType: "application/octet-stream",
    }
  }

  if (value instanceof ArrayBuffer) {
    return {
      body: new Uint8Array(value),
      contentType: "application/octet-stream",
    }
  }

  try {
    return {
      body: JSON.stringify(value ?? {}),
      contentType: "application/json; charset=utf-8",
    }
  } catch (error) {
    return {
      body: String(error),
      contentType: "text/plain; charset=utf-8",
    }
  }
}

async function persistChannelLog(
  channelRef: FirebaseFirestore.DocumentReference,
  entry: {
    attempts: number
    success: boolean
    statusCode?: number | null
    durationMs?: number | null
    responseBody?: string | null
    responseBytes?: number | null
    responseHeaders?: Record<string, string>
    requestPayload: unknown
    transformedPayload: unknown
    targetUrl: string
    consoleLogs: ConsoleLogEntry[]
    error?: SerializedError | null
  }
) {
  const logRef = channelRef.collection("logs")
  await logRef.add({
    attempts: entry.attempts,
    success: entry.success,
    statusCode: entry.statusCode ?? null,
    durationMs: entry.durationMs ?? null,
    responseBody: entry.responseBody ?? null,
    responseBytes: entry.responseBytes ?? null,
    responseHeaders: entry.responseHeaders ?? {},
    requestPayload: entry.requestPayload ?? null,
    transformedPayload: entry.transformedPayload ?? null,
    targetUrl: entry.targetUrl,
    console: entry.consoleLogs,
    error: entry.error ?? null,
    createdAt: FieldValue.serverTimestamp(),
  })
}

async function updateChannelStats(
  channelRef: FirebaseFirestore.DocumentReference,
  success: boolean,
  durationMs: number | undefined
) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(channelRef)
    if (!snapshot.exists) return

    const data = channelSchema.safeParse(snapshot.data() ?? {})
    if (!data.success) return

    const stats = data.data.stats ?? {}
    const successCount = stats.successCount ?? 0
    const failureCount = stats.failureCount ?? 0
    const totalAttempts = successCount + failureCount

    const updates: Record<string, unknown> = {
      "stats.lastAttemptAt": FieldValue.serverTimestamp(),
      "stats.successCount": success ? successCount + 1 : successCount,
      "stats.failureCount": success ? failureCount : failureCount + 1,
    }

    if (typeof durationMs === "number") {
      const newTotal = totalAttempts + 1
      const currentAverage = stats.avgResponseMs ?? 0
      updates["stats.avgResponseMs"] = Math.round(
        (currentAverage * totalAttempts + durationMs) / newTotal
      )
    }

    transaction.update(channelRef, updates)
  })
}

function normalizeRequestPayload(req: RequestWithRawBody): unknown {
  const body = req.body as unknown
  const contentType = getContentType(req)

  if (Buffer.isBuffer(body)) {
    return parseStringWithContentType(
      body.toString("utf8"),
      contentType,
      "buffer body"
    )
  }

  if (typeof body === "string") {
    return parseStringWithContentType(body, contentType, "string body")
  }

  if (body === undefined || body === null) {
    const parsed = parseRawBody(req.rawBody, contentType)
    return parsed ?? body
  }

  if (
    typeof body === "object" &&
    body !== null &&
    Object.keys(body).length === 0
  ) {
    const parsed = parseRawBody(req.rawBody, contentType)
    if (parsed !== undefined) {
      return parsed
    }
  }

  return body
}

function getContentType(req: RequestWithRawBody): string | undefined {
  if (typeof req.get === "function") {
    const value = req.get("content-type")
    if (value) return value
  }

  const header = req.headers?.["content-type"]
  if (Array.isArray(header)) return header[0]
  return header
}

function parseRawBody(
  rawBody: Buffer | undefined,
  contentType: string | undefined
): unknown {
  if (!rawBody || rawBody.length === 0) {
    return undefined
  }

  return parseStringWithContentType(
    rawBody.toString("utf8"),
    contentType,
    "raw body"
  )
}

function parseStringWithContentType(
  value: string,
  contentType: string | undefined,
  source: string
): unknown {
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(value)
    } catch (error) {
      logger.warn(`Failed to parse ${source} as JSON`, { error })
    }
  }

  return value
}

function resolveChannelSecret(
  channel: z.infer<typeof channelSchema>
): string | null {
  return (
    channel.webhookSecret ??
    channel.secret ??
    channel.token ??
    channel.webhook?.secret ??
    null
  )
}

function resolveTransformationScript(
  channel: z.infer<typeof channelSchema>
): string | undefined {
  return (
    channel.transformationScript ??
    channel.transformation?.script ??
    channel.webhook?.transformationScript ??
    undefined
  )
}

function extractChannelId(path: string): string | null {
  const segments = path.split("/").filter(Boolean)
  const projectsIndex = segments.findIndex((segment) => segment === "projects")

  if (projectsIndex === -1) return null
  if (segments[projectsIndex + 1] !== "webhooks") return null

  const candidate = segments[projectsIndex + 2]
  return candidate ? decodeURIComponent(candidate) : null
}

function serializeError(error: unknown): SerializedError {
  if (error && typeof error === "object" && "message" in error) {
    const err = error as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      name: typeof err.name === "string" ? err.name : "Error",
      message:
        typeof err.message === "string" ? err.message : safeStringify(error),
      stack: typeof err.stack === "string" ? err.stack : undefined,
    }
  }

  return {
    name: "Error",
    message: typeof error === "string" ? error : safeStringify(error),
  }
}
