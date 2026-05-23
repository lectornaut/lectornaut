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

const props = defineProps<ImageNodeProps>()
</script>

<template>
  <!--
    Forward every prop markstream passes a custom renderer (node, isDark,
    loading, customId, …) via v-bind, then layer our app-wide defaults on
    top. Explicit attributes win over the v-bind object, so lazy +
    placeholder always apply while theme/loading state still reach the
    inner ImageNode.
  -->
  <ImageNode v-bind="props" :lazy="true" :use-placeholder="true" />
</template>
