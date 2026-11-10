import { useEventListener } from "@vueuse/core"

// An open popup whose trigger lives inside the card: dropdown menu / popover
// (aria-haspopup), select (combobox), or context menu (data-state only).
const OPEN_POPUP_TRIGGER = [
  '[aria-haspopup][aria-expanded="true"]',
  '[role="combobox"][aria-expanded="true"]',
  '[data-slot="context-menu-trigger"][data-state="open"]',
].join(",")

/**
 * Keeps a controlled HoverCard open while a menu opened from inside it is open.
 *
 * Menus portal to <body>, so moving the pointer into one reads to reka as
 * "left the card" (pointerleave / pointer-down-outside) and the card — and the
 * menu inside it — unmounts. We veto those closes while a popup is open, then
 * close once it shuts unless the pointer is back over the card.
 *
 * Bind `onUpdateOpen` to the HoverCard's `@update:open` and spread
 * `contentAttrs` onto its HoverCardContent.
 */
export function useMenuAwareHoverCard(setOpen: (open: boolean) => void) {
  const id = useId()
  const contentAttrs = { "data-hover-card-id": id }
  const content = () =>
    document.querySelector<HTMLElement>(`[data-hover-card-id="${id}"]`)

  const held = ref(false)
  let pointer = { x: -1, y: -1 }
  useEventListener(
    document,
    "pointermove",
    (e) => (pointer = { x: e.clientX, y: e.clientY }),
    { passive: true }
  )

  function onUpdateOpen(open: boolean) {
    if (!open && content()?.querySelector(OPEN_POPUP_TRIGGER)) {
      held.value = true
      return
    }
    held.value = false
    setOpen(open)
  }

  // While held, watch for the popup closing. ponytail: body-wide attribute
  // observer, only alive while a menu is open from inside a card.
  watch(held, (isHeld, _, onCleanup) => {
    if (!isHeld) return
    const observer = new MutationObserver(() => {
      const el = content()
      if (el?.querySelector(OPEN_POPUP_TRIGGER)) return
      observer.disconnect()
      held.value = false
      // Rect check, not :hover — hover state is stale after a modal menu
      // (body pointer-events: none) closes until the pointer moves again.
      const r = el?.getBoundingClientRect()
      const over =
        r &&
        pointer.x >= r.left &&
        pointer.x <= r.right &&
        pointer.y >= r.top &&
        pointer.y <= r.bottom
      if (!over) setOpen(false)
    })
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["aria-expanded", "data-state"],
    })
    onCleanup(() => observer.disconnect())
  })

  return { onUpdateOpen, contentAttrs }
}
