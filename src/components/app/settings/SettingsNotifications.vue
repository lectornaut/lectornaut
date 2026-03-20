<script lang="ts" setup>
import { IconBellRing } from "@/data/icons"
import { useSettingsStore } from "@/stores/settingsStore"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const settingsStore = useSettingsStore()
const {
  notificationSettings,
  isUpdatingNotifications,
  isSendingTestNotification,
} = storeToRefs(settingsStore)
const {
  updateNotificationCategory,
  updateNotificationFrequency,
  updateNotificationChannel,
  sendTestNotification,
} = settingsStore

const toBoolean = (value: unknown): boolean => value === true
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
          <Switch
            id="communication-notifications"
            :disabled="isUpdatingNotifications"
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
          <Switch
            id="marketing-notifications"
            :disabled="isUpdatingNotifications"
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
        <FieldLabel>{{
          t("settings.notifications.frequency.label")
        }}</FieldLabel>
        <FieldDescription>
          {{ t("settings.notifications.frequency.description") }}
        </FieldDescription>
        <RadioGroup
          :disabled="isUpdatingNotifications"
          :model-value="notificationSettings.frequency"
          @update:model-value="updateNotificationFrequency"
        >
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
          <ButtonGroup>
            <ButtonGroup>
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
                      :aria-label="
                        t('settings.notifications.channels.test', {
                          channel: t(
                            'settings.notifications.channels.email.label'
                          ),
                        })
                      "
                      @click="sendTestNotification('email')"
                    >
                      <Spinner v-if="isSendingTestNotification === 'email'" />
                      <IconBellRing v-else />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      t("settings.notifications.channels.test", {
                        channel: t(
                          "settings.notifications.channels.email.label"
                        ),
                      })
                    }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ButtonGroup>
            <ButtonGroup class="items-center">
              <Switch
                id="email-notifications"
                :disabled="isUpdatingNotifications"
                :model-value="notificationSettings.channels.email"
                @update:model-value="
                  updateNotificationChannel('email', toBoolean($event))
                "
              />
            </ButtonGroup>
          </ButtonGroup>
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
          <ButtonGroup>
            <ButtonGroup>
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
                      :aria-label="
                        t('settings.notifications.channels.test', {
                          channel: t(
                            'settings.notifications.channels.inApp.label'
                          ),
                        })
                      "
                      @click="sendTestNotification('inApp')"
                    >
                      <Spinner v-if="isSendingTestNotification === 'inApp'" />
                      <IconBellRing v-else />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      t("settings.notifications.channels.test", {
                        channel: t(
                          "settings.notifications.channels.inApp.label"
                        ),
                      })
                    }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ButtonGroup>
            <ButtonGroup class="items-center">
              <Switch
                id="inapp-notifications"
                :disabled="isUpdatingNotifications"
                :model-value="notificationSettings.channels.inApp"
                @update:model-value="
                  updateNotificationChannel('inApp', toBoolean($event))
                "
              />
            </ButtonGroup>
          </ButtonGroup>
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
          <ButtonGroup>
            <ButtonGroup>
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
                      :aria-label="
                        t('settings.notifications.channels.test', {
                          channel: t(
                            'settings.notifications.channels.native.label'
                          ),
                        })
                      "
                      @click="sendTestNotification('native')"
                    >
                      <Spinner v-if="isSendingTestNotification === 'native'" />
                      <IconBellRing v-else />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      t("settings.notifications.channels.test", {
                        channel: t(
                          "settings.notifications.channels.native.label"
                        ),
                      })
                    }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ButtonGroup>
            <ButtonGroup class="items-center">
              <Switch
                id="app-notifications"
                :disabled="isUpdatingNotifications"
                :model-value="notificationSettings.channels.native"
                @update:model-value="
                  updateNotificationChannel('native', toBoolean($event))
                "
              />
            </ButtonGroup>
          </ButtonGroup>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>
