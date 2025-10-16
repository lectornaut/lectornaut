import { useClipboard } from "@vueuse/core"
import type { ComputedRef, MaybeRefOrGetter } from "vue"
import { computed, ref, toValue } from "vue"
import { toast } from "vue-sonner"

interface ChannelWebhookUrlOptions {
  functionName?: MaybeRefOrGetter<string | null | undefined>
  secret?: MaybeRefOrGetter<string | null | undefined>
  projectId?: MaybeRefOrGetter<string | null | undefined>
  region?: MaybeRefOrGetter<string | null | undefined>
}

interface ClipboardAdapter {
  copy: (text: string) => Promise<void>
  copied: ComputedRef<boolean>
  isSupported: ComputedRef<boolean>
}

const createClipboardAdapter = (): ClipboardAdapter => {
  if (import.meta.env.SSR) {
    const copiedState = ref(false)
    return {
      copy: async () => {
        throw new Error("Clipboard API is unavailable during SSR")
      },
      copied: computed(() => copiedState.value),
      isSupported: computed(() => false),
    }
  }

  const { copy, copied, isSupported } = useClipboard({ legacy: true })
  return { copy, copied, isSupported }
}

export const useChannelWebhookUrl = (
  channelId: MaybeRefOrGetter<string | null | undefined>,
  options: ChannelWebhookUrlOptions = {}
) => {
  const clipboard = createClipboardAdapter()

  const resolvedRegion = computed(
    () =>
      toValue(options.region) ??
      import.meta.env.VITE_FUNCTIONS_REGION ??
      "us-central1"
  )
  const resolvedProjectId = computed(
    () => toValue(options.projectId) ?? import.meta.env.VITE_PROJECT_ID ?? ""
  )
  const resolvedFunctionName = computed(
    () =>
      toValue(options.functionName) ??
      import.meta.env.VITE_PROJECT_CHANNEL_WEBHOOK_FUNCTION ??
      "projectChannelWebhook"
  )
  const resolvedSecret = computed(() => toValue(options.secret)?.trim() ?? "")

  const webhookUrl = computed(() => {
    const id = toValue(channelId)
    const projectId = resolvedProjectId.value
    if (!id || !projectId) return ""

    const base = `https://${resolvedRegion.value}-${projectId}.cloudfunctions.net/${resolvedFunctionName.value}/${id}`

    return resolvedSecret.value
      ? `${base}?secret=${encodeURIComponent(resolvedSecret.value)}`
      : base
  })

  const copyWebhookUrl = async () => {
    if (!webhookUrl.value) {
      toast.error("Webhook URL is unavailable")
      return
    }

    if (!clipboard.isSupported.value) {
      toast.error("Clipboard API is not supported in this environment")
      return
    }

    try {
      await clipboard.copy(webhookUrl.value)
      toast.success("Webhook URL copied to clipboard")
    } catch (error) {
      console.error("Error copying webhook URL:", error)
      toast.error("Failed to copy webhook URL")
    }
  }

  return {
    webhookUrl,
    copyWebhookUrl,
    copied: clipboard.copied,
    isClipboardSupported: clipboard.isSupported,
  }
}
