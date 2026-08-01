/**
 * Custom-tool runtime — the dispatch-time factory that turns a stored custom
 * tool into a live Genkit tool.
 *
 * Custom-tool CRUD + lifecycle moved to the unified integrations surface
 * (`integrations.ts`, `teams/{teamId}/integrations`, `type == "tool"`). What
 * remains here is the canonical `TeamCustomToolDoc` shape + `buildCustomToolForChat`:
 * `bot.ts` resolves each dispatchable tool integration to a `TeamCustomToolDoc`
 * and calls this to produce a `tool()` whose handler dispatches by action
 * `kind` (httpWebhook | constant | promptTemplate | workspaceSearch).
 */

import { logger } from "firebase-functions/v2"
import { HttpsError } from "firebase-functions/v2/https"
import { tool, z } from "genkit/beta"
import type { BotActionContext } from "./botBuiltinTools.js"
import { searchWorkspaceNodesTool } from "./botRag.js"
import {
  ai,
  type AiModelProvider,
  isAiModelProviderConfigured,
  resolveModel,
} from "./genkitClient.js"
import type { WorkspaceNodeScope } from "./types.js"

// ─── Types ──────────────────────────────────────────────────────────────────

export type CustomToolFieldType = "string" | "number" | "boolean"

export interface CustomToolField {
  name: string
  type: CustomToolFieldType
  description: string
  required: boolean
}

export type CustomToolAction =
  | {
      kind: "httpWebhook"
      url: string
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
      headers: Array<{ name: string; value: string }>
      bodyTemplate: string
      maxResponseBytes: number
      timeoutMs: number
    }
  | { kind: "constant"; value: string }
  | { kind: "promptTemplate"; prompt: string; model: string | null }
  | {
      kind: "workspaceSearch"
      scope: WorkspaceNodeScope | null
      defaultLimit: number
      filterHint: string
    }

export type CustomToolActionKind = CustomToolAction["kind"]

export interface TeamCustomToolDoc {
  id: string
  teamId: string
  name: string
  displayName: string
  description: string
  avatarSeed: string
  inputSchema: { fields: CustomToolField[] }
  outputSchema: { fields: CustomToolField[] }
  action: CustomToolAction
  enabled: boolean
  archivedAt: FirebaseFirestore.Timestamp | null
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  createdByUid: string
}

// ─── Schema → Zod mapping for Genkit ────────────────────────────────────────

/**
 * Convert a stored field list into a Zod object schema usable by
 * `ai.defineTool`. Required fields are kept required; optional fields
 * become `.optional()`. `.describe(...)` is attached so the model sees
 * the per-field description in its tool catalog.
 */
function fieldsToZodObject(
  fields: ReadonlyArray<CustomToolField>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    let base: z.ZodTypeAny
    switch (field.type) {
      case "number":
        base = z.number()
        break
      case "boolean":
        base = z.boolean()
        break
      case "string":
      default:
        base = z.string()
        break
    }
    const desc = field.description ? base.describe(field.description) : base
    shape[field.name] = field.required ? desc : desc.optional()
  }
  return z.object(shape)
}

// ─── Template interpolation ─────────────────────────────────────────────────

/**
 * Substitute `{{fieldName}}` markers in a template string with the
 * model's tool-input values. Missing keys interpolate to "" rather
 * than throwing — keeps templates resilient when the model omits an
 * optional field. The replacer trims interior whitespace inside the
 * markers so `{{ name }}` works identically to `{{name}}`.
 */
function interpolateTemplate(
  template: string,
  input: Record<string, unknown>
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_m, k) => {
      const value = input[k]
      if (value === undefined || value === null) return ""
      if (typeof value === "object") {
        try {
          return JSON.stringify(value)
        } catch {
          return ""
        }
      }
      return String(value)
    }
  )
}

// ─── Action handlers ────────────────────────────────────────────────────────

async function executeHttpWebhook(
  action: Extract<CustomToolAction, { kind: "httpWebhook" }>,
  input: Record<string, unknown>
): Promise<unknown> {
  const headers: Record<string, string> = {}
  for (const h of action.headers) {
    headers[h.name] = interpolateTemplate(h.value, input)
  }
  const init: RequestInit & { signal?: AbortSignal } = {
    method: action.method,
    headers,
  }
  if (action.method !== "GET") {
    init.body = interpolateTemplate(action.bodyTemplate, input)
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json"
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), action.timeoutMs)
  init.signal = controller.signal
  try {
    const url = interpolateTemplate(action.url, input)
    const res = await fetch(url, init)
    const buf = await res.arrayBuffer()
    const limited =
      buf.byteLength > action.maxResponseBytes
        ? buf.slice(0, action.maxResponseBytes)
        : buf
    const text = new TextDecoder().decode(limited)
    // Best-effort JSON parse — if the response is plain text the model
    // gets the string verbatim, which is usually what it wants for
    // text-returning APIs (status pages, weather, etc.).
    try {
      return {
        status: res.status,
        ok: res.ok,
        body: JSON.parse(text),
        truncated: buf.byteLength > action.maxResponseBytes,
      }
    } catch {
      return {
        status: res.status,
        ok: res.ok,
        body: text,
        truncated: buf.byteLength > action.maxResponseBytes,
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpsError(
        "deadline-exceeded",
        `HTTP webhook timed out after ${action.timeoutMs}ms.`
      )
    }
    throw new HttpsError(
      "unavailable",
      `HTTP webhook failed: ${err instanceof Error ? err.message : "unknown"}`
    )
  } finally {
    clearTimeout(timer)
  }
}

function executeConstant(
  action: Extract<CustomToolAction, { kind: "constant" }>
): unknown {
  // Try parsing as JSON for a structured return; fall back to the raw
  // string so admins can ship plain-text tools too.
  try {
    return JSON.parse(action.value)
  } catch {
    return action.value
  }
}

async function executePromptTemplate(
  action: Extract<CustomToolAction, { kind: "promptTemplate" }>,
  input: Record<string, unknown>,
  context: BotActionContext | undefined
): Promise<unknown> {
  const prompt = interpolateTemplate(action.prompt, input)
  // Pick the wire-name in priority order:
  //   1. Admin-specified override (if the provider is still configured).
  //   2. The chat's current effective model (post-clamp; threaded
  //      through via `BotActionContext.effectiveModel`).
  //   3. A hardcoded Flash fallback so the call doesn't blow up on
  //      legacy code paths that never set `effectiveModel`.
  let modelName: string
  const adminProvider = action.model ? modelProvider(action.model) : null
  if (
    action.model &&
    adminProvider &&
    isAiModelProviderConfigured(adminProvider)
  ) {
    modelName = action.model
  } else if (context?.effectiveModel) {
    modelName = context.effectiveModel
  } else {
    modelName = "gemini-3.6-flash"
  }
  // The generation call deliberately avoids `output: { schema }`
  // because the tool's outputSchema is admin-defined and may be
  // free-form; returning the raw text and letting the model parse it
  // is more flexible than forcing a structured shape it might not
  // match.
  try {
    const result = await ai.generate({
      model: resolveModel(modelName),
      prompt,
    })
    return { text: result.text }
  } catch (err) {
    logger.warn("[customTools] promptTemplate failed", err)
    throw new HttpsError(
      "internal",
      `Prompt template tool failed: ${err instanceof Error ? err.message : "unknown"}`
    )
  }
}

async function executeWorkspaceSearch(
  action: Extract<CustomToolAction, { kind: "workspaceSearch" }>,
  input: Record<string, unknown>,
  context: BotActionContext | undefined
): Promise<unknown> {
  // The model's tool input must include `query` (we add it
  // automatically to the schema below). The action's `filterHint`
  // prepends to the query so the model effectively searches against
  // the admin-narrowed topic.
  const baseQuery = typeof input.query === "string" ? input.query : ""
  const fullQuery = action.filterHint
    ? `${action.filterHint} ${baseQuery}`.trim()
    : baseQuery
  // `searchWorkspaceNodesTool` is itself a Genkit tool — invoke it as
  // a function (Genkit tools expose a callable interface). Pass the
  // workspace-aware action context so the underlying retriever
  // resolves the correct collection. `null` (admin chose "both")
  // maps to the literal "both" the underlying tool expects.
  return await searchWorkspaceNodesTool(
    {
      query: fullQuery,
      scope: action.scope ?? "both",
      limit: action.defaultLimit,
    },
    { context }
  )
}

/**
 * Provider for a wire-name, or `null` for an unknown prefix. Local
 * variant of `getModelProvider` (which throws on unknown); we want a
 * silent "not configured → fall back to chat model" branch, not an
 * exception bubbling up from a tool call mid-turn.
 */
function modelProvider(modelId: string): AiModelProvider | null {
  if (modelId.startsWith("gemini-")) return "google"
  if (modelId.startsWith("claude-")) return "anthropic"
  if (modelId.startsWith("gpt-")) return "openai"
  if (modelId.startsWith("grok-")) return "xai"
  if (modelId.startsWith("deepseek-")) return "deepseek"
  return null
}

// ─── Genkit tool factory ────────────────────────────────────────────────────

/**
 * Build a dynamic Genkit tool from a stored doc. Called once per
 * relevant tool per chat turn from `bot.ts::pickChatTools`. The
 * construction is per-turn (not module-scope) because each tool's
 * schema is admin-defined and may change between turns — caching
 * across turns would either need invalidation tied to the cache TTL
 * (complex) or risk stale schemas (worse).
 *
 * Uses `tool()` (not `ai.defineTool()`) for the registration. The
 * distinction is load-bearing for per-turn dynamic tools:
 *
 *   - `ai.defineTool(...)` registers the tool in Genkit's GLOBAL
 *     registry by name. Intended for module-load static tools
 *     (`rollDiceTool`, `summarizeNodeTool`, etc.). Calling it more
 *     than once with the same name within a single process either
 *     throws or leaves stale registry state — the wrong primitive
 *     when the same admin-authored name re-appears every turn.
 *
 *   - `tool(...)` (the modern API; `dynamicTool` is the deprecated
 *     alias) returns a `DynamicToolAction` that's NOT added to the
 *     registry. The model still sees it on this turn because it's
 *     passed inline via `session.chat({ tools })`, but there's no
 *     persistent registration that conflicts with the next turn's
 *     re-creation.
 *
 * Previously this used `ai.defineTool` which silently produced the
 * symptom "tool card never appears" from turn 2 onward — first turn
 * succeeded (registry was empty), subsequent turns failed to register
 * cleanly so the model saw a stale/missing tool catalog.
 *
 * `workspaceSearch` tools have a hardcoded `query: string` input
 * appended to whatever the admin defined, so the model always knows
 * what to send. Other action types take whatever the admin's input
 * schema specifies (or `{}` for a tool with no inputs).
 */
export function buildCustomToolForChat(doc: TeamCustomToolDoc) {
  // For workspaceSearch tools we INJECT a `query` field so the model
  // always has a way to pass the natural-language search string. The
  // admin's input fields can still be added on top (e.g. an extra
  // filter); reserved field name `query` is documented in the editor.
  const baseInputFields: CustomToolField[] =
    doc.action.kind === "workspaceSearch"
      ? [
          {
            name: "query",
            type: "string",
            description: "Natural-language search query.",
            required: true,
          },
          ...doc.inputSchema.fields.filter((f) => f.name !== "query"),
        ]
      : doc.inputSchema.fields

  const inputZod = fieldsToZodObject(baseInputFields)
  // OutputSchema is intentionally `z.any()` rather than the
  // admin-defined shape. The model only USES the output text the
  // handler returns; forcing a strict shape risks rejecting valid
  // payloads (HTTP webhook returning a string when admins typed it
  // as `object`, prompt-template returning structured-but-unexpected
  // shape). Treat the admin's outputSchema as documentation for the
  // model, surfaced via `.describe` on the tool description.
  const outputDescription =
    doc.outputSchema.fields.length > 0
      ? `Returns: ${doc.outputSchema.fields
          .map(
            (f) =>
              `\`${f.name}\` (${f.type})${f.description ? ` — ${f.description}` : ""}`
          )
          .join(", ")}.`
      : "Returns the tool's response."

  return tool(
    {
      name: doc.name,
      description: `${doc.description}\n\n${outputDescription}`,
      inputSchema: inputZod,
      outputSchema: z.any(),
    },
    async (input, { context }) => {
      const ctx = context as BotActionContext | undefined
      const inputObj = input as Record<string, unknown>
      switch (doc.action.kind) {
        case "httpWebhook":
          return executeHttpWebhook(doc.action, inputObj)
        case "constant":
          return executeConstant(doc.action)
        case "promptTemplate":
          return executePromptTemplate(doc.action, inputObj, ctx)
        case "workspaceSearch":
          return executeWorkspaceSearch(doc.action, inputObj, ctx)
      }
    }
  )
}
