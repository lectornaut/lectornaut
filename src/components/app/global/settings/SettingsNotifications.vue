<script lang="ts" setup>
const { t } = useI18n()
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <FieldLabel>
          {{ t("settings.notifications.categories.label") }}
        </FieldLabel>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="communication-notifications">
              {{ t("settings.notifications.categories.communication.label") }}
            </FieldLabel>
            <FieldDescription>
              {{
                t("settings.notifications.categories.communication.description")
              }}
            </FieldDescription>
          </FieldContent>
          <Switch id="communication-notifications" :model-value="true" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="marketing-notifications">
              {{ t("settings.notifications.categories.marketing.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.categories.marketing.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="marketing-notifications" :model-value="true" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="security-notifications">
              {{ t("settings.notifications.categories.security.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.categories.security.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="security-notifications" :model-value="true" disabled />
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLabel>{{
          t("settings.notifications.frequency.label")
        }}</FieldLabel>
        <FieldDescription>
          {{ t("settings.notifications.frequency.description") }}
        </FieldDescription>
        <RadioGroup default-value="immediate">
          <Field orientation="horizontal">
            <RadioGroupItem id="notify-immediate" value="immediate" />
            <FieldLabel for="notify-immediate">
              {{ t("settings.notifications.frequency.immediate") }}
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem id="notify-daily" value="daily" />
            <FieldLabel for="notify-daily">
              {{ t("settings.notifications.frequency.daily") }}
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem id="notify-weekly" value="weekly" />
            <FieldLabel for="notify-weekly">
              {{ t("settings.notifications.frequency.weekly") }}
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem id="notify-none" value="none" />
            <FieldLabel for="notify-none">
              {{ t("settings.notifications.frequency.none") }}
            </FieldLabel>
          </Field>
        </RadioGroup>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLabel>{{
          t("settings.notifications.channels.label")
        }}</FieldLabel>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="email-notifications">
              {{ t("settings.notifications.channels.email.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.channels.email.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="email-notifications" :model-value="true" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="inapp-notifications">
              {{ t("settings.notifications.channels.inApp.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.channels.inApp.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="inapp-notifications" :model-value="true" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="push-notifications">
              {{ t("settings.notifications.channels.push.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.channels.push.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="push-notifications" :model-value="true" />
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>
