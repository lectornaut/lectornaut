<script setup lang="ts">
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toTypedSchema } from "@vee-validate/zod"
import type { SubmissionContext } from "vee-validate"
import { z } from "zod"

const props = defineProps<{
  initialValues: ChannelFormValues
  loading?: boolean
}>()

const emit = defineEmits<{
  (event: "submit", payload: ChannelFormSubmitPayload): void
}>()

const schema = toTypedSchema(
  z.object({
    name: z
      .string({ required_error: "Name is required" })
      .min(1, "Name is required")
      .max(80, "Name must be 80 characters or fewer"),
    targetUrl: z
      .string({ required_error: "Target URL is required" })
      .url("Enter a valid URL, including protocol"),
    transformation: z
      .string({ required_error: "Transformation is required" })
      .min(1, "Provide a transformation function"),
  })
)

const formKey = computed(() => JSON.stringify(props.initialValues))

const handleFormSubmit = (
  values: ChannelFormValues,
  ctx: SubmissionContext<ChannelFormValues>
) => {
  emit("submit", {
    values,
    resetForm: ctx.resetForm,
    setErrors: ctx.setErrors,
    setFieldError: ctx.setFieldError,
  })
}

export type ChannelFormValues = {
  name: string
  targetUrl: string
  transformation: string
}

export type ChannelFormSubmitPayload = {
  values: ChannelFormValues
  resetForm: SubmissionContext<ChannelFormValues>["resetForm"]
  setErrors: SubmissionContext<ChannelFormValues>["setErrors"]
  setFieldError: SubmissionContext<ChannelFormValues>["setFieldError"]
}
</script>

<template>
  <Form
    :key="formKey"
    v-slot="{ handleSubmit, isSubmitting }"
    :initial-values="props.initialValues"
    :validation-schema="schema"
  >
    <form
      class="grid gap-6"
      @submit.prevent="
        handleSubmit((values, ctx) => handleFormSubmit(values, ctx))
      "
    >
      <FormField v-slot="{ field, errorMessage }" name="name">
        <FormItem class="grid gap-2">
          <FormLabel>Channel name</FormLabel>
          <FormControl>
            <Input
              v-bind="field"
              type="text"
              autocomplete="off"
              placeholder="Production webhooks"
              :disabled="props.loading || isSubmitting"
            />
          </FormControl>
          <FormDescription>
            Choose a memorable name to identify this webhook destination.
          </FormDescription>
          <FormMessage v-if="errorMessage">{{ errorMessage }}</FormMessage>
        </FormItem>
      </FormField>

      <FormField v-slot="{ field, errorMessage }" name="targetUrl">
        <FormItem class="grid gap-2">
          <FormLabel>Target URL</FormLabel>
          <FormControl>
            <Input
              v-bind="field"
              type="url"
              placeholder="https://api.example.com/webhooks"
              :disabled="props.loading || isSubmitting"
            />
          </FormControl>
          <FormDescription>
            Events will be delivered as POST requests to this endpoint.
          </FormDescription>
          <FormMessage v-if="errorMessage">{{ errorMessage }}</FormMessage>
        </FormItem>
      </FormField>

      <FormField v-slot="{ field, errorMessage }" name="transformation">
        <FormItem class="grid gap-2">
          <FormLabel>Transformation</FormLabel>
          <FormDescription>
            Mutate or validate the incoming payload before delivery. Return the
            data you want forwarded downstream.
          </FormDescription>
          <FormControl>
            <div
              :class="[
                'bg-card min-h-[240px] rounded-md border',
                props.loading || isSubmitting ? 'opacity-60' : '',
              ]"
            >
              <CodeEditor
                :model-value="field.value ?? ''"
                placeholder="export default async function transform(event) {\n  return event\n}"
                language="javascript"
                :read-only="props.loading || isSubmitting"
                @update:model-value="field.onChange"
                @blur="field.onBlur"
              />
            </div>
          </FormControl>
          <FormMessage v-if="errorMessage">{{ errorMessage }}</FormMessage>
        </FormItem>
      </FormField>

      <slot
        name="footer"
        :is-submitting="isSubmitting"
        :is-disabled="props.loading || isSubmitting"
      />
    </form>
  </Form>
</template>
