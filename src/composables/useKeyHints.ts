import { isRecordingShortcut } from "@/composables/useShortcutRecorder"
import {
  hotkeyToDisplayKeys,
  MODIFIER_HINT_DELAY,
  sequenceToDisplayKeys,
} from "@/helpers/shortcuts"
import {
  DEFAULT_SEQUENCE_TIMEOUT,
  isModifierKey,
  matchesHeldModifiers,
  useHeldKeys,
  useHotkeyRegistrations,
  type HotkeyChordRegistrationView,
  type HotkeySequenceRegistrationView,
  type ParsedHotkeyChord,
} from "@tanstack/vue-hotkeys"
import { computed, ref, watch } from "vue"

export type KeyHintOption = {
  id: string
  /** Display tokens for the key(s) still to press, e.g. `["H"]` or `["⇧", "T"]`. */
  keys: string[]
  /** The registration's `meta.name`, e.g. "Go to Home". */
  label: string
}

export type KeyHint = {
  /** `sequence` while a multi-key sequence is in progress, `chord` while modifiers are held. */
  kind: "sequence" | "chord"
  /** Display tokens for what the user has pressed so far, e.g. `["G"]` or `["⌘"]`. */
  pressed: string[]
  options: KeyHintOption[]
}

/**
 * Mirrors the library's internal input check (`shouldIgnoreInputEvent`) so a
 * hint is only offered when the hotkey would actually fire: registrations with
 * `ignoreInputs` don't fire while typing in an editable element.
 */
const isEditableElement = (element: Element | null | undefined): boolean => {
  if (!element) return false
  if (element instanceof HTMLInputElement) {
    return !["button", "submit", "reset"].includes(element.type.toLowerCase())
  }
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

/** Whether a registration's target currently receives keyboard events. */
const isTargetActive = (
  target: HTMLElement | Document | Window,
  focused: Element | null | undefined
): boolean =>
  target === document ||
  target === window ||
  (!!focused && target instanceof Node && target.contains(focused))

/** The part of a chord still to press once `held` modifiers are down. */
const remainingChord = (parsed: ParsedHotkeyChord, held: Set<string>): string =>
  [
    ...parsed.modifiers.filter((modifier) => !held.has(modifier)),
    parsed.code === undefined ? parsed.key : `[${parsed.code}]`,
  ].join("+")

/**
 * Which-key style hints, read straight from TanStack's registries so they can
 * never drift from what is actually bound:
 *
 * - **Sequences** — after the first key of a sequence (e.g. `G`), lists every
 *   sequence that can still complete with its next key(s) (`H` → Go to Home).
 *   Progress comes from the hotkey manager (`matchedStepCount`); it only resets
 *   lazily on the next keydown, so the timeout is mirrored here with a timer.
 * - **Chords** — after modifiers are held alone for `MODIFIER_HINT_DELAY`, lists
 *   every hotkey those modifiers lead to (`⌘` → `K` Commands), using the
 *   library's `matchesHeldModifiers` (the rule behind `useHotkeyHint`).
 *
 * Only named (`meta.name`), enabled registrations whose target is active are
 * listed, and nothing is shown while a shortcut recorder is capturing keys.
 */
export const useKeyHints = () => {
  const registrations = useHotkeyRegistrations()
  const hotkeys = computed(() =>
    registrations.value.filter(
      (registration): registration is HotkeyChordRegistrationView =>
        registration.kind === "chord"
    )
  )
  const sequences = computed(() =>
    registrations.value.filter(
      (registration): registration is HotkeySequenceRegistrationView =>
        registration.kind === "sequence"
    )
  )
  const heldKeys = useHeldKeys()

  // Read focus live rather than via a reactive ref: hints only change on key
  // events (which re-run these computeds), and the library likewise checks
  // focus at event time. A tracked ref can go stale when focus falls back to
  // <body>, since no `focusin` fires for it.
  const focusedElement = () =>
    typeof document === "undefined" ? null : document.activeElement

  const isEligible = (options: {
    enabled?: boolean
    ignoreInputs?: boolean | "auto"
  }): boolean =>
    !!options.enabled &&
    (options.ignoreInputs === false || !isEditableElement(focusedElement()))

  // ── Sequences ─────────────────────────────────────────────────────────────

  const startedSequences = computed(() =>
    sequences.value.filter(
      (registration) =>
        registration.matchedStepCount > 0 &&
        !!registration.options.meta?.name &&
        isEligible(registration.options)
    )
  )

  const expiresAt = (registration: (typeof sequences.value)[number]) =>
    registration.partialMatchLastKeyTime +
    (registration.options.timeout ?? DEFAULT_SEQUENCE_TIMEOUT)

  // Ticks when the latest in-progress sequence would time out, so expired
  // progress drops out of the hint without waiting for another keydown.
  const now = ref(Date.now())
  const nextExpiry = computed(() =>
    Math.max(0, ...startedSequences.value.map(expiresAt))
  )
  watch(
    nextExpiry,
    (deadline, _previous, onCleanup) => {
      now.value = Date.now()
      if (deadline <= now.value) return
      const timer = setTimeout(() => {
        now.value = Date.now()
      }, deadline - now.value)
      onCleanup(() => clearTimeout(timer))
    },
    { immediate: true }
  )

  const sequenceHint = computed<KeyHint | null>(() => {
    const active = startedSequences.value.filter(
      (registration) => expiresAt(registration) > now.value
    )
    if (!active.length) return null

    // Sequences that share the longest matched prefix are the live branch.
    const depth = Math.max(...active.map((r) => r.matchedStepCount))
    const branch = active.filter((r) => r.matchedStepCount === depth)

    return {
      kind: "sequence",
      pressed: sequenceToDisplayKeys(branch[0].hotkey.slice(0, depth)),
      options: branch.map((registration) => ({
        id: registration.id,
        keys: sequenceToDisplayKeys(registration.hotkey.slice(depth)),
        label: registration.options.meta?.name ?? "",
      })),
    }
  })

  // ── Chords (held modifiers) ───────────────────────────────────────────────

  const heldModifiers = computed(() =>
    heldKeys.value.every((key) => isModifierKey(key)) ? heldKeys.value : []
  )

  // Reveal only after modifiers are held alone for a beat; pressing a
  // non-modifier (an actual ⌘C) or releasing them hides it immediately.
  const isHoldingModifiers = computed(() => heldModifiers.value.length > 0)
  const modifierHintRevealed = ref(false)
  watch(
    isHoldingModifiers,
    (holding, _previous, onCleanup) => {
      modifierHintRevealed.value = false
      if (!holding) return
      const timer = setTimeout(() => {
        modifierHintRevealed.value = true
      }, MODIFIER_HINT_DELAY)
      onCleanup(() => clearTimeout(timer))
    },
    // Sync so a release-then-press within one tick still restarts the delay.
    { flush: "sync" }
  )

  const chordHint = computed<KeyHint | null>(() => {
    if (!modifierHintRevealed.value || !isHoldingModifiers.value) return null

    const held = heldModifiers.value
    const heldSet = new Set(held)
    const options = hotkeys.value
      .filter(
        (registration) =>
          !!registration.options.meta?.name &&
          isEligible(registration.options) &&
          isTargetActive(registration.target, focusedElement()) &&
          matchesHeldModifiers(registration.hotkey, held, {
            platform: registration.options.platform,
          })
      )
      .map((registration) => ({
        id: registration.id,
        keys: hotkeyToDisplayKeys(
          remainingChord(registration.parsedChord, heldSet)
        ),
        label: registration.options.meta?.name ?? "",
      }))
    if (!options.length) return null

    return {
      kind: "chord",
      pressed: hotkeyToDisplayKeys(held.join("+")),
      options,
    }
  })

  const hint = computed<KeyHint | null>(() =>
    isRecordingShortcut.value
      ? null
      : (sequenceHint.value ?? chordHint.value ?? null)
  )

  return { hint }
}
