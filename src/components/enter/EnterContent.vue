<script lang="ts" setup>
import {
  IconAppleFilled,
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

const authMode = ref<"sign-up" | "sign-in">("sign-up")
const authenticateError = ref<string | boolean>(false)

const email = ref<string>("")
const password = ref<string>("")
const passwordInputType = ref<"password" | "text">("password")

const lastAuthProvider = useStorage<string | null>("lastAuthProvider", null)

const signupViaEmailPasswordInProgress = ref(false)
const signupViaEmailPassword = async () => {
  signupViaEmailPasswordInProgress.value = true
  authenticateError.value = false

  await signUpWithEmailPassword(email.value, password.value)
    .then(() => {
      lastAuthProvider.value = "email-password"
      signupViaEmailPasswordInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      signupViaEmailPasswordInProgress.value = false
    })
}

const signinViaEmailPasswordInProgress = ref(false)
const signinViaEmailPassword = async () => {
  signinViaEmailPasswordInProgress.value = true
  authenticateError.value = false

  await signInWithEmailPassword(email.value, password.value)
    .then(() => {
      lastAuthProvider.value = "email-password"
      signinViaEmailPasswordInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      signinViaEmailPasswordInProgress.value = false
    })
}

const resettingPassword = ref(false)
const resetPassword = async () => {
  resettingPassword.value = true
  authenticateError.value = false

  await sendResetEmailPassword(email.value)
    .then(() => {
      resettingPassword.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      resettingPassword.value = false
    })
}

const togglePasswordVisibility = () => {
  passwordInputType.value =
    passwordInputType.value === "password" ? "text" : "password"
}

const authenticateEmailInProgress = ref(false)
const authenticateEmail = async () => {
  authenticateEmailInProgress.value = true
  authenticateError.value = false

  await sendAuthenticateEmail(email.value)
    .then(() => {
      lastAuthProvider.value = "email-link"
      authenticateEmailInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      authenticateEmailInProgress.value = false
    })
}

const authenticateGoogleInProgress = ref(false)
const authenticateGoogle = async () => {
  authenticateGoogleInProgress.value = true
  authenticateError.value = false

  await signInWithGoogle()
    .then(() => {
      lastAuthProvider.value = "google"
      authenticateGoogleInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      authenticateGoogleInProgress.value = false
    })
}

const authenticateMicrosoftInProgress = ref(false)
const authenticateMicrosoft = async () => {
  authenticateMicrosoftInProgress.value = true
  authenticateError.value = false

  await signInWithMicrosoft()
    .then(() => {
      lastAuthProvider.value = "microsoft"
      authenticateMicrosoftInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = error
    })
    .finally(() => {
      authenticateMicrosoftInProgress.value = false
    })
}

const authenticateAppleInProgress = ref(false)
const authenticateApple = async () => {
  authenticateAppleInProgress.value = true
  authenticateError.value = false

  await signInWithApple()
    .then(() => {
      lastAuthProvider.value = "apple"
      authenticateAppleInProgress.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      authenticateAppleInProgress.value = false
    })
}
</script>

<template>
  <Tabs v-model="authMode" class="gap-8">
    <TabsContent value="sign-up" tabindex="-1">
      <h2
        class="font-display pt-8 text-center text-4xl leading-tight font-bold tracking-tight"
      >
        Sign up
      </h2>
      <div class="flex items-center justify-center">
        <span class="text-muted-foreground"> Already have an account? </span>
        <Button variant="link" tabindex="-1" @click="authMode = 'sign-in'">
          Sign in
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-in" tabindex="-1">
      <h2
        class="font-display pt-8 text-center text-4xl leading-tight font-bold tracking-tight"
      >
        Sign in
      </h2>
      <div class="flex items-center justify-center">
        <span class="text-muted-foreground"> Don't have an account? </span>
        <Button variant="link" tabindex="-1" @click="authMode = 'sign-up'">
          Sign up
        </Button>
      </div>
    </TabsContent>
    <!-- <TabsList class="mx-auto w-full">
      <TabsTrigger value="sign-up"> Sign up </TabsTrigger>
      <TabsTrigger value="sign-in"> Sign in </TabsTrigger>
    </TabsList> -->
    <div class="flex flex-col gap-4">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <Label for="email" class="text-foreground"> Email </Label>
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
                  <p>We'll use this to send you notifications</p>
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
                        <IconSend />
                      </InputGroupButton>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    Send magic link to your email
                  </TooltipContent>
                  <TooltipProvider v-if="lastAuthProvider === 'email-link'">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge
                          variant="destructive"
                          tabindex="-1"
                          class="absolute -top-3 right-3"
                        >
                          <IconDisc /> Recent
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top"> Last used </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Tooltip>
              </TooltipProvider>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle> Send magic link </AlertDialogTitle>
                  <AlertDialogDescription>
                    Enter your email address to receive a magic link.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div>
                  <Input
                    v-model="email"
                    label="Email"
                    placeholder="Email address"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button
                    :disabled="!email"
                    variant="destructive"
                    @click="authenticateEmail"
                  >
                    <Spinner v-if="authenticateEmailInProgress" />
                    Send magic link
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        </InputGroupAddon>
        <InputGroupAddon align="block-start" class="pt-0">
          <IconMail />
          <InputGroupInput
            id="email"
            v-model="email"
            placeholder="ada@lovelace.com"
            type="email"
            :disabled="
              signupViaEmailPasswordInProgress ||
              signinViaEmailPasswordInProgress
            "
            required
            class="text-foreground"
          />
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon align="block-start">
          <Label for="password" class="text-foreground"> Password </Label>
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
                  <p>Choose a strong password to secure your account</p>
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
                  <TooltipContent> Forgot password? </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle> Forgot password </AlertDialogTitle>
                  <AlertDialogDescription>
                    Enter your email address to receive a password reset link.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div>
                  <Input
                    v-model="email"
                    label="Email"
                    placeholder="Email address"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button
                    :disabled="!email"
                    variant="destructive"
                    @click="resetPassword"
                  >
                    <Spinner v-if="resettingPassword" />
                    Send reset link
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
            placeholder="********"
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
                {{ passwordInputType === "password" ? "Show" : "Hide" }}
                password
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
          <template v-else> Continue </template>
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
          <template v-else> Continue </template>
          <TooltipProvider v-if="lastAuthProvider === 'email-password'">
            <Tooltip>
              <TooltipTrigger as-child>
                <Badge
                  variant="destructive"
                  tabindex="-1"
                  class="absolute -top-3 right-3"
                >
                  <IconDisc /> Recent
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top"> Last used </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Button>
      </TabsContent>
    </div>
    <div class="relative">
      <Separator />
      <Badge
        variant="outline"
        class="bg-muted text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 uppercase"
      >
        Or continue with
      </Badge>
    </div>
    <div class="flex flex-col gap-2">
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
        Google
        <TooltipProvider v-if="lastAuthProvider === 'google'">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                variant="destructive"
                tabindex="-1"
                class="absolute -top-3 right-3"
              >
                <IconDisc /> Recent
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top"> Last used </TooltipContent>
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
        Microsoft
        <TooltipProvider v-if="lastAuthProvider === 'microsoft'">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                variant="destructive"
                tabindex="-1"
                class="absolute -top-3 right-3"
              >
                <IconDisc /> Recent
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top"> Last used </TooltipContent>
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
        Apple
        <TooltipProvider v-if="lastAuthProvider === 'apple'">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                variant="destructive"
                tabindex="-1"
                class="absolute -top-3 right-3"
              >
                <IconDisc /> Recent
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top"> Last used </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Button>
    </div>
    <Alert
      v-if="authenticateError"
      variant="destructive"
      class="bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] bg-fixed"
    >
      <IconCircleAlert />
      <AlertTitle> Message: </AlertTitle>
      <AlertDescription>
        {{ authenticateError }}
      </AlertDescription>
    </Alert>
  </Tabs>
</template>
