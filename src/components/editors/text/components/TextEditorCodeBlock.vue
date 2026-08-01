<script lang="ts" setup>
import {
  activeCodeThemeColors,
  CODE_LANGUAGES,
  normalizeLanguageId,
  PLAINTEXT_LANGUAGE,
} from "@/components/editors/text/shiki"
import { CODE_FONT_WEIGHT, useCodeFontSize } from "@/composables/useCodeFont"
import { useCopy } from "@/composables/useCopy"
import { IconCheck, IconChevronsUpDown, IconCopy } from "@/data/icons"
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from "@tiptap/vue-3"

const { t } = useI18n()

const props = defineProps(nodeViewProps)

const isPickerOpen = ref(false)

// The block's canonical Shiki id. `null`/unknown attrs resolve to plaintext,
// surfaced in the picker as "Auto" — Shiki can't auto-detect, so a block stays
// plaintext (themed surface, no token colors) until a language is picked.
const currentLanguageId = computed(() =>
  normalizeLanguageId(
    typeof props.node.attrs.language === "string"
      ? props.node.attrs.language
      : null
  )
)

const currentLanguageLabel = computed(() =>
  currentLanguageId.value === PLAINTEXT_LANGUAGE
    ? t("components.textEditor.auto")
    : (CODE_LANGUAGES.find((lang) => lang.id === currentLanguageId.value)
        ?.name ?? currentLanguageId.value)
)

// Store the picked id; `null` clears the block back to "auto" (plaintext).
const selectLanguage = (id: string | null) => {
  props.updateAttributes({ language: id })
  isPickerOpen.value = false
}

// `copied` flips true on a successful write and self-resets after ~1.5s,
// which alone drives the copy⇄check icon swap below — no manual timer.
// `useCopy` is the app-wide clipboard seam (VueUse on web, the native
// clipboard plugin under Tauri).
const { copy, copied } = useCopy()

// A ProseMirror node's `textContent` is the concatenated text of its
// descendants with no markup — for a code block that's exactly the source, and
// it reflects the latest edits at click time.
const copyCode = () => copy(props.node.textContent)

const codeFontSize = useCodeFontSize()

// Font size/weight must go on the <code> element, not just <pre>: `prose-sm`
// sets an explicit `code` font-size (and `code` weight 600) that overrides the
// value inherited from <pre>. Inline styles on the code element win over those
// class rules. Applied to <pre> too so its padding (em-based) scales with size.
const codeTextStyle = computed(() => ({
  fontSize: `${codeFontSize.value}px`,
  fontWeight: String(CODE_FONT_WEIGHT),
}))

// Full match with the markdown (Shiki) code blocks: the code surface adopts
// the active Shiki theme's background + foreground (inline styles override
// prose's defaults). Empty until the theme loads, so prose's surface shows for
// the first tick. Token colors come from the extension's decorations.
const surfaceStyle = computed(() => ({
  background: activeCodeThemeColors.value.bg || undefined,
  color: activeCodeThemeColors.value.fg || undefined,
  ...codeTextStyle.value,
}))
</script>

<template>
  <NodeViewWrapper
    class="code-block group relative overflow-clip rounded-4xl border"
  >
    <div
      contenteditable="false"
      :class="[
        'code-block-language absolute top-2 right-2 z-10 flex items-center gap-2 transition',
        isPickerOpen
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
      ]"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="icon" @click="copyCode">
              <IconCheck v-if="copied" />
              <IconCopy v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {{
              copied
                ? t("components.textEditor.copied")
                : t("components.textEditor.copyCode")
            }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Popover v-model:open="isPickerOpen">
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            role="combobox"
            :aria-expanded="isPickerOpen"
          >
            <span class="truncate">{{ currentLanguageLabel }}</span>
            <IconChevronsUpDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-52 p-0" align="end">
          <Command highlight-on-hover>
            <CommandInput
              :placeholder="t('components.textEditor.searchLanguage')"
              class="placeholder:text-muted-foreground border-none bg-transparent focus:border-inherit focus:ring-0"
            />
            <CommandList>
              <CommandEmpty>
                {{ t("components.textEditor.noLanguages") }}
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  :value="`${t('components.textEditor.auto')} plaintext`"
                  class="data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:**:[svg]:text-foreground"
                  @select="selectLanguage(null)"
                >
                  {{ t("components.textEditor.auto") }}
                  <IconCheck v-if="currentLanguageId === PLAINTEXT_LANGUAGE" />
                </CommandItem>
                <CommandItem
                  v-for="lang in CODE_LANGUAGES"
                  :key="lang.id"
                  :value="`${lang.name} ${lang.id}`"
                  class="data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:**:[svg]:text-foreground"
                  @select="selectLanguage(lang.id)"
                >
                  {{ lang.name }}
                  <IconCheck v-if="currentLanguageId === lang.id" />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
    <!-- prettier-ignore -->
    <pre :style="surfaceStyle"><NodeViewContent as="code" :style="codeTextStyle" /></pre>
  </NodeViewWrapper>
</template>

<style scoped>
/*
  This NodeView is a real Vue component, so (unlike the editor's ProseMirror
  content) its own scoped styles DO apply to the elements it renders.
  `prose` gives <pre> a top margin; left on the pre it collapses through the
  wrapper and detaches the absolutely-positioned language picker above the
  block. Move the block spacing onto the wrapper and zero the pre's margin so
  the picker anchors to the code surface itself.
*/
.code-block {
  position: relative;
  margin: 1.25rem 0;
}

.code-block > pre {
  margin: 0;
}
</style>
