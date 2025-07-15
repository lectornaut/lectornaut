<script setup lang="ts">
import {
  resetEmailPassword,
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
      <h2 class="text-center text-2xl font-semibold tracking-tight">Sign up</h2>
    </TabsContent>
    <TabsContent value="sign-in">
      <h2 class="text-center text-2xl font-semibold tracking-tight">Sign in</h2>
    </TabsContent>
    <!-- <TabsContent value="sign-up">
      <div class="flex items-center gap-1">
        <span class="text-muted-foreground"> Already have an account? </span>
        <Button variant="link" @click="authMode = 'sign-in'" class="p-0">
          Sign in
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-in">
      <div class="flex items-center gap-1">
        <span class="text-muted-foreground"> Don't have an account? </span>
        <Button variant="link" @click="authMode = 'sign-up'" class="p-0">
          Sign up
        </Button>
      </div>
    </TabsContent> -->
    <!-- <TabsList class="mx-auto">
      <TabsTrigger value="sign-up"> Sign up </TabsTrigger>
      <TabsTrigger value="sign-in"> Sign in </TabsTrigger>
    </TabsList> -->
    <TabsContent value="sign-up">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-4">
          <div class="grid gap-4">
            <Label for="email">Email</Label>
            <div class="relative flex w-full items-center">
              <span
                class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-4"
              >
                <icon-lucide-mail class="text-muted-foreground" />
              </span>
              <Input
                id="email"
                v-model="email"
                type="email"
                placeholder="Email"
                class="rounded-lg pl-10 focus:border-inherit focus:ring-0"
                :disabled="signupViaEmailPasswordInProgress"
                required
              />
            </div>
          </div>
          <div class="grid gap-4">
            <Label for="password">Password</Label>
            <div class="relative flex w-full items-center">
              <span
                class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-4"
              >
                <icon-lucide-lock-keyhole class="text-muted-foreground" />
              </span>
              <Input
                id="password"
                v-model="password"
                :type="passwordInputType"
                placeholder="Password"
                class="truncate rounded-lg px-10 focus:border-inherit focus:ring-0"
                :disabled="signupViaEmailPasswordInProgress"
                required
              />
              <span
                class="absolute inset-y-0 end-0 right-0 flex items-center justify-center"
              >
                <Button
                  variant="ghost"
                  tabindex="-1"
                  size="icon"
                  @click="togglePasswordVisibility()"
                >
                  <icon-lucide-eye
                    v-if="passwordInputType === 'password'"
                    class="text-muted-foreground"
                  />
                  <icon-lucide-eye-off v-else class="text-muted-foreground" />
                </Button>
              </span>
            </div>
          </div>
        </div>
        <Button
          :disabled="signupViaEmailPasswordInProgress"
          @click="signupViaEmailPassword"
        >
          <template v-if="signupViaEmailPasswordInProgress">
            <icon-lucide-loader class="animate-spin" />
          </template>
          <template v-else> Continue </template>
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-in">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-4">
          <div class="grid gap-4">
            <Label for="email">Email</Label>
            <div class="relative flex w-full items-center">
              <span
                class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-4"
              >
                <icon-lucide-mail class="text-muted-foreground" />
              </span>
              <Input
                id="email"
                v-model="email"
                type="email"
                placeholder="Email"
                class="rounded-lg pl-10 focus:border-inherit focus:ring-0"
                :disabled="signinViaEmailPasswordInProgress"
                required
              />
            </div>
          </div>
          <div class="grid gap-4">
            <div class="relative flex w-full items-center justify-between">
              <Label for="password">Password</Label>
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <Button
                    variant="link"
                    class="h-auto p-0 text-xs leading-1"
                    tabindex="-1"
                  >
                    Forgot password
                  </Button>
                </AlertDialogTrigger>
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
                      <icon-lucide-loader
                        v-if="resettingPassword"
                        class="animate-spin"
                      />
                      Send reset link
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <div class="relative flex w-full items-center">
              <span
                class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-4"
              >
                <icon-lucide-lock-keyhole class="text-muted-foreground" />
              </span>
              <Input
                id="password"
                v-model="password"
                :type="passwordInputType"
                placeholder="Password"
                class="truncate rounded-lg px-10 focus:border-inherit focus:ring-0"
                :disabled="signinViaEmailPasswordInProgress"
                required
              />
              <span
                class="absolute inset-y-0 end-0 right-0 flex items-center justify-center"
              >
                <Button
                  variant="ghost"
                  tabindex="-1"
                  size="icon"
                  @click="togglePasswordVisibility()"
                >
                  <icon-lucide-eye
                    v-if="passwordInputType === 'password'"
                    class="text-muted-foreground"
                  />
                  <icon-lucide-eye-off v-else class="text-muted-foreground" />
                </Button>
              </span>
            </div>
          </div>
        </div>
        <Button
          type="submit"
          :disabled="signinViaEmailPasswordInProgress"
          @click="signinViaEmailPassword()"
        >
          <template v-if="signinViaEmailPasswordInProgress">
            <icon-lucide-loader class="animate-spin" />
          </template>
          <template v-else> Continue </template>
        </Button>
      </div>
    </TabsContent>
    <TabsContent value="sign-up">
      <div class="flex items-center justify-center gap-1">
        <span class="text-muted-foreground"> Already have an account? </span>
        <Button
          variant="link"
          class="h-auto p-0 leading-0"
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
        class="justify-start gap-3"
        :disabled="authenticateGoogleInProgress"
        @click="authenticateGoogle"
      >
        <template v-if="authenticateGoogleInProgress">
          <icon-lucide-loader class="animate-spin" />
        </template>
        <template v-else>
          <icon-mdi-google />
        </template>
        Google
      </Button>
      <Button
        variant="secondary"
        class="justify-start gap-3"
        :disabled="authenticateMicrosoftInProgress"
        @click="authenticateMicrosoft"
      >
        <template v-if="authenticateMicrosoftInProgress">
          <icon-lucide-loader class="animate-spin" />
        </template>
        <template v-else>
          <icon-mdi-microsoft />
        </template>
        Microsoft
      </Button>
      <Button
        variant="secondary"
        class="justify-start gap-3"
        :disabled="authenticateAppleInProgress"
        @click="authenticateApple"
      >
        <template v-if="authenticateAppleInProgress">
          <icon-lucide-loader class="animate-spin" />
        </template>
        <template v-else>
          <icon-mdi-apple />
        </template>
        Apple
      </Button>
    </div>
    <Alert
      v-if="authenticateError"
      variant="destructive"
      class="bg-destructive/5 border-destructive/10"
    >
      <icon-lucide-circle-alert />
      <AlertTitle> Message: </AlertTitle>
      <AlertDescription>
        {{ authenticateError }}
      </AlertDescription>
    </Alert>
  </Tabs>
</template>
