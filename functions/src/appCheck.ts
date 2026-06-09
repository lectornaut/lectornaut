import { getAppCheck } from "firebase-admin/app-check"
import * as logger from "firebase-functions/logger"
import { HttpsError, onRequest } from "firebase-functions/v2/https"
import { createHmac, timingSafeEqual } from "node:crypto"
import { APP_CHECK_OPTS } from "./runtimeConfig.js"
import {
  appCheckAllowedAppId,
  appCheckExchangeSharedSecret,
} from "./secrets.js"

const APP_CHECK_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
const MAX_CLIENT_CLOCK_SKEW_MS = 5 * 60 * 1000 // 5 minutes

interface ExchangeTokenRequestBody {
  appId?: unknown
  timestampMs?: unknown
  nonce?: unknown
  signature?: unknown
}

interface ExchangeTokenResponseBody {
  token: string
  expireTimeMillis: number
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const parseRequestBody = (rawBody: unknown): ExchangeTokenRequestBody => {
  if (!rawBody) return {}

  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody) as ExchangeTokenRequestBody
    } catch {
      return {}
    }
  }

  if (typeof rawBody === "object") {
    return rawBody as ExchangeTokenRequestBody
  }

  return {}
}

const createExpectedSignature = (
  secret: string,
  appId: string,
  timestampMs: number,
  nonce: string
) => {
  const payload = `${appId}:${timestampMs}:${nonce}`
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

const isSafeEqual = (a: string, b: string) => {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes)
}

const getHttpStatusForHttpsError = (code: HttpsError["code"]) => {
  switch (code) {
    case "invalid-argument":
      return 400
    case "permission-denied":
      return 403
    case "deadline-exceeded":
      return 408
    case "failed-precondition":
      return 412
    case "internal":
      return 500
    default:
      return 400
  }
}

/**
 * Exchanges a native Tauri proof for a Firebase App Check token.
 *
 * This endpoint is intentionally not App Check-protected (bootstrap path).
 * Integrity is enforced by validating an HMAC signature issued by the native layer.
 */
export const exchangeTauriAppCheckToken = onRequest(
  {
    ...APP_CHECK_OPTS,
    invoker: "public",
    cors: true,
    secrets: [appCheckExchangeSharedSecret, appCheckAllowedAppId],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "Method not allowed" })
      return
    }

    try {
      const secret = appCheckExchangeSharedSecret.value()
      const allowedAppId = appCheckAllowedAppId.value()

      if (!isNonEmptyString(secret) || !isNonEmptyString(allowedAppId)) {
        logger.error("App Check exchange secret/appId is not configured")
        throw new HttpsError("failed-precondition", "Server misconfiguration")
      }

      const body = parseRequestBody(request.body)
      const appId = body.appId
      const timestampMs = body.timestampMs
      const nonce = body.nonce
      const signature = body.signature

      if (
        !isNonEmptyString(appId) ||
        typeof timestampMs !== "number" ||
        !Number.isFinite(timestampMs) ||
        !isNonEmptyString(nonce) ||
        !isNonEmptyString(signature)
      ) {
        throw new HttpsError("invalid-argument", "Invalid token exchange body")
      }

      if (appId !== allowedAppId) {
        throw new HttpsError("permission-denied", "Unknown app id")
      }

      const skewMs = Math.abs(Date.now() - timestampMs)
      if (skewMs > MAX_CLIENT_CLOCK_SKEW_MS) {
        throw new HttpsError("deadline-exceeded", "Proof timestamp expired")
      }

      if (nonce.length < 8 || nonce.length > 200) {
        throw new HttpsError("invalid-argument", "Invalid nonce")
      }

      const expected = createExpectedSignature(
        secret,
        appId,
        timestampMs,
        nonce
      )
      if (!isSafeEqual(signature, expected)) {
        throw new HttpsError("permission-denied", "Invalid proof signature")
      }

      const token = await getAppCheck().createToken(appId, {
        ttlMillis: APP_CHECK_TOKEN_TTL_MS,
      })

      const payload: ExchangeTokenResponseBody = {
        token: token.token,
        expireTimeMillis: Date.now() + token.ttlMillis,
      }

      response.status(200).json(payload)
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const httpsError =
        error instanceof HttpsError
          ? error
          : new HttpsError(
              "internal",
              `Unable to exchange App Check token: ${rawMessage}`
            )

      logger.error("App Check token exchange failed", {
        origin: request.get("origin") ?? null,
        message: rawMessage,
        stack: error instanceof Error ? error.stack : null,
      })

      logger.warn("App Check token exchange rejected", {
        code: httpsError.code,
        message: httpsError.message,
        origin: request.get("origin") ?? null,
      })

      response.status(getHttpStatusForHttpsError(httpsError.code)).json({
        error: httpsError.message,
        code: httpsError.code,
      })
    }
  }
)
