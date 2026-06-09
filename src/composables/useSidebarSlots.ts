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

/** Used by `<SidebarSlot>`: the dynamic teleport target for this side. */
export function useSidebarSlot(side: Side) {
  const target = computed(() =>
    previewing[side] ? `#${side}-sidebar-preview` : `#${side}-sidebar`
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
