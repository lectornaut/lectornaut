<script setup lang="ts">
import {
  resetEmailPassword,
  sendAuthenticateEmail,
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

  await resetEmailPassword(email.value)
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
  <Tabs v-model="authMode" class="gap-6">
    <TabsContent value="sign-up">
      <h2
        class="font-display text-center text-3xl leading-tight font-semibold tracking-tight"
      >
        Sign up
      </h2>
    </TabsContent>
    <TabsContent value="sign-in">
      <h2
        class="font-display text-center text-3xl leading-tight font-semibold tracking-tight"
      >
        Sign in
      </h2>
    </TabsContent>
    <!-- <TabsList class="mx-auto">
      <TabsTrigger value="sign-up"> Sign up </TabsTrigger>
      <TabsTrigger value="sign-in"> Sign in </TabsTrigger>
    </TabsList> -->
    <TabsContent value="sign-up">
      <div class="flex flex-col gap-4">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText class="text-foreground">
              <Label for="email"> Email </Label>
            </InputGroupText>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    variant="ghost"
                    aria-label="Help"
                    class="ml-auto"
                    size="icon-xs"
                  >
                    <icon-lucide-info />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>
                  <p>We&apos;ll use this to send you notifications</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </InputGroupAddon>
          <InputGroupAddon align="block-start" class="pt-0">
            <icon-lucide-mail />
            <InputGroupInput
              id="email"
              v-model="email"
              placeholder="ada@lovelace.com"
              type="email"
              :disabled="signupViaEmailPasswordInProgress"
              required
            />
          </InputGroupAddon>
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText class="text-foreground">
              <Label for="password"> Password </Label>
            </InputGroupText>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    variant="ghost"
                    aria-label="Help"
                    class="ml-auto"
                    size="icon-xs"
                  >
                    <icon-lucide-info />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Choose a strong password to secure your account</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </InputGroupAddon>
          <InputGroupAddon align="block-start" class="pt-0">
            <icon-lucide-lock />
            <InputGroupInput
              id="password"
              v-model="password"
              placeholder="********"
              :type="passwordInputType"
              :disabled="signupViaEmailPasswordInProgress"
              required
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    size="icon-xs"
                    class="ml-auto"
                    variant="ghost"
                    @click="togglePasswordVisibility()"
                  >
                    <icon-lucide-eye
                      v-if="passwordInputType === 'password'"
                      class="text-muted-foreground"
                    />
                    <icon-lucide-eye-off v-else class="text-muted-foreground" />
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
        <Button
          :disabled="signupViaEmailPasswordInProgress"
          @click="signupViaEmailPassword"
        >
          <template v-if="signupViaEmailPasswordInProgress">
            <Spinner />
          </template>
          <template v-else> Continue </template>
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-in">
      <div class="flex flex-col gap-4">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText class="text-foreground">
              <Label for="email"> Email </Label>
            </InputGroupText>
            <AlertDialog>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <AlertDialogTrigger as-child>
                      <InputGroupButton
                        variant="ghost"
                        aria-label="Help"
                        class="ml-auto"
                        size="icon-xs"
                      >
                        <div
                          v-if="lastAuthProvider === 'email-link'"
                          class="absolute -left-6"
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <icon-mingcute-arrow-right-up-circle-fill />
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                Last used
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <icon-lucide-send />
                      </InputGroupButton>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    Send magic link to your email
                  </TooltipContent>
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
          </InputGroupAddon>
          <InputGroupAddon align="block-start" class="pt-0">
            <icon-lucide-mail />
            <InputGroupInput
              id="email"
              v-model="email"
              placeholder="ada@lovelace.com"
              type="email"
              :disabled="signinViaEmailPasswordInProgress"
              required
            />
          </InputGroupAddon>
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText class="text-foreground">
              <Label for="password-signin"> Password </Label>
            </InputGroupText>
            <AlertDialog>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <AlertDialogTrigger as-child>
                      <InputGroupButton
                        variant="ghost"
                        aria-label="Forgot password"
                        class="ml-auto"
                        size="icon-xs"
                      >
                        <icon-lucide-help-circle />
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
          </InputGroupAddon>
          <InputGroupAddon align="block-start" class="pt-0">
            <icon-lucide-lock />
            <InputGroupInput
              id="password-signin"
              v-model="password"
              placeholder="********"
              :type="passwordInputType"
              :disabled="signinViaEmailPasswordInProgress"
              required
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    size="icon-xs"
                    variant="ghost"
                    @click="togglePasswordVisibility()"
                  >
                    <icon-lucide-eye
                      v-if="passwordInputType === 'password'"
                      class="text-muted-foreground"
                    />
                    <icon-lucide-eye-off v-else class="text-muted-foreground" />
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
        <Button
          type="submit"
          :disabled="signinViaEmailPasswordInProgress"
          class="relative"
          @click="signinViaEmailPassword()"
        >
          <template v-if="signinViaEmailPasswordInProgress">
            <Spinner />
          </template>
          <template v-else>
            Continue
            <div
              v-if="lastAuthProvider === 'email-password'"
              class="absolute right-2.5"
            >
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <icon-mingcute-arrow-right-up-circle-fill />
                  </TooltipTrigger>
                  <TooltipContent side="top"> Last used </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </template>
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-up">
      <div class="flex items-center justify-center gap-1">
        <span class="text-muted-foreground"> Already have an account? </span>
        <Button
          variant="link"
          class="h-auto p-0 leading-1"
          tabindex="-1"
          @click="authMode = 'sign-in'"
        >
          Sign in
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-in">
      <div class="flex items-center justify-center gap-1">
        <span class="text-muted-foreground"> Don't have an account? </span>
        <Button
          variant="link"
          class="h-auto p-0 leading-0"
          tabindex="-1"
          @click="authMode = 'sign-up'"
        >
          Sign up
        </Button>
      </div>
    </TabsContent>
    <Separator label="Or continue with" />
    <div class="flex flex-col gap-2">
      <Button
        variant="secondary"
        class="relative justify-start gap-3 shadow-none"
        :disabled="authenticateGoogleInProgress"
        @click="authenticateGoogle"
      >
        <template v-if="authenticateGoogleInProgress">
          <Spinner />
        </template>
        <template v-else>
          <icon-mdi-google />
        </template>
        Google
        <div v-if="lastAuthProvider === 'google'" class="absolute right-2.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <icon-mingcute-arrow-right-up-circle-fill />
              </TooltipTrigger>
              <TooltipContent side="top"> Last used </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Button>
      <Button
        variant="secondary"
        class="relative justify-start gap-3 shadow-none"
        :disabled="authenticateMicrosoftInProgress"
        @click="authenticateMicrosoft"
      >
        <template v-if="authenticateMicrosoftInProgress">
          <Spinner />
        </template>
        <template v-else>
          <icon-mdi-microsoft />
        </template>
        Microsoft
        <div v-if="lastAuthProvider === 'microsoft'" class="absolute right-2.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <icon-mingcute-arrow-right-up-circle-fill />
              </TooltipTrigger>
              <TooltipContent side="top"> Last used </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Button>
      <Button
        variant="secondary"
        class="relative justify-start gap-3 shadow-none"
        :disabled="authenticateAppleInProgress"
        @click="authenticateApple"
      >
        <template v-if="authenticateAppleInProgress">
          <Spinner />
        </template>
        <template v-else>
          <icon-mdi-apple />
        </template>
        Apple
        <div v-if="lastAuthProvider === 'apple'" class="absolute right-2.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <icon-mingcute-arrow-right-up-circle-fill />
              </TooltipTrigger>
              <TooltipContent side="top"> Last used </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Button>
    </div>
    <Alert v-if="authenticateError" variant="destructive">
      <icon-lucide-circle-alert />
      <AlertTitle> Message: </AlertTitle>
      <AlertDescription>
        {{ authenticateError }}
      </AlertDescription>
    </Alert>
  </Tabs>
</template>
