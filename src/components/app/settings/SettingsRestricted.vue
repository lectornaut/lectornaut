<script lang="ts" setup>
import { IconAlertTriangle } from "@/data/icons"

/**
 * Shared "no view access" wall for Tier-A settings pages. Rendered as the
 * `v-else` branch when `useCanViewTeamSettings().canViewTeamSettings` is
 * false (i.e. the current user is a guest). Centralizes the empty-state
 * markup so the eight content pages don't each duplicate it.
 */
const { t } = useI18n()
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("settings.viewRestricted.title") }}
                </EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.viewRestricted.description") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>
