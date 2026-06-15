/**
 * GitHub connection chat tools (docs/connections-github.prompt.md).
 *
 * Reads (P1, headless-eligible): `gitHub` (search issues/PRs, or fetch one
 * with its comment thread) + `readGitHubFile` (file/dir contents). Writes
 * (P2, confirm-gated, interactive-only): create issue, comment, update issue —
 * all via the shared `runConfirmedConnectionWrite` skeleton.
 *
 * Registration is gated in `pickChatTools` on the published `gitHub`
 * integration doc (`enabledBuiltInTools.has(GITHUB_TOOL_KEY)`); writes
 * additionally require an interactive turn (`allowInterrupts`).
 *
 * Failure doctrine (load-bearing): every failure is RETURNED as tool output,
 * never thrown — a throw aborts the whole turn. All REST via global fetch.
 */

import { z } from "genkit/beta"
import type { BotActionContext } from "./botBuiltinTools.js"
import {
  markBindingNeedsReauth,
  resolveBindingAccessToken,
} from "./connections.js"
import {
  bindingFailureMessage,
  runConfirmedConnectionWrite,
  type ConnectionAppCopy,
  type ConnectionToolRunContext,
} from "./connectionTools.js"
import {
  GITHUB_READ_FILE_TOOL_NAME,
  GITHUB_TOOL_KEY,
  GITHUB_WRITE_TOOL_NAMES,
} from "./domain.js"
import { ai } from "./genkitClient.js"
import {
  buildIssueSearchParams,
  compactIssueDetail,
  compactIssues,
  parseFileTarget,
  parseRepoRef,
  shapeFileContents,
  triageGitHubFailure,
  validateCommentDraft,
  validateIssueDraft,
  validateIssueUpdateDraft,
  type GitHubErrorInfo,
} from "./githubCore.js"

const GITHUB_API = "https://api.github.com"

const GITHUB_COPY: ConnectionAppCopy = {
  app: "GitHub",
  api: "GitHub API",
  scopeNoun: "repository",
}

// ─── Fetch plumbing ──────────────────────────────────────────────────────────

const githubHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  // GitHub rejects requests without a User-Agent.
  "User-Agent": "lectornaut-connections",
  "X-GitHub-Api-Version": "2022-11-28",
})

interface GithubResponse {
  status: number
  body: unknown
  rateLimitRemaining: number | null
}

async function githubFetch(
  url: string,
  token: string,
  init?: { method?: string; body?: string }
): Promise<GithubResponse | { error: string }> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        ...githubHeaders(token),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init?.body ? { body: init.body } : {}),
    })
    const header = response.headers.get("x-ratelimit-remaining")
    const remaining = header === null ? null : Number(header)
    const body = await response.json().catch(() => null)
    return {
      status: response.status,
      body,
      rateLimitRemaining: Number.isFinite(remaining) ? remaining : null,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const githubMessage = (body: unknown): string | null =>
  typeof body === "object" &&
  body !== null &&
  typeof (body as Record<string, unknown>).message === "string"
    ? ((body as Record<string, unknown>).message as string)
    : null

/**
 * Turn a non-2xx GitHub response into a model-facing message, flipping the
 * binding to `needs_reauth` on a 401 (the revocation-detection seam — a
 * non-expiring token never hits the refresh path where this normally fires).
 */
async function failureFromResponse(
  res: GithubResponse,
  teamId: string,
  uid: string | undefined
): Promise<string> {
  const info: GitHubErrorInfo = {
    status: res.status,
    rateLimitRemaining: res.rateLimitRemaining,
    message: githubMessage(res.body),
  }
  const triage = triageGitHubFailure(info)
  if (triage.kind === "needs_reauth" && uid) {
    await markBindingNeedsReauth(teamId, "github", uid)
  }
  return triage.message
}

// ─── Read: gitHub (search issues/PRs, or fetch one) ──────────────────────────

const compactIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  isPullRequest: z.boolean(),
  repo: z.string().nullable(),
  author: z.string().nullable(),
  commentCount: z.number(),
  url: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const issueDetailSchema = compactIssueSchema.extend({
  body: z.string().nullable(),
  comments: z.array(
    z.object({ author: z.string().nullable(), body: z.string() })
  ),
})

const gitHubOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  issues: z.array(compactIssueSchema),
  issue: issueDetailSchema.nullable(),
  retrievedAt: z.string(),
})

const gitHubInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Free-text search across issues and pull requests (GitHub search " +
        "syntax allowed). Omit when fetching a specific item by number."
    ),
  repo: z
    .string()
    .optional()
    .describe("Scope to one repo as 'owner/name' or a GitHub URL."),
  state: z
    .string()
    .optional()
    .describe("Filter by 'open' or 'closed'. Omit for both."),
  issueNumber: z
    .number()
    .optional()
    .describe(
      "Fetch this issue or pull request (with its comments) — requires repo."
    ),
  maxResults: z
    .number()
    .optional()
    .describe("How many results to return (1-25, default 10)."),
})

const readFailure = (message: string) => ({
  ok: false,
  message,
  issues: [],
  issue: null,
  retrievedAt: new Date().toISOString(),
})

export const gitHubTool = ai.defineTool(
  {
    name: GITHUB_TOOL_KEY,
    description:
      "Search GitHub issues and pull requests on the user's connected " +
      "account, or fetch one specific issue/PR with its comment thread. " +
      'Use it for "what issues are open about X", "summarize PR #42 in ' +
      'owner/repo", "find the bug report about Y". Read-only. Pass repo + ' +
      "issueNumber to fetch one item; otherwise pass a query. If the result " +
      "says GitHub isn't connected, relay that and point to Settings → " +
      "Connections.",
    inputSchema: gitHubInputSchema,
    outputSchema: gitHubOutputSchema,
  },
  async (input, { context }) => {
    const ctx = context as BotActionContext | undefined
    const teamId = ctx?.teamId
    if (!teamId) {
      return readFailure(
        "GitHub is unavailable in this context (no team bound to the " +
          "conversation)."
      )
    }
    // Interactive turns act as the chatting user; headless runs fall back to
    // the run's pre-validated actsAsUid (P3).
    const uid = ctx?.auth?.uid || ctx?.connectionsActsAsUid || undefined
    const token = await resolveBindingAccessToken(teamId, "github", uid)
    if (!token.ok) {
      return readFailure(bindingFailureMessage(token.reason, GITHUB_COPY))
    }

    // Fetch-one mode: repo + issueNumber → the issue/PR with its comments.
    if (typeof input.issueNumber === "number" && input.repo) {
      const ref = parseRepoRef(input.repo)
      if (!ref) {
        return readFailure("Couldn't parse repo — use 'owner/name'.")
      }
      const base = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/issues/${input.issueNumber}`
      const issueRes = await githubFetch(base, token.accessToken)
      if ("error" in issueRes) {
        return readFailure(`GitHub request failed (${issueRes.error}).`)
      }
      if (issueRes.status < 200 || issueRes.status >= 300) {
        return readFailure(await failureFromResponse(issueRes, teamId, uid))
      }
      // Fetch the 20 MOST RECENT comments (desc), then reverse to chrono for
      // display — a long thread's latest discussion is what "summarize this
      // issue" needs, not its oldest 20.
      const commentsRes = await githubFetch(
        `${base}/comments?per_page=20&sort=created&direction=desc`,
        token.accessToken
      )
      const comments =
        !("error" in commentsRes) &&
        commentsRes.status >= 200 &&
        commentsRes.status < 300 &&
        Array.isArray(commentsRes.body)
          ? [...(commentsRes.body as unknown[])].reverse()
          : []
      const issue = compactIssueDetail(issueRes.body, comments)
      return {
        ok: true,
        message: issue
          ? `${ref.owner}/${ref.repo}#${input.issueNumber}: ${issue.title}`
          : "Item fetched.",
        issues: [],
        issue,
        retrievedAt: new Date().toISOString(),
      }
    }

    // Search mode.
    const params = buildIssueSearchParams(input)
    if (!params.q) {
      return readFailure(
        "Provide a search query or a repo (GitHub needs a non-empty search)."
      )
    }
    const url = new URL(`${GITHUB_API}/search/issues`)
    url.searchParams.set("q", params.q)
    url.searchParams.set("per_page", String(params.maxResults))
    const res = await githubFetch(url.toString(), token.accessToken)
    if ("error" in res) {
      return readFailure(`GitHub request failed (${res.error}).`)
    }
    if (res.status < 200 || res.status >= 300) {
      return readFailure(await failureFromResponse(res, teamId, uid))
    }
    const items =
      typeof res.body === "object" && res.body !== null
        ? (res.body as Record<string, unknown>).items
        : null
    const issues = compactIssues(items, params.maxResults)
    return {
      ok: true,
      message:
        issues.length === 0
          ? "No matching issues or pull requests found."
          : `${issues.length} result(s).`,
      issues,
      issue: null,
      retrievedAt: new Date().toISOString(),
    }
  }
)

// ─── Read: readGitHubFile ────────────────────────────────────────────────────

const readFileOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** "file" or "dir" when ok; null on failure. */
  kind: z.string().nullable(),
  /** File text or directory listing; null for binaries / failures. */
  content: z.string().nullable(),
  retrievedAt: z.string(),
})

const readFileInputSchema = z.object({
  repo: z
    .string()
    .describe(
      "Repo as 'owner/name', OR a full GitHub file URL " +
        "(https://github.com/owner/name/blob/ref/path) which carries the " +
        "ref + path itself."
    ),
  path: z
    .string()
    .optional()
    .describe("File or directory path in the repo. Omit for the repo root."),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA. Omit for the default branch."),
})

const readFileFailure = (message: string) => ({
  ok: false,
  message,
  kind: null,
  content: null,
  retrievedAt: new Date().toISOString(),
})

export const readGitHubFileTool = ai.defineTool(
  {
    name: GITHUB_READ_FILE_TOOL_NAME,
    description:
      "Read a file's contents (or list a directory) from a repo on the " +
      "user's connected GitHub. Use it to answer questions from the code or " +
      "docs — e.g. read a README, a config file, or list a folder. Accepts " +
      "'owner/name' + path, or a pasted GitHub file URL.",
    inputSchema: readFileInputSchema,
    outputSchema: readFileOutputSchema,
  },
  async (input, { context }) => {
    const ctx = context as BotActionContext | undefined
    const teamId = ctx?.teamId
    if (!teamId) {
      return readFileFailure(
        "GitHub is unavailable in this context (no team bound)."
      )
    }
    const uid = ctx?.auth?.uid || ctx?.connectionsActsAsUid || undefined
    const token = await resolveBindingAccessToken(teamId, "github", uid)
    if (!token.ok) {
      return readFileFailure(bindingFailureMessage(token.reason, GITHUB_COPY))
    }
    const target = parseFileTarget(input.repo, input.path, input.ref)
    if (!target) {
      return readFileFailure(
        "Couldn't parse the repo/path — use 'owner/name' with a path, or a " +
          "GitHub file URL."
      )
    }
    // Percent-encode each path segment so a `?` or `#` in a filename can't
    // leak into the URL's query/fragment and request the wrong resource.
    const encodedPath = target.path.split("/").map(encodeURIComponent).join("/")
    const url = new URL(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/contents/${encodedPath}`
    )
    if (target.ref) url.searchParams.set("ref", target.ref)
    const res = await githubFetch(url.toString(), token.accessToken)
    if ("error" in res) {
      return readFileFailure(`GitHub request failed (${res.error}).`)
    }
    if (res.status < 200 || res.status >= 300) {
      return readFileFailure(await failureFromResponse(res, teamId, uid))
    }
    const shaped = shapeFileContents(res.body)
    if (!shaped) {
      return readFileFailure("GitHub returned an unreadable response.")
    }
    return {
      ok: true,
      message:
        shaped.note ??
        (shaped.kind === "dir"
          ? `Directory listing for ${target.path || "/"}.`
          : `Contents of ${target.owner}/${target.repo}/${target.path}.`),
      kind: shaped.kind,
      content: shaped.content,
      retrievedAt: new Date().toISOString(),
    }
  }
)

// ─── Writes (P2 — confirm-gated, interactive-only) ───────────────────────────

type GitHubWriteOutcome = "written" | "declined" | "failed"

interface GitHubWriteResult {
  ok: boolean
  outcome: GitHubWriteOutcome
  message: string
  item: {
    number: number | null
    url: string | null
    title: string | null
  } | null
  retrievedAt: string
}

const githubWriteFailure = (
  message: string,
  outcome: "declined" | "failed" = "failed"
): GitHubWriteResult => ({
  ok: false,
  outcome,
  message,
  item: null,
  retrievedAt: new Date().toISOString(),
})

const githubWriteOutputSchema = z.object({
  ok: z.boolean(),
  outcome: z.enum(["written", "declined", "failed"]),
  message: z.string(),
  item: z
    .object({
      number: z.number().nullable(),
      url: z.string().nullable(),
      title: z.string().nullable(),
    })
    .nullable(),
  retrievedAt: z.string(),
})

/** GitHub adapter over the generic confirm-gated write skeleton. */
function runConfirmedGitHubWrite(opts: {
  ctx: ConnectionToolRunContext
  problems: string[]
  execute: (accessToken: string) => Promise<GitHubWriteResult>
  declineMessage: string
  cannotMessage: string
}): Promise<GitHubWriteResult> {
  return runConfirmedConnectionWrite<GitHubWriteResult>({
    ...opts,
    provider: "github",
    copy: GITHUB_COPY,
    // No OAuth scope gate — a GitHub App's granted permissions + installed
    // repos govern access; an insufficient permission surfaces as a 403 at
    // the API call, triaged into a narratable message.
    requiredScope: null,
    missingScopeMessage: "",
    confirmKind: "gitHubWrite",
    unavailableMessage:
      "GitHub writes are unavailable in this context (no team bound).",
    fail: githubWriteFailure,
  })
}

/** POST/PATCH a GitHub write and shape the result (or a triaged failure). */
async function executeGitHubWrite(opts: {
  ctx: ConnectionToolRunContext
  url: string
  method: "POST" | "PATCH"
  accessToken: string
  payload: Record<string, unknown>
  success: (item: GitHubWriteResult["item"]) => string
}): Promise<GitHubWriteResult> {
  const actionContext = opts.ctx.context as BotActionContext | undefined
  const teamId = actionContext?.teamId ?? ""
  const uid = actionContext?.auth?.uid || undefined
  const res = await githubFetch(opts.url, opts.accessToken, {
    method: opts.method,
    body: JSON.stringify(opts.payload),
  })
  if ("error" in res) {
    return githubWriteFailure(`GitHub request failed (${res.error}).`)
  }
  if (res.status < 200 || res.status >= 300) {
    return githubWriteFailure(await failureFromResponse(res, teamId, uid))
  }
  const raw =
    typeof res.body === "object" && res.body !== null
      ? (res.body as Record<string, unknown>)
      : {}
  const item = {
    number: typeof raw.number === "number" ? raw.number : null,
    url: typeof raw.html_url === "string" ? raw.html_url : null,
    title: typeof raw.title === "string" ? raw.title : null,
  }
  return {
    ok: true,
    outcome: "written",
    message: opts.success(item),
    item,
    retrievedAt: new Date().toISOString(),
  }
}

const createIssueInputSchema = z.object({
  repo: z
    .string()
    .optional()
    .describe("Target repo as 'owner/name' (required)."),
  title: z.string().optional().describe("Issue title (required)."),
  body: z.string().optional().describe("Issue body (markdown)."),
  labels: z.array(z.string()).optional().describe("Optional labels to apply."),
})

export const createGitHubIssueTool = ai.defineTool(
  {
    name: GITHUB_WRITE_TOOL_NAMES[0],
    description:
      "Create a new issue in a repo on the user's connected GitHub. The " +
      "user is shown the exact issue and must approve it before anything is " +
      "filed. Use it to turn a bug report or task from the conversation into " +
      "a tracked issue.",
    inputSchema: createIssueInputSchema,
    outputSchema: githubWriteOutputSchema,
  },
  async (input, ctx) => {
    const draft = validateIssueDraft(input)
    return runConfirmedGitHubWrite({
      ctx,
      problems: draft.problems,
      declineMessage:
        "The user declined creating this issue. Don't file it; ask what " +
        "they'd like to change.",
      cannotMessage: "Can't create this issue yet",
      execute: (accessToken) =>
        executeGitHubWrite({
          ctx,
          method: "POST",
          url: `${GITHUB_API}/repos/${draft.payload.repo.owner}/${draft.payload.repo.repo}/issues`,
          accessToken,
          payload: draft.payload.body,
          success: (item) =>
            `Created issue ${item?.url ?? `#${item?.number}`}.`,
        }),
    })
  }
)

const commentInputSchema = z.object({
  repo: z.string().optional().describe("Repo as 'owner/name' (required)."),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue or pull request number to comment on (required)."),
  body: z.string().optional().describe("Comment body, markdown (required)."),
})

export const addGitHubCommentTool = ai.defineTool(
  {
    name: GITHUB_WRITE_TOOL_NAMES[1],
    description:
      "Add a comment to an issue or pull request on the user's connected " +
      "GitHub (PRs accept issue comments). The user approves the exact " +
      "comment before it's posted.",
    inputSchema: commentInputSchema,
    outputSchema: githubWriteOutputSchema,
  },
  async (input, ctx) => {
    const draft = validateCommentDraft(input)
    return runConfirmedGitHubWrite({
      ctx,
      problems: draft.problems,
      declineMessage:
        "The user declined posting this comment. Don't post it; ask what " +
        "they'd like to change.",
      cannotMessage: "Can't post this comment yet",
      execute: (accessToken) =>
        executeGitHubWrite({
          ctx,
          method: "POST",
          url: `${GITHUB_API}/repos/${draft.payload.repo.owner}/${draft.payload.repo.repo}/issues/${draft.payload.issueNumber}/comments`,
          accessToken,
          payload: draft.payload.body,
          success: (item) =>
            `Posted comment${item?.url ? ` (${item.url})` : ""}.`,
        }),
    })
  }
)

const updateIssueInputSchema = z.object({
  repo: z.string().optional().describe("Repo as 'owner/name' (required)."),
  issueNumber: z.number().optional().describe("Issue number (required)."),
  state: z
    .string()
    .optional()
    .describe("Set to 'closed' to close or 'open' to reopen."),
  labels: z
    .array(z.string())
    .optional()
    .describe("Replace the issue's labels with this set."),
})

export const updateGitHubIssueTool = ai.defineTool(
  {
    name: GITHUB_WRITE_TOOL_NAMES[2],
    description:
      "Update an existing issue on the user's connected GitHub — close or " +
      "reopen it, or set its labels. The user approves the change first.",
    inputSchema: updateIssueInputSchema,
    outputSchema: githubWriteOutputSchema,
  },
  async (input, ctx) => {
    const draft = validateIssueUpdateDraft(input)
    return runConfirmedGitHubWrite({
      ctx,
      problems: draft.problems,
      declineMessage:
        "The user declined this change. Don't apply it; ask what they'd " +
        "like to do instead.",
      cannotMessage: "Can't update this issue yet",
      execute: (accessToken) =>
        executeGitHubWrite({
          ctx,
          method: "PATCH",
          url: `${GITHUB_API}/repos/${draft.payload.repo.owner}/${draft.payload.repo.repo}/issues/${draft.payload.issueNumber}`,
          accessToken,
          payload: draft.payload.body,
          success: (item) =>
            `Updated issue ${item?.url ?? `#${item?.number}`}.`,
        }),
    })
  }
)
