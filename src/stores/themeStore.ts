/**
 * Theme Store
 * ===========
 *
 * Owns the per-user appearance/theme settings: color mode, base/accent palettes
 * (incl. custom hex), font, size, language, editor theme + font size, and the
 * translucent-sidebar and reduced-motion flags. Exposed as a single `reactive()`
 * `themeSettings` bundle that consumers read AND write two-way (notably
 * `modules/theme.ts`, which mirrors it into the live CSS / `useColorMode` state).
 *
 * Each field is a `useStorage` ref (localStorage-instant, offline-safe) mirrored
 * to the per-user `users/{uid}/settings/themes` document: an inbound watch
 * hydrates field-by-field (gated by `pendingTheme`), and a debounced
 * `createDebouncedCloudSync` persists settled local state. Two normalize watches
 * clamp custom hex colors; one guard watch breaks the cyclic base⇄accent combo.
 *
 * This is the residue of the former `settingsStore` "user settings" monolith
 * after phases 1-3 peeled off shortcuts / notifications / preferences — phase 4
 * renamed it to its true single concern. The `settings.theme*` source strings
 * and `toSettingsThemeDoc` / `SettingsThemeDoc` names are kept deliberately:
 * they describe the `settings/themes` Firestore doc, not the store.
 */

import type {
  AccentId,
  BaseId,
  EditorFontSizeId,
  EditorThemeId,
  FontId,
  LanguageId,
  SizeId,
} from "@/helpers/defaults"
import {
  defaultAccent,
  defaultBase,
  defaultCustomAccentColor,
  defaultCustomBaseColor,
  defaultEditorFontSize,
  defaultEditorTheme,
  defaultFont,
  defaultLanguage,
  defaultReducedMotion,
  defaultSize,
  defaultTheme,
  defaultTranslucentSidebar,
} from "@/helpers/defaults"
import { firestore } from "@/modules/firebase"
import { parseSafe } from "@/schemas/_utils"
import { settingsThemeDocSchema } from "@/schemas/settings"
import type { SettingsThemeDoc, ThemeMode } from "@/types/settings"
import { createDebouncedCloudSync } from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { safeSetDocument as safeSetDoc } from "@/utils/firebase/firebase-sync-engine"
import { normalizeHexColor } from "@/utils/theme/customTheme"
import { useStorage, watchDebounced } from "@vueuse/core"
import { collection, doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCurrentUser } from "vuefire"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

// Validate incoming theme docs against the Zod schema instead of an unchecked
// `as` cast. `isRecord` guards first so a missing/empty doc returns null
// silently (absence isn't a violation); a present-but-malformed doc is caught
// by `parseSafe` — loud in dev, zero-overhead pass-through in prod. This stops
// an invalid mode/base/font from round-tripping back out to `useStorage`.
const toSettingsThemeDoc = (value: unknown): SettingsThemeDoc | null =>
  isRecord(value)
    ? parseSafe(settingsThemeDocSchema, value, "settings.theme")
    : null

export const useThemeStore = defineStore("theme", () => {
  const user = useCurrentUser()

  const mode = useStorage<ThemeMode>("theme", defaultTheme)
  const base = useStorage<BaseId>("base", defaultBase)
  const accent = useStorage<AccentId>("accent", defaultAccent)
  const customBaseColor = useStorage<string>(
    "customBaseColor",
    defaultCustomBaseColor
  )
  const customAccentColor = useStorage<string>(
    "customAccentColor",
    defaultCustomAccentColor
  )
  const font = useStorage<FontId>("font", defaultFont)
  const size = useStorage<SizeId>("size", defaultSize)
  const language = useStorage<LanguageId>("language", defaultLanguage)
  const editorTheme = useStorage<EditorThemeId>(
    "editorTheme",
    defaultEditorTheme
  )
  const editorFontSize = useStorage<EditorFontSizeId>(
    "editorFontSize",
    defaultEditorFontSize
  )
  const translucentSidebar = useStorage<boolean>(
    "translucentSidebar",
    defaultTranslucentSidebar
  )
  const reducedMotion = useStorage<boolean>(
    "reducedMotion",
    defaultReducedMotion
  )

  const themeSettings = reactive({
    mode,
    base,
    accent,
    customBaseColor,
    customAccentColor,
    font,
    size,
    language,
    editorTheme,
    editorFontSize,
    translucentSidebar,
    reducedMotion,
  })

  const themeDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(
        doc(collection(firestore, "users"), user.value.uid),
        "settings"
      ),
      "themes"
    )
  })

  const { data: themeDocData, isLoading: themePending } =
    useDocumentQuery(themeDocRef)

  async function persistTheme(): Promise<boolean> {
    return safeSetDoc(
      themeDocRef.value,
      {
        mode: mode.value,
        base: base.value,
        accent: accent.value,
        customBaseColor: customBaseColor.value,
        customAccentColor: customAccentColor.value,
        font: font.value,
        size: size.value,
        language: language.value,
        editorTheme: editorTheme.value,
        editorFontSize: editorFontSize.value,
        translucentSidebar: translucentSidebar.value,
        reducedMotion: reducedMotion.value,
      },
      "settings.themes.persist"
    )
  }

  // Re-entrancy-safe debounced persister. `pendingTheme` is read by the inbound
  // snapshot watch below to skip applying remote state mid-write. It must be
  // declared before that watch: the watch is `immediate`, so its callback runs
  // synchronously during setup and would hit `pendingTheme`'s temporal dead
  // zone if the declaration came later.
  const { trigger: persistThemeWithSync, pending: pendingTheme } =
    createDebouncedCloudSync({
      persist: persistTheme,
      id: "theme",
      source: "settings.themes.persist",
      canPersist: () => themeDocRef.value !== null,
      errorLabel: "settings.theme",
    })

  watch(
    themeDocData,
    (docData) => {
      if (pendingTheme.value) return

      const themeDoc = toSettingsThemeDoc(docData)
      if (!themeDoc) return

      if ("mode" in themeDoc && themeDoc.mode && themeDoc.mode !== mode.value) {
        mode.value = themeDoc.mode
      }
      if ("base" in themeDoc && themeDoc.base && themeDoc.base !== base.value) {
        base.value = themeDoc.base
      }
      if (
        "accent" in themeDoc &&
        themeDoc.accent &&
        themeDoc.accent !== accent.value
      ) {
        accent.value = themeDoc.accent
      }
      if ("customBaseColor" in themeDoc) {
        const nextCustomBaseColor = normalizeHexColor(
          themeDoc.customBaseColor,
          defaultCustomBaseColor
        )

        if (nextCustomBaseColor !== customBaseColor.value) {
          customBaseColor.value = nextCustomBaseColor
        }
      }
      if ("customAccentColor" in themeDoc) {
        const nextCustomAccentColor = normalizeHexColor(
          themeDoc.customAccentColor,
          defaultCustomAccentColor
        )

        if (nextCustomAccentColor !== customAccentColor.value) {
          customAccentColor.value = nextCustomAccentColor
        }
      }
      if ("font" in themeDoc && themeDoc.font && themeDoc.font !== font.value) {
        font.value = themeDoc.font
      }
      if ("size" in themeDoc && themeDoc.size && themeDoc.size !== size.value) {
        size.value = themeDoc.size
      }
      if (
        "language" in themeDoc &&
        themeDoc.language &&
        themeDoc.language !== language.value
      ) {
        language.value = themeDoc.language
      }
      if (
        "editorTheme" in themeDoc &&
        themeDoc.editorTheme &&
        themeDoc.editorTheme !== editorTheme.value
      ) {
        editorTheme.value = themeDoc.editorTheme
      }
      if (
        "editorFontSize" in themeDoc &&
        themeDoc.editorFontSize &&
        themeDoc.editorFontSize !== editorFontSize.value
      ) {
        editorFontSize.value = themeDoc.editorFontSize
      }
      if (
        "translucentSidebar" in themeDoc &&
        typeof themeDoc.translucentSidebar === "boolean" &&
        themeDoc.translucentSidebar !== translucentSidebar.value
      ) {
        translucentSidebar.value = themeDoc.translucentSidebar
      }
      if (
        "reducedMotion" in themeDoc &&
        typeof themeDoc.reducedMotion === "boolean" &&
        themeDoc.reducedMotion !== reducedMotion.value
      ) {
        reducedMotion.value = themeDoc.reducedMotion
      }
    },
    { immediate: true }
  )

  watch(
    customBaseColor,
    (value) => {
      const normalized = normalizeHexColor(value, defaultCustomBaseColor)
      if (normalized !== value) customBaseColor.value = normalized
    },
    { immediate: true }
  )

  watch(
    customAccentColor,
    (value) => {
      const normalized = normalizeHexColor(value, defaultCustomAccentColor)
      if (normalized !== value) customAccentColor.value = normalized
    },
    { immediate: true }
  )

  // Prevent cyclic "accent<->base" combinations that cannot resolve a palette.
  watch(
    [base, accent],
    ([nextBase, nextAccent], previousPair) => {
      if (nextBase !== "accent" || nextAccent !== "base") return

      const [prevBase, prevAccent] = previousPair ?? []
      const safePrevBase: BaseId =
        prevBase && prevBase !== "accent" ? prevBase : defaultBase
      const safePrevAccent: AccentId =
        prevAccent && prevAccent !== "base" ? prevAccent : defaultAccent

      if (prevAccent === "base" && prevBase !== "accent") {
        base.value = safePrevBase
        return
      }

      if (prevBase === "accent" && prevAccent !== "base") {
        accent.value = safePrevAccent
        return
      }

      base.value = safePrevBase
      accent.value = safePrevAccent
    },
    { immediate: true }
  )

  watchDebounced(
    [
      mode,
      base,
      accent,
      customBaseColor,
      customAccentColor,
      font,
      size,
      language,
      editorTheme,
      editorFontSize,
      translucentSidebar,
      reducedMotion,
    ],
    () => {
      void persistThemeWithSync()
    },
    { debounce: 500 }
  )

  const isThemeLoading = computed(() => themePending.value)

  return {
    themeSettings,
    pendingTheme,
    isThemeLoading,
  }
})
