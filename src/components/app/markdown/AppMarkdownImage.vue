<script lang="ts" setup>
/**
 * AppMarkdownImage — wraps the library's built-in `ImageNode` with
 * the defaults we want everywhere: native lazy loading and a
 * placeholder while the image fetches.
 *
 * Registered against the `chat` customId. LLM-supplied URLs are the
 * main use case — they're frequently broken (the model hallucinates
 * file paths), so deferred load + placeholder matters more than for
 * hand-authored content.
 */
import { ImageNode, type ImageNodeProps } from "markstream-vue"

defineProps<ImageNodeProps>()
</script>

<template>
  <ImageNode :node="node" :lazy="true" :use-placeholder="true" />
</template>
