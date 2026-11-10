<script lang="ts" setup>
import { useCopy } from "@/composables/useCopy"
import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import { useDismissGuard } from "@/composables/useDismissGuard"
import { useSsoConfig } from "@/composables/useSsoConfig"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleAlert,
  IconCopy,
  IconGlobe,
  IconSettings,
  IconShieldCheck,
  IconTrash,
} from "@/data/icons"
import { showErrorToast } from "@/helpers/toast"
import type { SsoProtocol } from "@/types/sso"

const { t } = useI18n()

const emit = defineEmits<{
  navigate: [tab: string]
}>()

const { currentTeam } = useTeamActions()

const teamId = computed(() => currentTeam.value?.id ?? null)

// Role gate — Security is owner/admin-only via the dedicated
// MANAGE_SECURITY capability. Checked before the enterprise-plan gate so
// non-admins see a "no permission" state rather than an upgrade upsell
// they couldn't action.
const { canManageSecurity } = useCurrentTeamRole(teamId)

const isEnterprise = computed(
  () => currentTeam.value?.billing?.planKey === "enterprise"
)

const {
  loginMethods,
  approvedDomains,
  ssoConfig,
  hasSso,
  loading,
  saving,
  deleting,
  testing,
  verifying,
  savingApprovedDomains,
  saveSsoConfig,
  deleteSsoConfig,
  testConnection,
  verifyDomain,
  saveLoginMethods,
  saveApprovedDomains,
} = useSsoConfig(teamId)

// Saved domains only — verification proves the persisted config, not the draft.
const savedSsoDomains = computed(() =>
  hasSso.value ? (ssoConfig.value.domains ?? []) : []
)
const isDomainVerified = (domain: string) =>
  (ssoConfig.value.verifiedDomains ?? []).includes(domain)
const txtRecordFor = (domain: string) => {
  const token = ssoConfig.value.verificationTokens?.[domain]
  return token ? `lectornaut-domain-verification=${token}` : ""
}
const verifyingDomain = ref<string | null>(null)
const handleVerifyDomain = async (domain: string) => {
  verifyingDomain.value = domain
  try {
    await verifyDomain(domain)
  } catch {
    // Surfaced by the action runner's toast.
  } finally {
    verifyingDomain.value = null
  }
}
const { copy: copyTxtRecord } = useCopy()

type LoginMethodKey =
  "emailPassword" | "magicLink" | "google" | "microsoft" | "apple" | "sso"

/** Tracks which specific method is currently being saved (null = idle). */
const updatingMethod = ref<LoginMethodKey | null>(null)

const toBoolean = (value: unknown): boolean => Boolean(value)

/**
 * Count how many non-SSO methods are currently enabled.
 * SSO alone is not sufficient because it only covers users
 * whose email domain is configured — everyone else would be locked out.
 */
const enabledNonSsoCount = computed(() => {
  const m = loginMethods.value
  return [m.emailPassword, m.magicLink, m.google, m.microsoft, m.apple].filter(
    Boolean
  ).length
})

/** True when the only remaining enabled method is SSO (no fallback). */
const onlySsoEnabled = computed(
  () => enabledNonSsoCount.value === 0 && loginMethods.value.sso
)

/**
 * Returns true when a specific method's switch should be disabled
 * because it is the last non-SSO method keeping access open.
 */
function isLastNonSsoMethod(key: Exclude<LoginMethodKey, "sso">): boolean {
  return enabledNonSsoCount.value === 1 && loginMethods.value[key]
}

/**
 * Toggle a single auth method and save immediately.
 * Matches the SettingsPreferences pattern: toggle → save → spinner per-switch.
 */
const updateMethod = async (key: LoginMethodKey, value: boolean) => {
  // Guard: don't allow disabling the last non-SSO method
  if (
    !value &&
    key !== "sso" &&
    isLastNonSsoMethod(key as Exclude<LoginMethodKey, "sso">)
  ) {
    return
  }

  updatingMethod.value = key
  await saveLoginMethods({ ...loginMethods.value, [key]: value })
  updatingMethod.value = null
}

// Local form state for approved domains (string[] for TagsInput)
const localApprovedDomains = ref<string[]>([])
const approvedDomainsHydrated = ref(false)

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** Matches the server-side isValidDomain in functions/src/sso.ts */
const isValidDomain = (domain: string) =>
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
    domain
  )

/** Normalize and filter domain tags — rejects invalid entries with a toast. */
const filterValidDomains = (values: string[]): string[] => {
  const normalized = values.map((v) => v.trim().toLowerCase()).filter(Boolean)
  const valid = normalized.filter(isValidDomain)
  if (valid.length < normalized.length) {
    showErrorToast(
      t("settings.security.sso.invalidDomainFormat"),
      t("settings.security.sso.invalidDomainExample")
    )
  }
  return valid
}

// Sync server → local (skip if contents match to prevent feedback loops)
watch(
  approvedDomains,
  (domains) => {
    const incoming = domains || []
    if (!arraysEqual(incoming, localApprovedDomains.value)) {
      localApprovedDomains.value = incoming
    }
    approvedDomainsHydrated.value = true
  },
  { immediate: true }
)

// Auto-save when user changes tags (skip if unchanged from server)
watch(localApprovedDomains, (domains) => {
  if (!approvedDomainsHydrated.value) return
  const server = approvedDomains.value || []
  if (arraysEqual(domains, server)) return
  saveApprovedDomains(domains)
})

// Local form state for SSO config
const ssoProtocol = ref<SsoProtocol>("saml")
const ssoDomains = ref<string[]>([])
const ssoEnforced = ref(false)
const ssoAutoProvision = ref(false)
const ssoDefaultRole = ref<"member" | "guest">("member")

// SAML fields
const samlIdpEntityId = ref("")
const samlSsoUrl = ref("")
const samlCertificate = ref("")

// OIDC fields
const oidcIssuer = ref("")
const oidcClientId = ref("")
const oidcClientSecret = ref("")

// Populate form from existing config (or the empty defaults when none).
const hydrateSso = (config: typeof ssoConfig.value) => {
  ssoProtocol.value = config?.protocol || "saml"
  ssoDomains.value = [...(config?.domains || [])]
  ssoEnforced.value = config?.enforced || false
  ssoAutoProvision.value = config?.autoProvision || false
  ssoDefaultRole.value = config?.defaultRole || "member"
  samlIdpEntityId.value = config?.saml?.idpEntityId || ""
  samlSsoUrl.value = config?.saml?.ssoUrl || ""
  samlCertificate.value = config?.saml?.certificate || ""
  oidcIssuer.value = config?.oidc?.issuer || ""
  oidcClientId.value = config?.oidc?.clientId || ""
  oidcClientSecret.value = ""
}

watch(ssoConfig, (config) => config && hydrateSso(config), {
  immediate: true,
})

const canSaveSso = computed(() => {
  if (ssoDomains.value.length === 0) return false
  if (ssoProtocol.value === "saml") {
    return Boolean(
      samlIdpEntityId.value && samlSsoUrl.value && samlCertificate.value
    )
  }
  if (ssoProtocol.value === "oidc") {
    return Boolean(
      oidcIssuer.value && oidcClientId.value && oidcClientSecret.value
    )
  }
  return false
})

const handleTestConnection = async () => {
  if (ssoProtocol.value === "saml") {
    await testConnection({
      protocol: "saml",
      saml: {
        ssoUrl: samlSsoUrl.value,
        certificate: samlCertificate.value,
      },
    })
  } else {
    await testConnection({
      protocol: "oidc",
      oidc: { issuer: oidcIssuer.value },
    })
  }
}

const handleSaveSso = async () => {
  try {
    await persistSso()
    ssoConfigDialogOpen.value = false
  } catch {
    // Already surfaced by the action runner's toast; keep the draft open.
  }
}

const persistSso = async () => {
  const base = {
    protocol: ssoProtocol.value,
    domains: ssoDomains.value,
    enforced: ssoEnforced.value,
    autoProvision: ssoAutoProvision.value,
    defaultRole: ssoDefaultRole.value,
  }

  if (ssoProtocol.value === "saml") {
    await saveSsoConfig({
      ...base,
      saml: {
        idpEntityId: samlIdpEntityId.value,
        ssoUrl: samlSsoUrl.value,
        certificate: samlCertificate.value,
      },
    })
  } else {
    await saveSsoConfig({
      ...base,
      oidc: {
        issuer: oidcIssuer.value,
        clientId: oidcClientId.value,
        clientSecret: oidcClientSecret.value,
      },
    })
  }
}

const ssoConfigDialogOpen = ref(false)

// Dirty = the form differs from the saved config it was hydrated from on open.
const ssoSnapshot = () =>
  JSON.stringify([
    ssoProtocol.value,
    ssoDomains.value,
    ssoEnforced.value,
    ssoAutoProvision.value,
    ssoDefaultRole.value,
    samlIdpEntityId.value,
    samlSsoUrl.value,
    samlCertificate.value,
    oidcIssuer.value,
    oidcClientId.value,
    oidcClientSecret.value,
  ])
const ssoBaseline = ref("")
const ssoGuard = useDismissGuard(
  ssoConfigDialogOpen,
  () => ssoSnapshot() !== ssoBaseline.value
)

// Every open starts from the saved config, so a dismissed draft never
// lingers into the next open.
watch(ssoConfigDialogOpen, (isOpen) => {
  if (!isOpen) return
  hydrateSso(ssoConfig.value)
  ssoBaseline.value = ssoSnapshot()
})

const deleteSsoOpen = ref(false)
const handleDeleteSso = async () => {
  await deleteSsoConfig()
  ssoConfigDialogOpen.value = false
}
</script>

<template>
  <div class="p-6">
    <ConfirmAction
      v-model:open="deleteSsoOpen"
      :title="t('settings.security.sso.removeConfirmTitle')"
      :description="t('settings.security.sso.removeConfirmDescription')"
      :action-label="t('settings.security.sso.removeLabel')"
      destructive
      :on-confirm="handleDeleteSso"
    />
    <ConfirmAction
      v-model:open="ssoGuard.confirmOpen.value"
      :title="t('common.discardChangesTitle')"
      :description="t('common.discardChangesDescription')"
      :action-label="t('common.discard')"
      :cancel-label="t('common.keepEditing')"
      destructive
      :on-confirm="ssoGuard.discard"
    />
    <FieldGroup v-if="!canManageSecurity">
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>{{
                  t("settings.security.noPermissionTitle")
                }}</EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.security.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
      </FieldSet>
    </FieldGroup>
    <FieldGroup v-else-if="!isEnterprise">
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconShieldCheck />
                </EmptyMedia>
                <EmptyTitle>{{
                  t("settings.security.enterprise.title")
                }}</EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.security.enterprise.description") }}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" @click="emit('navigate', 'plans')">
                  {{ t("settings.security.enterprise.viewPlans") }}
                </Button>
              </EmptyContent>
            </Empty>
          </FieldContent>
        </Field>
      </FieldSet>
    </FieldGroup>
    <template v-else>
      <LoadingState v-if="loading" />
      <FieldGroup v-else>
        <!-- Section: Approved Domains -->
        <FieldSet>
          <Field>
            <FieldContent>
              <FieldLabel for="approved-domains">{{
                t("settings.security.approvedDomains.label")
              }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.approvedDomains.description") }}
              </FieldDescription>
            </FieldContent>
            <TagsInput
              id="approved-domains"
              :model-value="localApprovedDomains"
              :disabled="savingApprovedDomains"
              :add-on-paste="true"
              :delimiter="','"
              class="group"
              @update:model-value="
                localApprovedDomains = filterValidDomains($event as string[])
              "
            >
              <InputGroupButton
                variant="ghost"
                size="icon-xs"
                disabled
                aria-hidden="true"
              >
                <IconGlobe />
              </InputGroupButton>
              <TagsInputItem
                v-for="domain in localApprovedDomains"
                :key="domain"
                :value="domain"
              >
                <TagsInputItemText />
                <TagsInputItemDelete />
              </TagsInputItem>
              <TagsInputInput
                :placeholder="
                  t('settings.security.approvedDomains.placeholder')
                "
                type="url"
                class="placeholder:text-muted-foreground border-none bg-transparent focus:border-inherit focus:ring-0"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      :aria-label="t('actions.save')"
                      variant="ghost"
                      size="icon-xs"
                      class="invisible group-focus-within:visible"
                      :disabled="savingApprovedDomains"
                      @click="saveApprovedDomains(localApprovedDomains)"
                    >
                      <Spinner v-if="savingApprovedDomains" />
                      <IconCheck v-else />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>{{ t("actions.save") }}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TagsInput>
          </Field>
        </FieldSet>
        <FieldSeparator />
        <!-- Section: Authentication Methods -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{
                t("settings.security.authenticationMethods.label")
              }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.authenticationMethods.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{
                t("settings.security.emailPassword.label")
              }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.emailPassword.description") }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="updatingMethod === 'emailPassword'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              :model-value="loginMethods.emailPassword"
              :disabled="
                isLastNonSsoMethod('emailPassword') || updatingMethod !== null
              "
              @update:model-value="
                updateMethod('emailPassword', toBoolean($event))
              "
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{
                t("settings.security.magicLink.label")
              }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.magicLink.description") }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="updatingMethod === 'magicLink'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              :model-value="loginMethods.magicLink"
              :disabled="
                isLastNonSsoMethod('magicLink') || updatingMethod !== null
              "
              @update:model-value="updateMethod('magicLink', toBoolean($event))"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ t("settings.security.google.label") }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.google.description") }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="updatingMethod === 'google'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              :model-value="loginMethods.google"
              :disabled="
                isLastNonSsoMethod('google') || updatingMethod !== null
              "
              @update:model-value="updateMethod('google', toBoolean($event))"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{
                t("settings.security.microsoft.label")
              }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.microsoft.description") }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="updatingMethod === 'microsoft'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              :model-value="loginMethods.microsoft"
              :disabled="
                isLastNonSsoMethod('microsoft') || updatingMethod !== null
              "
              @update:model-value="updateMethod('microsoft', toBoolean($event))"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ t("settings.security.apple.label") }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.apple.description") }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="updatingMethod === 'apple'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              :model-value="loginMethods.apple"
              :disabled="isLastNonSsoMethod('apple') || updatingMethod !== null"
              @update:model-value="updateMethod('apple', toBoolean($event))"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ t("settings.security.sso.label") }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.security.sso.description") }}
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    :aria-label="t('settings.security.sso.configure')"
                    variant="ghost"
                    size="icon-xs"
                    :disabled="!loginMethods.sso || updatingMethod !== null"
                    @click="ssoConfigDialogOpen = true"
                  >
                    <Spinner
                      v-if="
                        updatingMethod === 'sso' ||
                        saving ||
                        testing ||
                        deleting
                      "
                    />
                    <IconSettings v-else />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>{{
                  t("settings.security.sso.configure")
                }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Switch
              :model-value="loginMethods.sso"
              :disabled="updatingMethod !== null"
              @update:model-value="updateMethod('sso', toBoolean($event))"
            />
          </Field>

          <Alert
            v-if="onlySsoEnabled"
            class="bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
          >
            <IconCircleAlert />
            <AlertTitle>{{
              t("settings.security.sso.onlyEnabledTitle")
            }}</AlertTitle>
            <AlertDescription>
              {{ t("settings.security.sso.onlyEnabledDescription") }}
            </AlertDescription>
          </Alert>
        </FieldSet>
        <!-- SSO Configuration Dialog -->
        <Dialog
          :open="ssoConfigDialogOpen"
          @update:open="
            (next: boolean) => !saving && ssoGuard.onOpenChange(next)
          "
        >
          <DialogContent
            class="size-3/4 max-h-3/4! max-w-3/4! overflow-auto overscroll-none scroll-smooth"
          >
            <DialogHeader>
              <DialogTitle class="flex items-center gap-2">
                {{ t("settings.security.sso.configuration") }}
                <Badge v-if="hasSso" variant="secondary">
                  <IconShieldCheck />
                  {{ t("settings.security.sso.active") }}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {{ t("settings.security.sso.configurationDescription") }}
              </DialogDescription>
            </DialogHeader>
            <ScrollContainer class="-mx-6 w-[-webkit-fill-available]">
              <FieldGroup class="p-6">
                <FieldSet>
                  <!-- Shared SSO Settings -->
                  <Field>
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.security.sso.emailDomainsLabel")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.security.sso.emailDomainsDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <TagsInput
                      :model-value="ssoDomains"
                      :add-on-paste="true"
                      :delimiter="','"
                      class="group"
                      @update:model-value="
                        ssoDomains = filterValidDomains($event as string[])
                      "
                    >
                      <InputGroupButton
                        variant="ghost"
                        size="icon-xs"
                        disabled
                        aria-hidden="true"
                      >
                        <IconGlobe />
                      </InputGroupButton>
                      <TagsInputItem
                        v-for="domain in ssoDomains"
                        :key="domain"
                        :value="domain"
                      >
                        <TagsInputItemText />
                        <TagsInputItemDelete />
                      </TagsInputItem>
                      <TagsInputInput
                        :placeholder="
                          t('settings.security.approvedDomains.placeholder')
                        "
                        type="url"
                        class="placeholder:text-muted-foreground border-none bg-transparent focus:border-inherit focus:ring-0"
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <InputGroupButton
                              :aria-label="t('actions.save')"
                              variant="ghost"
                              size="icon-xs"
                              class="invisible group-focus-within:visible"
                              disabled
                            >
                              <IconCheck />
                            </InputGroupButton>
                          </TooltipTrigger>
                          <TooltipContent>{{
                            t("actions.save")
                          }}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TagsInput>
                  </Field>
                  <!-- Domain ownership: only verified domains enforce or route SSO -->
                  <Field v-if="savedSsoDomains.length">
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.security.sso.verificationLabel")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.security.sso.verificationDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <div class="flex flex-col gap-3">
                      <div
                        v-for="domain in savedSsoDomains"
                        :key="domain"
                        class="flex flex-col gap-1.5"
                      >
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-sm font-medium">{{ domain }}</span>
                          <Badge
                            v-if="isDomainVerified(domain)"
                            variant="secondary"
                          >
                            <IconShieldCheck />
                            {{ t("settings.security.sso.verified") }}
                          </Badge>
                          <Button
                            v-else
                            size="sm"
                            variant="outline"
                            :disabled="verifying || !txtRecordFor(domain)"
                            @click="handleVerifyDomain(domain)"
                          >
                            <Spinner v-if="verifyingDomain === domain" />
                            {{ t("settings.security.sso.verify") }}
                          </Button>
                        </div>
                        <InputGroup
                          v-if="
                            !isDomainVerified(domain) && txtRecordFor(domain)
                          "
                        >
                          <InputGroupInput
                            :model-value="txtRecordFor(domain)"
                            readonly
                            class="font-mono text-xs"
                            :aria-label="t('settings.security.sso.txtRecord')"
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              variant="ghost"
                              size="icon-xs"
                              :aria-label="t('actions.copy')"
                              @click="copyTxtRecord(txtRecordFor(domain))"
                            >
                              <IconCopy />
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </div>
                    </div>
                  </Field>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.security.sso.enforceLabel")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.security.sso.enforceDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <Switch v-model="ssoEnforced" />
                  </Field>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.security.sso.autoProvisionLabel")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{
                          t("settings.security.sso.autoProvisionDescription")
                        }}
                      </FieldDescription>
                    </FieldContent>
                    <Switch v-model="ssoAutoProvision" />
                  </Field>
                  <Field v-if="ssoAutoProvision" orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.security.sso.defaultRoleLabel")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.security.sso.defaultRoleDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <Select v-model="ssoDefaultRole">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="member">{{
                            t("labels.member")
                          }}</SelectItem>
                          <SelectItem value="guest">{{
                            t("labels.guest")
                          }}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <!-- Delete SSO -->
                  <Field v-if="hasSso" orientation="horizontal">
                    <FieldContent>
                      <FieldLabel class="text-destructive">
                        {{ t("settings.security.sso.removeLabel") }}
                      </FieldLabel>
                      <FieldDescription>
                        {{ t("settings.security.sso.removeDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <Button
                      variant="destructive"
                      :disabled="deleting"
                      @click="deleteSsoOpen = true"
                    >
                      <Spinner v-if="deleting" />
                      <template v-else>
                        <IconTrash />
                        {{ t("settings.security.sso.removeLabel") }}
                      </template>
                    </Button>
                  </Field>
                </FieldSet>
                <FieldSeparator />
                <FieldSet>
                  <!-- Protocol Selector -->
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.security.sso.protocolLabel")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.security.sso.protocolDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <Select v-model="ssoProtocol">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="saml">SAML</SelectItem>
                          <SelectItem value="oidc">OIDC</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldSet>
                <FieldSeparator />
                <FieldSet>
                  <!-- SAML Fields -->
                  <template v-if="ssoProtocol === 'saml'">
                    <Field>
                      <FieldContent>
                        <FieldLabel>{{
                          t("settings.security.sso.samlIdpEntityIdLabel")
                        }}</FieldLabel>
                        <FieldDescription>
                          {{
                            t(
                              "settings.security.sso.samlIdpEntityIdDescription"
                            )
                          }}
                        </FieldDescription>
                      </FieldContent>
                      <Input
                        v-model="samlIdpEntityId"
                        placeholder="https://idp.example.com/entity"
                      />
                    </Field>

                    <Field>
                      <FieldContent>
                        <FieldLabel>{{
                          t("settings.security.sso.samlSsoUrlLabel")
                        }}</FieldLabel>
                        <FieldDescription>
                          {{ t("settings.security.sso.samlSsoUrlDescription") }}
                        </FieldDescription>
                      </FieldContent>
                      <Input
                        v-model="samlSsoUrl"
                        placeholder="https://idp.example.com/sso"
                      />
                    </Field>

                    <Field>
                      <FieldContent>
                        <FieldLabel>{{
                          t("settings.security.sso.samlCertificateLabel")
                        }}</FieldLabel>
                        <FieldDescription>
                          {{
                            t(
                              "settings.security.sso.samlCertificateDescription"
                            )
                          }}
                        </FieldDescription>
                      </FieldContent>
                      <Textarea
                        v-model="samlCertificate"
                        placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                        class="font-mono text-xs"
                        rows="8"
                      />
                    </Field>
                  </template>

                  <!-- OIDC Fields -->
                  <template v-if="ssoProtocol === 'oidc'">
                    <Field>
                      <FieldContent>
                        <FieldLabel>{{
                          t("settings.security.sso.oidcIssuerLabel")
                        }}</FieldLabel>
                        <FieldDescription>
                          {{ t("settings.security.sso.oidcIssuerDescription") }}
                        </FieldDescription>
                      </FieldContent>
                      <Input
                        v-model="oidcIssuer"
                        placeholder="https://accounts.example.com"
                      />
                    </Field>

                    <Field>
                      <FieldContent>
                        <FieldLabel>{{
                          t("settings.security.sso.oidcClientIdLabel")
                        }}</FieldLabel>
                        <FieldDescription>
                          {{
                            t("settings.security.sso.oidcClientIdDescription")
                          }}
                        </FieldDescription>
                      </FieldContent>
                      <Input
                        v-model="oidcClientId"
                        :placeholder="
                          t('settings.security.sso.oidcClientIdPlaceholder')
                        "
                      />
                    </Field>

                    <Field>
                      <FieldContent>
                        <FieldLabel>{{
                          t("settings.security.sso.oidcClientSecretLabel")
                        }}</FieldLabel>
                        <FieldDescription>
                          {{
                            t(
                              "settings.security.sso.oidcClientSecretDescription"
                            )
                          }}
                        </FieldDescription>
                      </FieldContent>
                      <Input
                        v-model="oidcClientSecret"
                        type="password"
                        :placeholder="
                          t('settings.security.sso.oidcClientSecretPlaceholder')
                        "
                      />
                    </Field>
                  </template>
                </FieldSet>
              </FieldGroup>
            </ScrollContainer>
            <DialogFooter class="flex-row justify-between sm:justify-between">
              <Button
                variant="outline"
                :disabled="testing || !canSaveSso"
                @click="handleTestConnection"
              >
                <Spinner v-if="testing" />
                {{ t("settings.security.sso.testConnection") }}
              </Button>
              <div class="flex gap-2">
                <DialogClose as-child>
                  <Button variant="outline">
                    {{ t("actions.cancel") }}
                    <Kbd>Esc</Kbd>
                  </Button>
                </DialogClose>
                <Button
                  data-dialog-action
                  :disabled="saving || !canSaveSso"
                  @click="handleSaveSso"
                >
                  <Spinner v-if="saving" />
                  {{
                    hasSso
                      ? t("settings.security.sso.updateSso")
                      : t("settings.security.sso.enableSso")
                  }}
                  <Kbd>↩</Kbd>
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </FieldGroup>
    </template>
  </div>
</template>
