<script lang="ts" setup>
import { IconBellRing } from "@/data/icons"
import { useNotificationSettingsStore } from "@/stores/notificationSettingsStore"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const notificationSettingsStore = useNotificationSettingsStore()
const {
  notificationSettings,
  isUpdatingNotifications,
  isSendingTestNotification,
} = storeToRefs(notificationSettingsStore)
const {
  updateNotificationCategory,
  updateNotificationFrequency,
  updateNotificationChannel,
  sendTestNotification,
} = notificationSettingsStore

const toBoolean = (value: unknown): boolean => value === true

const frequencyOptions = computed(() => [
  {
    value: "immediate",
    label: t("settings.notifications.frequency.immediate"),
  },
  { value: "daily", label: t("settings.notifications.frequency.daily") },
  { value: "weekly", label: t("settings.notifications.frequency.weekly") },
  { value: "none", label: t("settings.notifications.frequency.none") },
])
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.notifications.categories.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.categories.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>
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
          <InputGroupButton
            v-if="isUpdatingNotifications === 'communication'"
            variant="ghost"
            size="icon-xs"
            disabled
          >
            <Spinner />
          </InputGroupButton>
          <Switch
            id="communication-notifications"
            :disabled="isUpdatingNotifications !== null"
            :model-value="notificationSettings.categories.communication"
            @update:model-value="
              updateNotificationCategory('communication', toBoolean($event))
            "
          />
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
          <InputGroupButton
            v-if="isUpdatingNotifications === 'marketing'"
            variant="ghost"
            size="icon-xs"
            disabled
          >
            <Spinner />
          </InputGroupButton>
          <Switch
            id="marketing-notifications"
            :disabled="isUpdatingNotifications !== null"
            :model-value="notificationSettings.categories.marketing"
            @update:model-value="
              updateNotificationCategory('marketing', toBoolean($event))
            "
          />
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
          <Switch
            id="security-notifications"
            :model-value="notificationSettings.categories.security"
            disabled
          />
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="notification-frequency">
              {{ t("settings.notifications.frequency.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.frequency.description") }}
            </FieldDescription>
          </FieldContent>
          <Select
            :disabled="isUpdatingNotifications !== null"
            :model-value="notificationSettings.frequency"
            @update:model-value="updateNotificationFrequency"
          >
            <SelectTrigger id="notification-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="option in frequencyOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.notifications.channels.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.channels.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="email-notifications">
              {{ t("settings.notifications.channels.email.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.channels.email.description") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="
                    isUpdatingNotifications ||
                    !notificationSettings.channels.email ||
                    isSendingTestNotification !== null
                  "
                  @click="sendTestNotification('email')"
                >
                  <Spinner
                    v-if="
                      isSendingTestNotification === 'email' ||
                      isUpdatingNotifications === 'email'
                    "
                  />
                  <IconBellRing v-else />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  t("settings.notifications.channels.test", {
                    channel: t("settings.notifications.channels.email.label"),
                  })
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch
            id="email-notifications"
            :disabled="isUpdatingNotifications !== null"
            :model-value="notificationSettings.channels.email"
            @update:model-value="
              updateNotificationChannel('email', toBoolean($event))
            "
          />
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="
                    isUpdatingNotifications ||
                    !notificationSettings.channels.inApp ||
                    isSendingTestNotification !== null
                  "
                  @click="sendTestNotification('inApp')"
                >
                  <Spinner
                    v-if="
                      isSendingTestNotification === 'inApp' ||
                      isUpdatingNotifications === 'inApp'
                    "
                  />
                  <IconBellRing v-else />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  t("settings.notifications.channels.test", {
                    channel: t("settings.notifications.channels.inApp.label"),
                  })
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch
            id="inapp-notifications"
            :disabled="isUpdatingNotifications !== null"
            :model-value="notificationSettings.channels.inApp"
            @update:model-value="
              updateNotificationChannel('inApp', toBoolean($event))
            "
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="app-notifications">
              {{ t("settings.notifications.channels.native.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.notifications.channels.native.description") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="
                    isUpdatingNotifications ||
                    !notificationSettings.channels.native ||
                    isSendingTestNotification !== null
                  "
                  @click="sendTestNotification('native')"
                >
                  <Spinner
                    v-if="
                      isSendingTestNotification === 'native' ||
                      isUpdatingNotifications === 'native'
                    "
                  />
                  <IconBellRing v-else />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  t("settings.notifications.channels.test", {
                    channel: t("settings.notifications.channels.native.label"),
                  })
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch
            id="app-notifications"
            :disabled="isUpdatingNotifications !== null"
            :model-value="notificationSettings.channels.native"
            @update:model-value="
              updateNotificationChannel('native', toBoolean($event))
            "
          />
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>
