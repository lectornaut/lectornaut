type Side = "left" | "right"

/**
 * The one bit of shared state behind the collapsed-sidebar hover preview:
 * whether a given side is being peeked *right now*.
 *
 * The left/right sidebars are teleport targets (`#left-sidebar`/`#right-sidebar`)
 * inside collapsible panels in `MainLayout`. To peek a collapsed one we repoint
 * the page's `<SidebarSlot>` teleport at the hover card's `#{side}-sidebar-preview`
 * div and Vue moves the live content there (and back) natively. The toggle (which
 * knows the hover) and the page's slot (which carries the content) live in
 * different component trees, so this flag is the wire between them. It is NOT
 * derivable from the collapsed flags — collapsed ≠ being hovered — and is
 * transient, so it lives here rather than in the persisted `uiPreferencesStore`.
 */
const previewing = reactive<Record<Side, boolean>>({
  left: false,
  right: false,
})

// Single source of truth for the two DOM ids per side (no leading `#`), so
// MainLayout, SidebarSlot and the sub-nav toggle can't drift apart on a rename.
export const sidebarTargetId = (side: Side) => `${side}-sidebar`
export const sidebarPreviewTargetId = (side: Side) => `${side}-sidebar-preview`

/** Used by `<SidebarSlot>`: the dynamic teleport target for this side. */
export function useSidebarSlot(side: Side) {
  const target = computed(
    () =>
      `#${previewing[side] ? sidebarPreviewTargetId(side) : sidebarTargetId(side)}`
  )
  return { target }
}

/** Used by the sub-navigation toggle: drive the peek. */
export function useSidebarPreview(side: Side) {
  const setPreviewing = (open: boolean) => {
    previewing[side] = open
  }
  return { setPreviewing }
}
