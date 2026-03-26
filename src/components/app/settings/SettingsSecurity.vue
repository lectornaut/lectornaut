<script lang="ts" setup>
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { useSsoConfig } from "@/composables/useSsoConfig"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconCheck,
  IconCircleAlert,
  IconGlobe,
  IconSettings,
  IconShieldCheck,
  IconTrash,
} from "@/data/icons"
import { showErrorToast } from "@/helpers/toast"
import type { SsoProtocol } from "@/types/sso"

const emit = defineEmits<{
  navigate: [tab: string]
}>()

const { currentTeam } = useTeamActions()

const teamId = computed(() => currentTeam.value?.id ?? null)
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
  savingApprovedDomains,
  saveSsoConfig,
  deleteSsoConfig,
  testConnection,
  saveLoginMethods,
  saveApprovedDomains,
} = useSsoConfig(teamId)

type LoginMethodKey =
  | "emailPassword"
  | "magicLink"
  | "google"
  | "microsoft"
  | "apple"
  | "sso"

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
    showErrorToast("Invalid domain format", "Use e.g. acme.com")
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

// Populate form from existing config
watch(
  ssoConfig,
  (config) => {
    if (!config) return
    ssoProtocol.value = config.protocol || "saml"
    ssoDomains.value = config.domains || []
    ssoEnforced.value = config.enforced || false
    ssoAutoProvision.value = config.autoProvision || false
    ssoDefaultRole.value = config.defaultRole || "member"

    if (config.saml) {
      samlIdpEntityId.value = config.saml.idpEntityId || ""
      samlSsoUrl.value = config.saml.ssoUrl || ""
      samlCertificate.value = config.saml.certificate || ""
    }
    if (config.oidc) {
      oidcIssuer.value = config.oidc.issuer || ""
      oidcClientId.value = config.oidc.clientId || ""
    }
  },
  { immediate: true }
)

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

const deleteSsoDialog = useConfirmationDialog()
const handleDeleteSso = () => deleteSsoDialog.confirm(() => deleteSsoConfig())
</script>

<template>
  <div class="flex grow flex-col justify-between">
    <div class="p-6">
      <!-- Enterprise plan gate -->
      <Empty v-if="!isEnterprise">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconShieldCheck />
          </EmptyMedia>
          <EmptyTitle>Enterprise Security</EmptyTitle>
          <EmptyDescription>
            SSO and advanced login method controls are available on the
            Enterprise plan. Upgrade to configure SAML, OIDC, and per-team
            authentication policies.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" @click="emit('navigate', 'plans')">
            View Plans
          </Button>
        </EmptyContent>
      </Empty>
      <template v-else>
        <div v-if="loading" class="flex justify-center py-12">
          <Spinner />
        </div>
        <FieldGroup v-else>
          <!-- Section: Approved Domains -->
          <FieldSet>
            <Field>
              <FieldContent>
                <FieldLabel for="approved-domains">Approved Domains</FieldLabel>
                <FieldDescription>
                  Anyone with an email address at these domains is allowed to
                  sign up and join this team automatically.
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
                <InputGroupButton variant="ghost" size="icon-xs" disabled>
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
                  placeholder="acme.com"
                  type="url"
                  class="border-none p-0 focus:border-inherit focus:ring-0"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
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
                    <TooltipContent>Save</TooltipContent>
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
                <FieldLabel>Authentication Methods</FieldLabel>
                <FieldDescription>
                  Control which authentication methods are available for your
                  team members.
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Email & Password</FieldLabel>
                <FieldDescription>
                  Traditional email and password sign-in.
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="updatingMethod === 'emailPassword'">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
                </ButtonGroup>
                <ButtonGroup>
                  <Switch
                    :model-value="loginMethods.emailPassword"
                    :disabled="
                      isLastNonSsoMethod('emailPassword') ||
                      updatingMethod !== null
                    "
                    @update:model-value="
                      updateMethod('emailPassword', toBoolean($event))
                    "
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Magic Link</FieldLabel>
                <FieldDescription>
                  Passwordless sign-in via email link.
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="updatingMethod === 'magicLink'">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
                </ButtonGroup>
                <ButtonGroup>
                  <Switch
                    :model-value="loginMethods.magicLink"
                    :disabled="
                      isLastNonSsoMethod('magicLink') || updatingMethod !== null
                    "
                    @update:model-value="
                      updateMethod('magicLink', toBoolean($event))
                    "
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Google</FieldLabel>
                <FieldDescription>
                  Sign in with Google account.
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="updatingMethod === 'google'">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
                </ButtonGroup>
                <ButtonGroup>
                  <Switch
                    :model-value="loginMethods.google"
                    :disabled="
                      isLastNonSsoMethod('google') || updatingMethod !== null
                    "
                    @update:model-value="
                      updateMethod('google', toBoolean($event))
                    "
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Microsoft</FieldLabel>
                <FieldDescription>
                  Sign in with Microsoft account.
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="updatingMethod === 'microsoft'">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
                </ButtonGroup>
                <ButtonGroup>
                  <Switch
                    :model-value="loginMethods.microsoft"
                    :disabled="
                      isLastNonSsoMethod('microsoft') || updatingMethod !== null
                    "
                    @update:model-value="
                      updateMethod('microsoft', toBoolean($event))
                    "
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Apple</FieldLabel>
                <FieldDescription>
                  Sign in with Apple account.
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="updatingMethod === 'apple'">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
                </ButtonGroup>
                <ButtonGroup>
                  <Switch
                    :model-value="loginMethods.apple"
                    :disabled="
                      isLastNonSsoMethod('apple') || updatingMethod !== null
                    "
                    @update:model-value="
                      updateMethod('apple', toBoolean($event))
                    "
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>SSO</FieldLabel>
                <FieldDescription>
                  Enterprise Single Sign-On (SAML / OIDC).
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
                            !loginMethods.sso || updatingMethod !== null
                          "
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
                      <TooltipContent>Configure SSO</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </ButtonGroup>
                <ButtonGroup>
                  <Switch
                    :model-value="loginMethods.sso"
                    :disabled="updatingMethod !== null"
                    @update:model-value="updateMethod('sso', toBoolean($event))"
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>

            <Alert
              v-if="onlySsoEnabled"
              class="bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
            >
              <IconCircleAlert />
              <AlertTitle>SSO-only access</AlertTitle>
              <AlertDescription>
                Only SSO is enabled. Users whose email domain is not configured
                for SSO will not be able to sign in. Enable at least one
                additional method to ensure all users retain access.
              </AlertDescription>
            </Alert>
          </FieldSet>
          <!-- SSO Configuration Dialog -->
          <Dialog v-model:open="ssoConfigDialogOpen">
            <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle class="flex items-center gap-2">
                  SSO Configuration
                  <Badge v-if="hasSso" variant="secondary">
                    <IconShieldCheck class="size-3" />
                    Active
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Configure SAML or OIDC single sign-on for your organization.
                </DialogDescription>
              </DialogHeader>

              <FieldSet class="grid gap-4">
                <!-- Protocol Selector -->
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel>Protocol</FieldLabel>
                    <FieldDescription>
                      Choose your identity provider protocol.
                    </FieldDescription>
                  </FieldContent>
                  <Select v-model="ssoProtocol">
                    <SelectTrigger class="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="saml">SAML</SelectItem>
                      <SelectItem value="oidc">OIDC</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <!-- SAML Fields -->
                <template v-if="ssoProtocol === 'saml'">
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>IdP Entity ID</FieldLabel>
                      <FieldDescription>
                        The entity ID of your SAML identity provider.
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      v-model="samlIdpEntityId"
                      placeholder="https://idp.example.com/entity"
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>SSO URL</FieldLabel>
                      <FieldDescription>
                        The single sign-on URL of your identity provider.
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      v-model="samlSsoUrl"
                      placeholder="https://idp.example.com/sso"
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>Certificate</FieldLabel>
                      <FieldDescription>
                        The X.509 signing certificate from your identity
                        provider (PEM format).
                      </FieldDescription>
                    </FieldContent>
                    <Textarea
                      v-model="samlCertificate"
                      placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                      class="font-mono text-xs"
                      rows="6"
                    />
                  </Field>
                </template>

                <!-- OIDC Fields -->
                <template v-if="ssoProtocol === 'oidc'">
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>Issuer URL</FieldLabel>
                      <FieldDescription>
                        The OIDC issuer URL (must support
                        /.well-known/openid-configuration).
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      v-model="oidcIssuer"
                      placeholder="https://accounts.example.com"
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>Client ID</FieldLabel>
                      <FieldDescription>
                        The OIDC client ID registered with your identity
                        provider.
                      </FieldDescription>
                    </FieldContent>
                    <Input v-model="oidcClientId" placeholder="client-id" />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>Client Secret</FieldLabel>
                      <FieldDescription>
                        The OIDC client secret. This is stored securely and
                        never exposed to the client.
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      v-model="oidcClientSecret"
                      type="password"
                      placeholder="client-secret"
                    />
                  </Field>
                </template>

                <!-- Shared SSO Settings -->
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel>Email Domains</FieldLabel>
                    <FieldDescription>
                      Add email domains that should use SSO (e.g., acme.com).
                    </FieldDescription>
                  </FieldContent>
                  <TagsInput
                    :model-value="ssoDomains"
                    :add-on-paste="true"
                    :delimiter="','"
                    class="w-full"
                    @update:model-value="
                      ssoDomains = filterValidDomains($event as string[])
                    "
                  >
                    <TagsInputItem
                      v-for="domain in ssoDomains"
                      :key="domain"
                      :value="domain"
                    >
                      <TagsInputItemText />
                      <TagsInputItemDelete />
                    </TagsInputItem>
                    <TagsInputInput placeholder="Add domain..." />
                  </TagsInput>
                </Field>

                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel>Enforce SSO</FieldLabel>
                    <FieldDescription>
                      When enabled, users with matching email domains must use
                      SSO. Password and social logins will be blocked for these
                      users.
                    </FieldDescription>
                  </FieldContent>
                  <Switch v-model="ssoEnforced" />
                </Field>

                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel> Auto-provision Members </FieldLabel>
                    <FieldDescription>
                      Automatically create a team membership when a user signs
                      in via SSO for the first time.
                    </FieldDescription>
                  </FieldContent>
                  <Switch v-model="ssoAutoProvision" />
                </Field>

                <Field v-if="ssoAutoProvision" orientation="horizontal">
                  <FieldContent>
                    <FieldLabel>Default Role</FieldLabel>
                    <FieldDescription>
                      The role assigned to auto-provisioned members.
                    </FieldDescription>
                  </FieldContent>
                  <Select v-model="ssoDefaultRole">
                    <SelectTrigger class="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="guest">Guest</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <!-- Delete SSO -->
                <Field v-if="hasSso" orientation="horizontal">
                  <FieldContent>
                    <FieldLabel class="text-destructive text-sm">
                      Remove SSO
                    </FieldLabel>
                    <FieldDescription>
                      Remove SSO configuration. Users will fall back to other
                      login methods.
                    </FieldDescription>
                  </FieldContent>
                  <Button
                    variant="destructive"
                    :disabled="deleting"
                    @click="deleteSsoDialog.open(null)"
                  >
                    <Spinner v-if="deleting" />
                    <template v-else>
                      <IconTrash />
                      Remove SSO
                    </template>
                  </Button>
                </Field>
              </FieldSet>

              <DialogFooter class="flex-row justify-between sm:justify-between">
                <Button
                  variant="outline"
                  :disabled="testing || !canSaveSso"
                  @click="handleTestConnection"
                >
                  <Spinner v-if="testing" />
                  Test Connection
                </Button>
                <div class="flex gap-2">
                  <DialogClose as-child>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <Button
                    :disabled="saving || !canSaveSso"
                    @click="handleSaveSso"
                  >
                    <Spinner v-if="saving" />
                    {{ hasSso ? "Update SSO" : "Enable SSO" }}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </FieldGroup>
      </template>
    </div>
    <!-- Delete SSO Confirmation Dialog -->
    <AlertDialog v-model:open="deleteSsoDialog.isOpen.value">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove SSO Configuration</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove SSO? Users with SSO-enforced domains
            will need to use other login methods. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            class="text-current"
            :disabled="deleting"
            @click.prevent="handleDeleteSso"
          >
            <Spinner v-if="deleting" />
            Remove SSO
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
