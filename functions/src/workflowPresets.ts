/**
 * Predefined workflow catalog (server copy). `enableTeamWorkflowPreset`
 * materializes one of these as a `presetKey != null` workflow doc, validated
 * through the same `workflowDraftSchema` as a custom workflow. Keep in sync
 * with the client copy in `src/data/workflowPresets.ts`.
 *
 * Presets carrying `requiresDependency` lean on a feature that does not exist
 * yet (node feedback, content translation) and are REFUSED at enable time.
 * The SEO preset is intentionally omitted.
 */

type PresetTrigger =
  | {
      type: "schedule"
      schedule: { type: "weekly"; dayOfWeek: number; atMinuteUTC: number }
    }
  | { type: "event"; scope: "code" | "write"; debounceMinutes?: number }

export interface ServerWorkflowPreset {
  key: string
  name: string
  description: string
  instructions: string
  additionalPrompt?: string
  defaultTrigger: PresetTrigger
  defaultUpdateMode: "automatic" | "require_review"
  defaultTargetScope: "code" | "write" | null
  requiresDependency?: "feedback" | "translation"
}

const WEEKLY_MON_9AM = {
  type: "weekly" as const,
  dayOfWeek: 1,
  atMinuteUTC: 540,
}

export const WORKFLOW_PRESETS: readonly ServerWorkflowPreset[] = [
  {
    key: "_sync_docs",
    name: "Sync docs from code changes",
    description:
      "When a code file changes, propose matching edits to the docs that " +
      "describe it, citing the source file.",
    instructions: [
      "You keep the workspace's written docs accurate to its code.",
      "1. Read the code node(s) that changed and the related write docs.",
      "2. Identify statements in the docs that the code change has made " +
        "inaccurate (renamed APIs, changed behavior, removed options).",
      "3. Propose minimal edits to the docs that restore accuracy. Cite the " +
        "source code node id for each edit.",
      "4. Do NOT invent features the code doesn't have. If nothing is stale, " +
        "make no changes.",
      "Done when every doc statement about the changed code is accurate.",
    ].join("\n"),
    defaultTrigger: { type: "event", scope: "code", debounceMinutes: 30 },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_changelog",
    name: "Draft changelog",
    description:
      "On a schedule, summarize what changed across the workspace since the " +
      "last run into a designated changelog doc.",
    instructions: [
      "You maintain a running changelog.",
      "1. Review the code and write nodes that changed since your last run.",
      "2. Group the changes into a short, dated entry (Added / Changed / " +
        "Fixed / Removed).",
      "3. Prepend the entry to the changelog doc. Keep older entries intact.",
      "Done when the changelog has one new dated entry covering the period, " +
        "or no entry if nothing meaningful changed.",
    ].join("\n"),
    defaultTrigger: { type: "schedule", schedule: WEEKLY_MON_9AM },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_conversation_gaps",
    name: "Draft improvements from conversations",
    description:
      "Mine recurring questions from assistant chats to find gaps in the " +
      "docs and propose fill-ins.",
    instructions: [
      "You improve the docs based on what people actually ask the assistant.",
      "1. Look for recurring questions or confusion in recent assistant " +
        "sessions for this workspace.",
      "2. For each recurring theme not already well covered, propose a new " +
        "doc section or an edit to an existing doc that answers it.",
      "3. Keep additions concise and grounded in existing content; don't " +
        "duplicate what's already documented.",
      "Done when each recurring question has a clear home in the docs.",
    ].join("\n"),
    defaultTrigger: { type: "schedule", schedule: WEEKLY_MON_9AM },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_grammar",
    name: "Fix grammar & typos",
    description:
      "Correct grammar, spelling, and punctuation in the docs without " +
      "changing meaning.",
    instructions: [
      "You fix grammar, spelling, and punctuation only.",
      "1. Read each target doc.",
      "2. Correct clear grammar, spelling, and punctuation errors.",
      "3. Do NOT rewrite for style, change meaning, or alter product names, " +
        "code identifiers, or technical terms.",
      "Done when the doc is free of grammar/spelling errors with its meaning " +
        "unchanged.",
    ].join("\n"),
    additionalPrompt:
      "Exceptions — never 'correct': product names, trademarks, code " +
      "identifiers, file paths, and intentional technical jargon.",
    defaultTrigger: { type: "event", scope: "write", debounceMinutes: 60 },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_style_guide",
    name: "Apply style guide",
    description:
      "Align docs to the team's writing style guide (tone, voice, formatting " +
      "conventions).",
    instructions: [
      "You apply the team's style guide to the docs.",
      "1. Read each target doc against the style rules below.",
      "2. Adjust tone, voice, heading case, list formatting, and terminology " +
        "to match the rules.",
      "3. Preserve the content's meaning and structure; only change how it's " +
        "expressed.",
      "Done when the doc conforms to every style rule.",
    ].join("\n"),
    additionalPrompt:
      "Style rules: <add your team's rules here, or link a style-guide doc>.",
    defaultTrigger: { type: "event", scope: "write", debounceMinutes: 60 },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_repair_links",
    name: "Repair links",
    description:
      "Find broken inline links in the docs and propose fixes or removals.",
    instructions: [
      "You repair broken links in the docs.",
      "1. Scan each target doc for inline links.",
      "2. Flag links that are clearly broken (malformed, or pointing at a " +
        "node that no longer exists).",
      "3. Propose a corrected target where one is obvious, otherwise propose " +
        "removing the dead link while keeping the surrounding text.",
      "Done when no clearly-broken links remain.",
    ].join("\n"),
    defaultTrigger: { type: "schedule", schedule: WEEKLY_MON_9AM },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_feedback_gaps",
    name: "Draft improvements from user feedback",
    description:
      "Turn reader feedback on docs into proposed improvements. Requires a " +
      "node feedback feature, which doesn't exist yet.",
    instructions:
      "Review reader feedback on each doc and propose edits that address the " +
      "most common or impactful issues.",
    defaultTrigger: { type: "schedule", schedule: WEEKLY_MON_9AM },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
    requiresDependency: "feedback",
  },
  {
    key: "_translate",
    name: "Translate content",
    description:
      "Keep translated copies of docs in sync. Requires node-content " +
      "translation, which doesn't exist yet.",
    instructions:
      "Produce or update a translation of each target doc, preserving " +
      "structure and formatting.",
    defaultTrigger: { type: "event", scope: "write", debounceMinutes: 60 },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
    requiresDependency: "translation",
  },
]

export function getWorkflowPreset(
  key: string
): ServerWorkflowPreset | undefined {
  return WORKFLOW_PRESETS.find((p) => p.key === key)
}
