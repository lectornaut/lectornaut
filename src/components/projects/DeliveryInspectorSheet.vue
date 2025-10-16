<script setup lang="ts">
import type { ProjectDeliveryLog } from "@/types/projects"
import { computed, ref, watch } from "vue"

const props = defineProps<{
  delivery: ProjectDeliveryLog | null
  open: boolean
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
})

const activeTab = ref("request")

watch(
  () => props.delivery?.id,
  () => {
    if (props.delivery?.error) {
      activeTab.value = "error"
    } else {
      activeTab.value = "request"
    }
  },
  { immediate: true }
)

const statusStyles: Record<string, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  processing: "border-primary/40 bg-primary/10 text-primary",
  pending: "border-muted-foreground/30 bg-muted text-muted-foreground",
  queued: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  retrying: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  throttled: "border-yellow-500/40 bg-yellow-500/10 text-yellow-600",
  skipped: "border-muted-foreground/30 bg-muted text-muted-foreground",
}

const safeStatusLabel = computed(() =>
  props.delivery?.status
    ? props.delivery.status
        .split(/[\s-_]/)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")
    : "Unknown"
)

const statusBadgeClass = computed(() => {
  if (!props.delivery?.status) return "border-muted bg-muted"
  return statusStyles[props.delivery.status] ?? "border-muted bg-muted"
})

const MAX_PRETTY_LENGTH = 4000
const sensitiveKeys = [
  "authorization",
  "token",
  "password",
  "secret",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
]

const prettify = (value: unknown) => {
  if (value === null || value === undefined) {
    return { text: "—", truncated: false }
  }

  if (typeof value === "string") {
    const truncated = value.length > MAX_PRETTY_LENGTH
    return {
      text: truncated
        ? `${value.slice(0, MAX_PRETTY_LENGTH)}\n… (truncated ${value.length - MAX_PRETTY_LENGTH} characters)`
        : value,
      truncated,
    }
  }

  const seen = new WeakSet<object>()

  const replacer = (key: string, input: unknown) => {
    if (typeof key === "string" && sensitiveKeys.includes(key.toLowerCase())) {
      return "[REDACTED]"
    }

    if (typeof input === "string" && input.length > 256) {
      return `${input.slice(0, 256)}…`
    }

    if (typeof input === "object" && input !== null) {
      if (seen.has(input)) {
        return "[Circular]"
      }
      seen.add(input)
    }

    return input
  }

  try {
    const text = JSON.stringify(value, replacer, 2)
    const truncated = text.length > MAX_PRETTY_LENGTH
    return {
      text: truncated
        ? `${text.slice(0, MAX_PRETTY_LENGTH)}\n… (truncated ${text.length - MAX_PRETTY_LENGTH} characters)`
        : text,
      truncated,
    }
  } catch (error) {
    return {
      text: `Unable to display payload: ${
        error instanceof Error ? error.message : String(error)
      }`,
      truncated: false,
    }
  }
}

const requestSource = computed(() => prettify(props.delivery?.requestPayload))
const transformedSource = computed(() => prettify(props.delivery?.transformedPayload))
const responseSource = computed(() => prettify(props.delivery?.responsePayload))

const errorSource = computed(() => {
  if (!props.delivery?.error) {
    return {
      text: "No error recorded for this delivery.",
      truncated: false,
    }
  }

  const { message, code, stack, occurredAt, detail } = props.delivery.error
  const parts = [
    `message: ${message}`,
    code ? `code: ${code}` : null,
    occurredAt ? `occurredAt: ${occurredAt}` : null,
    detail ? `detail: ${detail}` : null,
    stack ? `stack:\n${stack}` : null,
  ].filter(Boolean)

  return {
    text: parts.join("\n"),
    truncated: false,
  }
})

const formatResponseTime = computed(() => {
  const ms = props.delivery?.responseTimeMs ?? 0
  if (!ms) return "—"
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`
  const minutes = seconds / 60
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`
})

const formatTimestamp = (value?: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const metadata = computed(() => {
  if (!props.delivery) return []
  return [
    { label: "Status", value: safeStatusLabel.value },
    { label: "Attempt", value: `#${props.delivery.attempt}` },
    { label: "Response", value: formatResponseTime.value },
    { label: "Triggered at", value: formatTimestamp(props.delivery.triggeredAt) },
    { label: "Completed", value: formatTimestamp(props.delivery.completedAt) },
    { label: "Destination", value: props.delivery.destination },
    {
      label: "Size",
      value: props.delivery.sizeBytes
        ? `${(props.delivery.sizeBytes / 1024).toFixed(1)} KB`
        : "—",
    },
  ]
})
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent
      class="m-2 flex h-[96vh] max-h-[96vh] flex-col gap-0 rounded-md border sm:max-w-xl md:max-w-3xl"
      side="right"
    >
      <SheetHeader class="gap-2">
        <SheetTitle> Delivery inspector </SheetTitle>
        <SheetDescription v-if="delivery">
          Delivery <span class="font-mono">{{ delivery.id }}</span>
        </SheetDescription>
      </SheetHeader>
      <Separator />
      <div v-if="delivery" class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <div class="grid gap-3 border-b px-1 pb-3">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <Badge :class="statusBadgeClass" variant="outline">
              {{ safeStatusLabel }}
            </Badge>
            <Badge v-if="delivery.test" variant="secondary">Test delivery</Badge>
          </div>
          <dl class="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <div v-for="item in metadata" :key="item.label" class="grid gap-1">
              <dt class="text-muted-foreground uppercase tracking-wide">
                {{ item.label }}
              </dt>
              <dd class="font-medium">{{ item.value || "—" }}</dd>
            </div>
          </dl>
        </div>
        <Tabs v-model="activeTab" default-value="request" class="flex min-h-0 flex-1 flex-col">
          <TabsList class="w-full justify-start space-x-2 border-b px-1">
            <TabsTrigger value="request">Request</TabsTrigger>
            <TabsTrigger value="transformed">Transformed</TabsTrigger>
            <TabsTrigger value="response">Response</TabsTrigger>
            <TabsTrigger value="error">Error</TabsTrigger>
          </TabsList>
          <TabsContent value="request" class="flex-1 overflow-hidden">
            <ScrollArea class="h-full">
              <pre class="whitespace-pre-wrap break-words font-mono text-xs">
{{ requestSource.text }}
              </pre>
              <p v-if="requestSource.truncated" class="text-muted-foreground px-2 pb-2 text-xs">
                Output truncated to {{ MAX_PRETTY_LENGTH.toLocaleString() }} characters.
              </p>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="transformed" class="flex-1 overflow-hidden">
            <ScrollArea class="h-full">
              <pre class="whitespace-pre-wrap break-words font-mono text-xs">
{{ transformedSource.text }}
              </pre>
              <p v-if="transformedSource.truncated" class="text-muted-foreground px-2 pb-2 text-xs">
                Output truncated to {{ MAX_PRETTY_LENGTH.toLocaleString() }} characters.
              </p>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="response" class="flex-1 overflow-hidden">
            <ScrollArea class="h-full">
              <pre class="whitespace-pre-wrap break-words font-mono text-xs">
{{ responseSource.text }}
              </pre>
              <p v-if="responseSource.truncated" class="text-muted-foreground px-2 pb-2 text-xs">
                Output truncated to {{ MAX_PRETTY_LENGTH.toLocaleString() }} characters.
              </p>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="error" class="flex-1 overflow-hidden">
            <ScrollArea class="h-full">
              <pre class="whitespace-pre-wrap break-words font-mono text-xs">
{{ errorSource.text }}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
      <div v-else class="flex flex-1 items-center justify-center">
        <EmptySection
          title="Select a delivery"
          description="Choose a delivery from the table to inspect its payloads and response."
          :centered="true"
        />
      </div>
      <SheetFooter class="border-t pt-3">
        <Button variant="secondary" class="ml-auto" @click="isOpen = false">
          Close
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
