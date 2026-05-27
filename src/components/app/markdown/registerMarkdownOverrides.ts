/**
 * Side-effect module: registers every markstream-vue custom-component
 * override exactly once.
 *
 * Why a standalone module instead of inline in AppMarkdown.vue?
 * `setCustomComponents` writes into a module-level singleton inside the
 * library, so it only needs to run once for the whole app. AppMarkdown's
 * `<script setup>` compiles into `setup()`, which runs *per instance* —
 * and AppMarkdown is mounted once per chat message (and twice per
 * tool-call), so inline registration re-ran the same writes dozens of
 * times. ES modules are evaluated once and cached, so importing this for
 * its side effect runs the registration a single time no matter how many
 * AppMarkdown instances mount.
 *
 * `markRaw` keeps Vue from making the component definitions reactive (we
 * only ever read them as render targets). The maps fully replace the
 * entry for each `customId` — `setCustomComponents` does not merge — so
 * every override for a surface is declared in one call.
 *
 *   chat            → thinking (CoT disclosure), SafeLink (target=_blank
 *                     + RouterLink), AppMarkdownImage (lazy + placeholder)
 *   changelog-sheet → SafeLink (author content can still cite externals)
 *   changelog-page  → SafeLink + AppMarkdownHeading (anchor permalinks)
 *   all surfaces    → code_block (MarkdownCodeBlockNode — Shiki highlighting,
 *                     replacing the default Monaco renderer so this surface
 *                     matches the CodeMirror + Tiptap code surfaces, all three
 *                     driven by the same Shiki themes)
 */
import BotThinkingBlock from "@/components/app/bot/BotThinkingBlock.vue"
import AppMarkdownHeading from "@/components/app/markdown/AppMarkdownHeading.vue"
import AppMarkdownImage from "@/components/app/markdown/AppMarkdownImage.vue"
import SafeLink from "@/components/app/markdown/SafeLink.vue"
import { MarkdownCodeBlockNode, setCustomComponents } from "markstream-vue"
import { markRaw } from "vue"

setCustomComponents("chat", {
  thinking: markRaw(BotThinkingBlock),
  link: markRaw(SafeLink),
  image: markRaw(AppMarkdownImage),
  code_block: markRaw(MarkdownCodeBlockNode),
})
setCustomComponents("changelog-sheet", {
  link: markRaw(SafeLink),
  image: markRaw(AppMarkdownImage),
  code_block: markRaw(MarkdownCodeBlockNode),
})
setCustomComponents("changelog-page", {
  link: markRaw(SafeLink),
  heading: markRaw(AppMarkdownHeading),
  image: markRaw(AppMarkdownImage),
  code_block: markRaw(MarkdownCodeBlockNode),
})
