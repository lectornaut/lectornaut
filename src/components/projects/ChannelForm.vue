<script setup lang="ts">
import type { ProjectChannel, ProjectChannelStatus, ProjectChannelType } from "@/types"
import { computed, reactive, watch } from "vue"

type ChannelDraft = Pick<ProjectChannel, "name" | "endpoint" | "secret" | "status" | "type">

const props = defineProps({
  modelValue: {
    type: Object as () => Partial<ProjectChannel>,
    default: () => ({}),
  },
  submitting: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits<{
  (event: "update:modelValue", value: ChannelDraft): void
  (event: "submit", value: ChannelDraft): void
  (event: "cancel"): void
}>()

const form = reactive<ChannelDraft>({
  name: "",
  type: "webhook",
  endpoint: "",
  secret: "",
  status: "active",
})

const errors = reactive<Record<keyof ChannelDraft, string | null>>({
  name: null,
  type: null,
  endpoint: null,
  secret: null,
  status: null,
})

const channelTypes: Array<{ label: string; value: ProjectChannelType }> = [
  { label: "Webhook", value: "webhook" },
  { label: "Email", value: "email" },
  { label: "Slack", value: "slack" },
  { label: "Custom", value: "custom" },
]

const channelStatuses: Array<{ label: string; value: ProjectChannelStatus }> = [
  { label: "Active", value: "active" },
  { label: "Paused", value: "paused" },
  { label: "Disabled", value: "disabled" },
]

const requiresSecret = computed(() => form.type === "webhook" || form.type === "custom")

const assignForm = (value: Partial<ProjectChannel>) => {
  form.name = value.name ?? ""
  form.type = (value.type as ProjectChannelType) ?? "webhook"
  form.endpoint = value.endpoint ?? ""
  form.secret = value.secret ?? ""
  form.status = (value.status as ProjectChannelStatus) ?? "active"
}

watch(
  () => props.modelValue,
  (value) => {
    assignForm(value)
    clearErrors()
  },
  { immediate: true, deep: true }
)

watch(
  form,
  () => {
    emit("update:modelValue", { ...form })
  },
  { deep: true }
)

const clearErrors = () => {
  (Object.keys(errors) as Array<keyof ChannelDraft>).forEach((key) => {
    errors[key] = null
  })
}

const validate = () => {
  clearErrors()

  if (!form.name.trim()) {
    errors.name = "Name is required"
  }

  if (!form.endpoint.trim()) {
    errors.endpoint = "Endpoint is required"
  } else {
    try {
      // eslint-disable-next-line no-new
      new URL(form.endpoint)
    } catch (error) {
      errors.endpoint = "Endpoint must be a valid URL"
    }
  }

  if (requiresSecret.value && !form.secret.trim()) {
    errors.secret = "Secret is required for this channel type"
  }

  return (Object.values(errors) as Array<string | null>).every((value) => !value)
}

const onSubmit = () => {
  if (!validate()) {
    return
  }

  const payload: ChannelDraft = {
    name: form.name.trim(),
    type: form.type,
    endpoint: form.endpoint.trim(),
    secret: form.secret.trim(),
    status: form.status,
  }

  emit("submit", payload)
}

const onCancel = () => {
  emit("cancel")
}
</script>

<template>
  <form class="grid gap-4" novalidate @submit.prevent="onSubmit">
    <div class="grid gap-2">
      <label class="text-sm font-medium" for="channel-name">Channel name</label>
      <input
        id="channel-name"
        v-model="form.name"
        class="h-10 rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="submitting"
        data-test="channel-name"
        placeholder="e.g. Production webhook"
        type="text"
      />
      <p
        v-if="errors.name"
        class="text-sm text-destructive"
        data-test="channel-name-error"
        role="alert"
      >
        {{ errors.name }}
      </p>
    </div>

    <div class="grid gap-2">
      <label class="text-sm font-medium" for="channel-type">Channel type</label>
      <select
        id="channel-type"
        v-model="form.type"
        class="h-10 rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="submitting"
        data-test="channel-type"
      >
        <option v-for="type in channelTypes" :key="type.value" :value="type.value">
          {{ type.label }}
        </option>
      </select>
    </div>

    <div class="grid gap-2">
      <label class="text-sm font-medium" for="channel-endpoint">Endpoint URL</label>
      <input
        id="channel-endpoint"
        v-model="form.endpoint"
        class="h-10 rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="submitting"
        data-test="channel-endpoint"
        placeholder="https://example.com/webhooks/projects"
        type="url"
      />
      <p
        v-if="errors.endpoint"
        class="text-sm text-destructive"
        data-test="channel-endpoint-error"
        role="alert"
      >
        {{ errors.endpoint }}
      </p>
    </div>

    <div class="grid gap-2">
      <label class="text-sm font-medium" for="channel-secret">
        Shared secret
        <span v-if="requiresSecret" class="text-muted-foreground">(required)</span>
      </label>
      <input
        id="channel-secret"
        v-model="form.secret"
        autocomplete="off"
        class="h-10 rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="submitting"
        data-test="channel-secret"
        placeholder="••••••••"
        type="text"
      />
      <p
        v-if="errors.secret"
        class="text-sm text-destructive"
        data-test="channel-secret-error"
        role="alert"
      >
        {{ errors.secret }}
      </p>
    </div>

    <div class="grid gap-2">
      <label class="text-sm font-medium" for="channel-status">Status</label>
      <select
        id="channel-status"
        v-model="form.status"
        class="h-10 rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="submitting"
        data-test="channel-status"
      >
        <option v-for="status in channelStatuses" :key="status.value" :value="status.value">
          {{ status.label }}
        </option>
      </select>
    </div>

    <div class="flex flex-wrap gap-2 pt-1">
      <button
        class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        data-test="channel-submit"
        :aria-disabled="submitting"
        :disabled="submitting"
        type="submit"
      >
        {{ submitting ? "Saving…" : "Save channel" }}
      </button>
      <button
        class="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        data-test="channel-cancel"
        :disabled="submitting"
        type="button"
        @click="onCancel"
      >
        Cancel
      </button>
    </div>
  </form>
</template>
