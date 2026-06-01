/**
 * Predefined workflow catalog — the browse-and-toggle templates on the
 * Workflows page. Each preset is a pre-filled instance of the one
 * `workflowSchema` (carrying a non-null `presetKey`); enabling it materializes
 * a real workflow doc via `enableTeamWorkflowPreset`, so predefined and custom
 * workflows validate + run through the exact same path.
 *
 * Dependency gating: presets whose feature doesn't exist yet (node feedback,
 * node-content translation) carry `requiresDependency` and are rendered
 * DISABLED until that dependency ships — they never seed a runnable workflow.
 * The SEO preset is intentionally omitted (Lectornaut has no public-publishing
 * surface). Keep this list in sync with the server copy in
 * `functions/src/workflowPresets.ts`.
 */

import type {
  WorkflowTriggerInput,
  WorkflowUpdateModeInput,
} from "@/composables/useFunctions"

export type WorkflowPresetCategory = "self_updating" | "maintenance"

/** A net-new feature a preset leans on that does not exist in the app yet. */
export type WorkflowPresetDependency = "feedback" | "translation"

export interface WorkflowPreset {
  /** Stable `presetKey` persisted on the materialized workflow doc. */
  key: string
  name: string
  description: string
  category: WorkflowPresetCategory
  /** Default procedure the agent follows (authors can edit after enabling). */
  instructions: string
  additionalPrompt?: string
  defaultTrigger: WorkflowTriggerInput
  /** Predefined workflows default to human-gated review (cost-bounded). */
  defaultUpdateMode: WorkflowUpdateModeInput
  /** Tree the workflow edits; null = the workspace's `write` tree. */
  defaultTargetScope: "code" | "write" | null
  /**
   * When set, the underlying feature isn't built — the preset is shown
   * disabled with an explanation and cannot be enabled.
   */
  requiresDependency?: WorkflowPresetDependency
}

export const WORKFLOW_PRESETS: readonly WorkflowPreset[] = [
  // ── Self-updating: keep `write` docs accurate to a source ────────────────
  {
    key: "_sync_docs",
    name: "Sync docs from code changes",
    description:
      "When a code file changes, propose matching edits to the docs that " +
      "describe it, citing the source file.",
    category: "self_updating",
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
    category: "self_updating",
    instructions: [
      "You maintain a running changelog.",
      "1. Review the code and write nodes that changed since your last run.",
      "2. Group the changes into a short, dated entry (Added / Changed / " +
        "Fixed / Removed).",
      "3. Prepend the entry to the changelog doc. Keep older entries intact.",
      "Done when the changelog has one new dated entry covering the period, " +
        "or no entry if nothing meaningful changed.",
    ].join("\n"),
    defaultTrigger: {
      type: "schedule",
      schedule: { type: "weekly", dayOfWeek: 1, atMinuteUTC: 540 },
    },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  {
    key: "_conversation_gaps",
    name: "Draft improvements from conversations",
    description:
      "Mine recurring questions from assistant chats to find gaps in the " +
      "docs and propose fill-ins.",
    category: "self_updating",
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
    defaultTrigger: {
      type: "schedule",
      schedule: { type: "weekly", dayOfWeek: 1, atMinuteUTC: 540 },
    },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  // ── Maintenance: routine quality on `write` docs ─────────────────────────
  {
    key: "_grammar",
    name: "Fix grammar & typos",
    description:
      "Correct grammar, spelling, and punctuation in the docs without " +
      "changing meaning.",
    category: "maintenance",
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
    category: "maintenance",
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
    category: "maintenance",
    instructions: [
      "You repair broken links in the docs.",
      "1. Scan each target doc for inline links.",
      "2. Flag links that are clearly broken (malformed, or pointing at a " +
        "node that no longer exists).",
      "3. Propose a corrected target where one is obvious, otherwise propose " +
        "removing the dead link while keeping the surrounding text.",
      "Done when no clearly-broken links remain.",
    ].join("\n"),
    defaultTrigger: {
      type: "schedule",
      schedule: { type: "weekly", dayOfWeek: 1, atMinuteUTC: 540 },
    },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
  },
  // ── Gated: dependency does not exist yet (seed disabled) ──────────────────
  {
    key: "_feedback_gaps",
    name: "Draft improvements from user feedback",
    description:
      "Turn reader feedback on docs into proposed improvements. Requires a " +
      "node feedback feature, which doesn't exist yet.",
    category: "self_updating",
    instructions:
      "Review reader feedback on each doc and propose edits that address the " +
      "most common or impactful issues.",
    defaultTrigger: {
      type: "schedule",
      schedule: { type: "weekly", dayOfWeek: 1, atMinuteUTC: 540 },
    },
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
    category: "maintenance",
    instructions:
      "Produce or update a translation of each target doc, preserving " +
      "structure and formatting.",
    defaultTrigger: { type: "event", scope: "write", debounceMinutes: 60 },
    defaultUpdateMode: "require_review",
    defaultTargetScope: "write",
    requiresDependency: "translation",
  },
] as const

/** Presets a team can actually enable today (dependency satisfied). */
export const availableWorkflowPresets = (): WorkflowPreset[] =>
  WORKFLOW_PRESETS.filter((p) => !p.requiresDependency)

export const getWorkflowPreset = (key: string): WorkflowPreset | undefined =>
  WORKFLOW_PRESETS.find((p) => p.key === key)
