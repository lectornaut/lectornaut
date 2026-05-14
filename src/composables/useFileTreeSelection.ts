/**
 * useFileTreeSelection — selection context shared with every `TreeNode`
 * rendered inside a `FileTree`.
 *
 * The composable solves two problems at once:
 *
 *   1. **Mode unification.** Historically `FileTree` had two implicit
 *      selection patterns: store-driven (the page-level routes write
 *      back to the Pinia store) and event-driven (pickers emit
 *      `@select` and own the state themselves). Each `TreeNode` had to
 *      detect which mode it was in via `hasControlledSelection`. This
 *      composable makes the mode an explicit enum (`"none"`, `"single"`,
 *      `"multiple"`) and centralizes the per-mode toggle logic on the
 *      `FileTree` root.
 *
 *   2. **Prop-drilling avoidance.** The tree renders recursively — a
 *      `TreeNode` may sit ten levels deep. Threading a `selectedNodeId`
 *      (or now: a selection set) through every level is noise. Using
 *      Vue's provide/inject, the deepest child can ask the context
 *      whether *its* id is selected without anything in between
 *      knowing or caring.
 *
 * Modes
 *   - "none":     the row click writes to the file-tree store and the
 *                 highlight tracks the store's `selectedNodeId`. Used by
 *                 `/code/:nodeId?` and `/write/:nodeId?` pages where the
 *                 selection is what drives the URL.
 *   - "single":   a radio-style indicator shows next to the chevron.
 *                 Highlight tracks the `selection` string. Used by the
 *                 file-drop save sheet where the user picks one folder.
 *   - "multiple": a checkbox shows next to the chevron. Highlight tracks
 *                 a `selection` set. Used by the AI composer's attach
 *                 picker where many files can be queued.
 *
 * The composable never owns the source of truth — the parent always
 * does (store for "none", caller for "single"/"multiple"). It only
 * exposes the membership check and a click handler for `TreeNode` to
 * call.
 */

import type { WorkspaceNode } from "@/types/nodes"
import { inject, provide, type ComputedRef, type InjectionKey } from "vue"

export type FileTreeSelectionMode = "none" | "single" | "multiple"

export interface FileTreeSelectionContext {
  /** Current mode. Reactive so the indicator can swap if the parent flips it. */
  mode: ComputedRef<FileTreeSelectionMode>
  /** Whether `nodeId` should be rendered with the active highlight. */
  isSelected: (nodeId: string) => boolean
  /**
   * Called when the user clicks a node row (excluding the chevron and
   * the inline actions menu). The `FileTree` root decides what to do:
   *   - "none":     write to the store
   *   - "single":   emit `select` so the parent can move its pointer
   *   - "multiple": emit `select` so the parent can toggle membership
   */
  onRowClick: (node: WorkspaceNode) => void
}

const FileTreeSelectionKey: InjectionKey<FileTreeSelectionContext> = Symbol(
  "FileTreeSelectionContext"
)

export const provideFileTreeSelection = (ctx: FileTreeSelectionContext) =>
  provide(FileTreeSelectionKey, ctx)

export const useFileTreeSelection = (): FileTreeSelectionContext | null =>
  inject(FileTreeSelectionKey, null)
