<script lang="ts" setup>
/**
 * The logged "view as admin" step for a settings table. Other members'
 * private chats / memories stay hidden from an admin until they confirm
 * here; confirming records an audit entry and unlocks the table for a
 * short window (see `useAdminView`).
 */
import { useAdminView } from "@/composables/useAdminView"
import type { AdminViewKind } from "@lectornaut/shared/domain"
import { computed } from "vue"
import { toast } from "vue-sonner"

const props = defineProps<{ kind: AdminViewKind }>()

const { t, d } = useI18n()
const { active, expiresAt, start } = useAdminView(props.kind)

const until = computed(() =>
  d(new Date(expiresAt.value), { hour: "numeric", minute: "2-digit" })
)

const confirm = async () => {
  try {
    await start()
  } catch (error) {
    toast.error(t("settings.adminView.error"))
    throw error
  }
}
</script>

<template>
  <Field orientation="horizontal">
    <FieldContent>
      <FieldLabel>
        {{
          active
            ? t("settings.adminView.onLabel", { time: until })
            : t(`settings.adminView.${kind}.offLabel`)
        }}
      </FieldLabel>
      <FieldDescription>
        {{
          active
            ? t("settings.adminView.onDescription")
            : t("settings.adminView.offDescription")
        }}
      </FieldDescription>
    </FieldContent>
    <ConfirmAction
      v-if="!active"
      :title="t(`settings.adminView.${kind}.confirmTitle`)"
      :description="t('settings.adminView.confirmDescription')"
      :action-label="t('settings.adminView.confirmAction')"
      :on-confirm="confirm"
    >
      <template #trigger>
        <Button variant="outline">
          {{ t("settings.adminView.show") }}
        </Button>
      </template>
    </ConfirmAction>
  </Field>
</template>
