<script lang="ts" setup>
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { useSsoConfig } from "@/composables/useSsoConfig"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCircleAlert, IconShieldCheck, IconTrash } from "@/data/icons"
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

// Local form state for approved domains
const localApprovedDomains = ref("")

watch(
  approvedDomains,
  (domains) => {
    localApprovedDomains.value = (domains || []).join(", ")
  },
  { immediate: true }
)

const parsedApprovedDomains = computed(() =>
  localApprovedDomains.value
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
)

const handleSaveApprovedDomains = async () => {
  await saveApprovedDomains(parsedApprovedDomains.value)
}

// Local form state for SSO config
const ssoProtocol = ref<SsoProtocol>("saml")
const ssoDomains = ref("")
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
    ssoDomains.value = (config.domains || []).join(", ")
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

const parsedDomains = computed(() =>
  ssoDomains.value
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
)

const canSaveSso = computed(() => {
  if (parsedDomains.value.length === 0) return false
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
    domains: parsedDomains.value,
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

const deleteSsoDialog = useConfirmationDialog()
const handleDeleteSso = () => deleteSsoDialog.confirm(() => deleteSsoConfig())
</script>

<template>
  <div class="p-6">
    <!-- Enterprise plan gate -->
    <div
      v-if="!isEnterprise"
      class="flex flex-col items-center gap-4 py-12 text-center"
    >
      <IconShieldCheck class="text-muted-foreground size-12" />
      <h3 class="text-lg font-semibold">Enterprise Security</h3>
      <p class="text-muted-foreground max-w-md text-sm">
        SSO and advanced login method controls are available on the Enterprise
        plan. Upgrade to configure SAML, OIDC, and per-team authentication
        policies.
      </p>
      <Button variant="outline" @click="emit('navigate', 'plans')">
        View Plans
      </Button>
    </div>

    <template v-else>
      <div v-if="loading" class="flex justify-center py-12">
        <Spinner />
      </div>

      <div v-else class="grid gap-12">
        <!-- Section: Authentication Methods -->
        <FieldGroup>
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
                <FieldLabel class="text-sm">Email & Password</FieldLabel>
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
                <FieldLabel class="text-sm">Magic Link</FieldLabel>
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
                <FieldLabel class="text-sm">Google</FieldLabel>
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
                <FieldLabel class="text-sm">Microsoft</FieldLabel>
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
                <FieldLabel class="text-sm">Apple</FieldLabel>
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
                <FieldLabel class="text-sm">SSO</FieldLabel>
                <FieldDescription>
                  Enterprise Single Sign-On (SAML / OIDC).
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="updatingMethod === 'sso'">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
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
        </FieldGroup>

        <FieldSeparator />

        <!-- Section: Approved Domains -->
        <FieldGroup>
          <FieldSet>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Approved Domains</FieldLabel>
                <FieldDescription>
                  Anyone with an email address at these domains is allowed to
                  sign up and join this team automatically. Press Enter to save.
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldContent>
                <FieldLabel class="text-sm">Domains</FieldLabel>
                <FieldDescription>
                  Comma-separated list of email domains (e.g., acme.com,
                  corp.acme.com). Leave empty to disable domain-based auto-join.
                </FieldDescription>
              </FieldContent>
              <ButtonGroup>
                <ButtonGroup v-if="savingApprovedDomains">
                  <InputGroupButton variant="ghost" size="icon-xs" disabled>
                    <Spinner />
                  </InputGroupButton>
                </ButtonGroup>
                <ButtonGroup class="flex-1">
                  <Input
                    v-model="localApprovedDomains"
                    :disabled="savingApprovedDomains"
                    placeholder="acme.com, corp.acme.com"
                    @keydown.enter="handleSaveApprovedDomains"
                  />
                </ButtonGroup>
              </ButtonGroup>
            </Field>
          </FieldSet>
        </FieldGroup>

        <FieldSeparator />

        <!-- Section: SSO Configuration -->
        <FieldGroup v-if="loginMethods.sso">
          <FieldSet>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>SSO Configuration</FieldLabel>
                <FieldDescription>
                  Configure SAML or OIDC single sign-on for your organization.
                </FieldDescription>
              </FieldContent>
              <Badge v-if="hasSso" variant="secondary">
                <IconShieldCheck class="size-3" />
                Active
              </Badge>
            </Field>

            <!-- Protocol Selector -->
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel class="text-sm">Protocol</FieldLabel>
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
              <Field>
                <FieldContent>
                  <FieldLabel class="text-sm">IdP Entity ID</FieldLabel>
                  <FieldDescription>
                    The entity ID of your SAML identity provider.
                  </FieldDescription>
                </FieldContent>
                <Input
                  v-model="samlIdpEntityId"
                  placeholder="https://idp.example.com/entity"
                />
              </Field>

              <Field>
                <FieldContent>
                  <FieldLabel class="text-sm">SSO URL</FieldLabel>
                  <FieldDescription>
                    The single sign-on URL of your identity provider.
                  </FieldDescription>
                </FieldContent>
                <Input
                  v-model="samlSsoUrl"
                  placeholder="https://idp.example.com/sso"
                />
              </Field>

              <Field>
                <FieldContent>
                  <FieldLabel class="text-sm">Certificate</FieldLabel>
                  <FieldDescription>
                    The X.509 signing certificate from your identity provider
                    (PEM format).
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
              <Field>
                <FieldContent>
                  <FieldLabel class="text-sm">Issuer URL</FieldLabel>
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

              <Field>
                <FieldContent>
                  <FieldLabel class="text-sm">Client ID</FieldLabel>
                  <FieldDescription>
                    The OIDC client ID registered with your identity provider.
                  </FieldDescription>
                </FieldContent>
                <Input v-model="oidcClientId" placeholder="client-id" />
              </Field>

              <Field>
                <FieldContent>
                  <FieldLabel class="text-sm">Client Secret</FieldLabel>
                  <FieldDescription>
                    The OIDC client secret. This is stored securely and never
                    exposed to the client.
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
            <Field>
              <FieldContent>
                <FieldLabel class="text-sm">Email Domains</FieldLabel>
                <FieldDescription>
                  Comma-separated list of email domains that should use SSO
                  (e.g., acme.com, corp.acme.com).
                </FieldDescription>
              </FieldContent>
              <Input
                v-model="ssoDomains"
                placeholder="acme.com, corp.acme.com"
              />
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel class="text-sm">Enforce SSO</FieldLabel>
                <FieldDescription>
                  When enabled, users with matching email domains must use SSO.
                  Password and social logins will be blocked for these users.
                </FieldDescription>
              </FieldContent>
              <Switch v-model="ssoEnforced" />
            </Field>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel class="text-sm">Auto-provision Members</FieldLabel>
                <FieldDescription>
                  Automatically create a team membership when a user signs in
                  via SSO for the first time.
                </FieldDescription>
              </FieldContent>
              <Switch v-model="ssoAutoProvision" />
            </Field>

            <Field v-if="ssoAutoProvision" orientation="horizontal">
              <FieldContent>
                <FieldLabel class="text-sm">Default Role</FieldLabel>
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

            <!-- Action Buttons -->
            <Field orientation="horizontal">
              <FieldContent />
              <div class="flex gap-2">
                <Button
                  variant="outline"
                  :disabled="testing || !canSaveSso"
                  @click="handleTestConnection"
                >
                  <Spinner v-if="testing" />
                  Test Connection
                </Button>
                <Button
                  :disabled="saving || !canSaveSso"
                  @click="handleSaveSso"
                >
                  <Spinner v-if="saving" />
                  {{ hasSso ? "Update SSO" : "Enable SSO" }}
                </Button>
              </div>
            </Field>

            <!-- Delete SSO -->
            <Field v-if="hasSso" orientation="horizontal">
              <FieldContent>
                <FieldLabel class="text-destructive text-sm">
                  Remove SSO
                </FieldLabel>
                <FieldDescription>
                  Remove SSO configuration. Users will fall back to other login
                  methods.
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
        </FieldGroup>
      </div>
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
</template>
