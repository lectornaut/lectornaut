<script lang="ts" setup>
import { useSsoLogin } from "@/composables/useSsoLogin"
import {
  IconAppleFilled,
  IconArrowLeft,
  IconCircleAlert,
  IconDisc,
  IconEye,
  IconEyeOff,
  IconGoogle,
  IconHelpCircle,
  IconInfo,
  IconLock,
  IconMail,
  IconMicrosoft,
  IconSend,
  IconShieldCheck,
} from "@/data/icons"
import {
  sendAuthenticateEmail,
  sendResetEmailPassword,
  signInWithApple,
  signInWithEmailPassword,
  signInWithGoogle,
  signInWithMicrosoft,
  signUpWithEmailPassword,
} from "@/modules/auth"
import {
  AuthErrorCodes,
  getAuthErrorMessage,
} from "@/utils/firebase/firebase-errors"
import type { FirebaseError } from "firebase/app"

const { t } = useI18n()

// SSO login composable
const {
  ssoResult,
  ssoError,
  resolve: resolveSso,
  startSsoSignIn,
  reset: resetSso,
} = useSsoLogin()

// Auth flow state
type AuthStep = "email" | "methods"
const authStep = ref<AuthStep>("email")
const authMode = ref<"sign-up" | "sign-in">("sign-in")
const authenticateError = ref<string | boolean>(false)

const email = ref<string>("")
const password = ref<string>("")
const passwordInputType = ref<"password" | "text">("password")

const lastAuthProvider = useStorage<string | null>("lastAuthProvider", null)

// Whether SSO is available for this email domain
const ssoAvailable = computed(() => ssoResult.value?.sso === true)
const ssoProviderId = computed(() => ssoResult.value?.providerId)

const handleAuth = async (
  loadingState: Ref<boolean>,
  authFunction: () => Promise<void>,
  providerName?: string
) => {
  loadingState.value = true
  authenticateError.value = false

  try {
    await authFunction()
    if (providerName) {
      lastAuthProvider.value = providerName
    }
  } catch (error) {
    // MFA_REQUIRED is handled by MfaResolverDialog (mounted globally in Actions.vue)
    // via the emitter event — do not show a form error for it.
    if ((error as FirebaseError)?.code !== AuthErrorCodes.MFA_REQUIRED) {
      authenticateError.value = getAuthErrorMessage(error)
    }
  } finally {
    loadingState.value = false
  }
}

// Step 1: Continue with email — resolve SSO, then decide next step
const continueWithEmailInProgress = ref(false)
const continueWithEmail = async () => {
  if (!email.value) return

  continueWithEmailInProgress.value = true
  authenticateError.value = false

  try {
    const result = await resolveSso(email.value)

    if (result.sso && result.enforced && result.providerId) {
      // SSO enforced — redirect to SSO page
      await startSsoSignIn(result.providerId, email.value, true)
      return
    }

    // Show available methods (SSO optional or not available)
    authStep.value = "methods"
  } catch {
    // Even if resolution fails, allow fallback to normal login
    authStep.value = "methods"
  } finally {
    continueWithEmailInProgress.value = false
  }
}

const goBackToEmail = () => {
  authStep.value = "email"
  authenticateError.value = false
  password.value = ""
  resetSso()
}

// SSO sign-in from methods step
const ssoSignInInProgress = ref(false)
const handleSsoSignIn = async () => {
  if (!ssoProviderId.value) return
  ssoSignInInProgress.value = true
  try {
    await startSsoSignIn(ssoProviderId.value, email.value, false)
  } finally {
    ssoSignInInProgress.value = false
  }
}

const signupViaEmailPasswordInProgress = ref(false)
const signupViaEmailPassword = () =>
  handleAuth(signupViaEmailPasswordInProgress, () =>
    signUpWithEmailPassword(email.value, password.value)
  )

const resettingPassword = ref(false)
const resetPassword = () =>
  handleAuth(resettingPassword, () => sendResetEmailPassword(email.value))

const togglePasswordVisibility = () =>
  (passwordInputType.value =
    passwordInputType.value === "password" ? "text" : "password")

const signinViaEmailPasswordInProgress = ref(false)
const signinViaEmailPassword = () =>
  handleAuth(
    signinViaEmailPasswordInProgress,
    () => signInWithEmailPassword(email.value, password.value),
    "email-password"
  )

const authenticateEmailInProgress = ref(false)
const authenticateEmail = () =>
  handleAuth(
    authenticateEmailInProgress,
    () => sendAuthenticateEmail(email.value),
    "email-link"
  )

const authenticateGoogleInProgress = ref(false)
const authenticateGoogle = () =>
  handleAuth(authenticateGoogleInProgress, signInWithGoogle, "google")

const authenticateMicrosoftInProgress = ref(false)
const authenticateMicrosoft = () =>
  handleAuth(authenticateMicrosoftInProgress, signInWithMicrosoft, "microsoft")

const authenticateAppleInProgress = ref(false)
const authenticateApple = () =>
  handleAuth(authenticateAppleInProgress, signInWithApple, "apple")
</script>

<template>
  <!-- Step 1: Email Input -->
  <div v-if="authStep === 'email'" class="gap-8">
    <Tabs v-model="authMode" class="gap-8">
      <TabsContent value="sign-up" tabindex="-1">
        <h2
          class="font-display pt-8 text-center text-4xl leading-tight font-bold tracking-tight"
        >
          {{ t("enter.signUp") }}
        </h2>
        <div class="flex items-center justify-center">
          <span class="text-muted-foreground">
            {{ t("enter.alreadyHaveAccount") }}
          </span>
          <Button variant="link" @click="authMode = 'sign-in'">
            {{ t("enter.signIn") }}
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="sign-in" tabindex="-1">
        <h2
          class="font-display pt-8 text-center text-4xl leading-tight font-bold tracking-tight"
        >
          {{ t("enter.signIn") }}
        </h2>
        <div class="flex items-center justify-center">
          <span class="text-muted-foreground">
            {{ t("enter.dontHaveAccount") }}
          </span>
          <Button variant="link" @click="authMode = 'sign-up'">
            {{ t("enter.signUp") }}
          </Button>
        </div>
      </TabsContent>
      <div class="bg-background grid gap-4 rounded-2xl border p-2">
        <!-- Email input -->
        <div class="grid gap-2">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <Label for="email" class="text-foreground">
                {{ t("enter.labels.email") }}
              </Label>
            </InputGroupAddon>
            <InputGroupAddon align="block-start" class="pt-0">
              <IconMail />
              <InputGroupInput
                id="email"
                v-model="email"
                :placeholder="t('enter.placeholders.emailExample')"
                type="email"
                :disabled="continueWithEmailInProgress"
                required
                class="text-foreground"
                @keydown.enter="continueWithEmail"
              />
            </InputGroupAddon>
          </InputGroup>
          <Button
            :disabled="!email || continueWithEmailInProgress"
            class="w-full"
            @click="continueWithEmail"
          >
            <Spinner v-if="continueWithEmailInProgress" />
            <template v-else>{{ t("enter.continue") }}</template>
          </Button>
        </div>
        <div class="relative">
          <Separator />
          <Badge
            variant="secondary"
            class="text-muted-foreground/50 bg-background absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            {{ t("enter.orContinueWith") }}
          </Badge>
        </div>
        <!-- Social Authentication -->
        <div class="grid gap-2">
          <Button
            variant="secondary"
            class="relative justify-start"
            :disabled="authenticateGoogleInProgress"
            @click="authenticateGoogle"
          >
            <template v-if="authenticateGoogleInProgress">
              <Spinner />
            </template>
            <template v-else>
              <IconGoogle />
            </template>
            {{ t("enter.google") }}
            <TooltipProvider v-if="lastAuthProvider === 'google'">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Badge tabindex="-1" class="absolute -top-3 right-3">
                    <IconDisc /> {{ t("enter.magicLink.recent") }}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {{ t("enter.magicLink.lastUsed") }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Button>
          <Button
            variant="secondary"
            class="relative justify-start"
            :disabled="authenticateMicrosoftInProgress"
            @click="authenticateMicrosoft"
          >
            <template v-if="authenticateMicrosoftInProgress">
              <Spinner />
            </template>
            <template v-else>
              <IconMicrosoft />
            </template>
            {{ t("enter.microsoft") }}
            <TooltipProvider v-if="lastAuthProvider === 'microsoft'">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Badge
                    variant="destructive"
                    tabindex="-1"
                    class="absolute -top-3 right-3 text-current"
                  >
                    <IconDisc /> {{ t("enter.magicLink.recent") }}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {{ t("enter.magicLink.lastUsed") }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Button>
          <Button
            variant="secondary"
            class="relative justify-start"
            :disabled="authenticateAppleInProgress"
            @click="authenticateApple"
          >
            <template v-if="authenticateAppleInProgress">
              <Spinner />
            </template>
            <template v-else>
              <IconAppleFilled />
            </template>
            {{ t("enter.apple") }}
            <TooltipProvider v-if="lastAuthProvider === 'apple'">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Badge
                    variant="destructive"
                    tabindex="-1"
                    class="absolute -top-3 right-3 text-current"
                  >
                    <IconDisc /> {{ t("enter.magicLink.recent") }}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {{ t("enter.magicLink.lastUsed") }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Button>
        </div>
      </div>
    </Tabs>
    <Alert
      v-if="authenticateError"
      variant="destructive"
      class="bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
    >
      <IconCircleAlert />
      <AlertTitle> {{ t("enter.uhoh") }} </AlertTitle>
      <AlertDescription>
        {{ authenticateError }}
      </AlertDescription>
    </Alert>
    <Alert
      v-if="ssoError"
      variant="destructive"
      class="mt-4 bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
    >
      <IconCircleAlert />
      <AlertTitle>{{ t("enter.uhoh") }}</AlertTitle>
      <AlertDescription>{{ ssoError }}</AlertDescription>
    </Alert>
  </div>
  <!-- Step 2: Login Methods (after email resolved) -->
  <Tabs v-else v-model="authMode" class="gap-8">
    <TabsContent value="sign-up" tabindex="-1">
      <h2
        class="font-display pt-8 text-center text-4xl leading-tight font-bold tracking-tight"
      >
        {{ t("enter.signUp") }}
      </h2>
    </TabsContent>
    <TabsContent value="sign-in" tabindex="-1">
      <h2
        class="font-display pt-8 text-center text-4xl leading-tight font-bold tracking-tight"
      >
        {{ t("enter.signIn") }}
      </h2>
    </TabsContent>
    <div class="bg-background grid gap-4 rounded-2xl border p-2">
      <div class="flex flex-col gap-2">
        <!-- Email display with back button -->
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" @click="goBackToEmail">
            <IconArrowLeft />
          </Button>
          <span class="text-muted-foreground truncate text-sm">
            {{ email }}
          </span>
        </div>
        <div class="grid gap-4">
          <!-- SSO button (if available) -->
          <div v-if="ssoAvailable" class="grid gap-4">
            <Button
              class="relative w-full justify-start"
              :disabled="ssoSignInInProgress"
              @click="handleSsoSignIn"
            >
              <Spinner v-if="ssoSignInInProgress" />
              <template v-else>
                <IconShieldCheck />
              </template>
              Sign in with SSO
              <TooltipProvider v-if="lastAuthProvider === 'sso'">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Badge tabindex="-1" class="absolute -top-3 right-3">
                      <IconDisc /> {{ t("enter.magicLink.recent") }}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {{ t("enter.magicLink.lastUsed") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Button>
          </div>
          <!-- Password login -->
          <div v-if="ssoAvailable" class="relative">
            <Separator />
            <Badge
              variant="secondary"
              class="text-muted-foreground/50 bg-background absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              {{ t("enter.orContinueWith") }}
            </Badge>
          </div>
          <div class="grid gap-2">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <Label for="password" class="text-foreground">
                  {{ t("enter.labels.password") }}
                </Label>
                <TabsContent value="sign-up" tabindex="-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <InputGroupButton
                          variant="ghost"
                          size="icon-xs"
                          class="ml-auto"
                          tabindex="-1"
                        >
                          <IconInfo />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{{ t("enter.tooltips.strongPassword") }}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TabsContent>
                <TabsContent value="sign-in" tabindex="-1">
                  <AlertDialog>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <AlertDialogTrigger as-child>
                            <InputGroupButton
                              variant="ghost"
                              size="icon-xs"
                              class="ml-auto"
                              tabindex="-1"
                            >
                              <IconHelpCircle />
                            </InputGroupButton>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{ t("enter.forgotPassword.tooltip") }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {{ t("enter.forgotPassword.title") }}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {{ t("enter.forgotPassword.description") }}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div>
                        <Input
                          v-model="email"
                          :label="t('enter.labels.email')"
                          :placeholder="t('enter.placeholders.email')"
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {{ t("enter.cancel") }}
                        </AlertDialogCancel>
                        <Button :disabled="!email" @click="resetPassword">
                          <Spinner v-if="resettingPassword" />
                          {{ t("enter.forgotPassword.send") }}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TabsContent>
              </InputGroupAddon>
              <InputGroupAddon align="block-start" class="pt-0">
                <IconLock />

                <InputGroupInput
                  id="password"
                  v-model="password"
                  :placeholder="t('enter.placeholders.password')"
                  :type="passwordInputType"
                  :disabled="
                    signupViaEmailPasswordInProgress ||
                    signinViaEmailPasswordInProgress
                  "
                  required
                  class="text-foreground"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        variant="ghost"
                        size="icon-xs"
                        class="ml-auto"
                        tabindex="-1"
                        @click="togglePasswordVisibility()"
                      >
                        <IconEye
                          v-if="passwordInputType === 'password'"
                          class="text-muted-foreground"
                        />
                        <IconEyeOff v-else class="text-muted-foreground" />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        passwordInputType === "password"
                          ? t("enter.labels.showPassword")
                          : t("enter.labels.hidePassword")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </InputGroupAddon>
            </InputGroup>
            <TabsContent value="sign-up" tabindex="-1">
              <Button
                :disabled="signupViaEmailPasswordInProgress"
                class="w-full"
                @click="signupViaEmailPassword"
              >
                <template v-if="signupViaEmailPasswordInProgress">
                  <Spinner />
                </template>
                <template v-else> {{ t("enter.continue") }} </template>
              </Button>
            </TabsContent>
            <TabsContent value="sign-in" tabindex="-1">
              <Button
                type="submit"
                :disabled="signinViaEmailPasswordInProgress"
                class="relative w-full"
                @click="signinViaEmailPassword()"
              >
                <template v-if="signinViaEmailPasswordInProgress">
                  <Spinner />
                </template>
                <template v-else> {{ t("enter.continue") }} </template>
                <TooltipProvider v-if="lastAuthProvider === 'email-password'">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Badge
                        variant="destructive"
                        tabindex="-1"
                        class="absolute -top-3 right-3 text-current"
                      >
                        <IconDisc /> {{ t("enter.magicLink.recent") }}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {{ t("enter.magicLink.lastUsed") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Button>
            </TabsContent>
            <!-- Magic Link (sign-in only) -->
            <TabsContent value="sign-in" tabindex="-1">
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <Button
                    variant="secondary"
                    class="relative w-full justify-start"
                  >
                    <IconSend />
                    {{ t("enter.magicLink.tooltip") }}
                    <TooltipProvider v-if="lastAuthProvider === 'email-link'">
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Badge
                            variant="destructive"
                            tabindex="-1"
                            class="absolute -top-3 right-3 text-current"
                          >
                            <IconDisc /> {{ t("enter.magicLink.recent") }}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {{ t("enter.magicLink.lastUsed") }}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {{ t("enter.magicLink.title") }}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {{ t("enter.magicLink.description") }}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div>
                    <Input
                      v-model="email"
                      :label="t('enter.labels.email')"
                      :placeholder="t('enter.placeholders.email')"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {{ t("enter.cancel") }}
                    </AlertDialogCancel>
                    <Button :disabled="!email" @click="authenticateEmail">
                      <Spinner v-if="authenticateEmailInProgress" />
                      {{ t("enter.magicLink.send") }}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TabsContent>
          </div>
        </div>
      </div>
    </div>
    <Alert
      v-if="authenticateError"
      variant="destructive"
      class="bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
    >
      <IconCircleAlert />
      <AlertTitle> {{ t("enter.uhoh") }} </AlertTitle>
      <AlertDescription>
        {{ authenticateError }}
      </AlertDescription>
    </Alert>
  </Tabs>
</template>
