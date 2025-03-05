<script setup lang="ts">
import {
  signUpWithEmailPassword,
  signInWithEmailPassword,
  resetEmailPassword,
  signInWithGoogle,
  signInWithMicrosoft,
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

const resetPassword = async () => {
  authenticateError.value = false
  await resetEmailPassword(email.value)
    .then(() => {
      authenticateError.value = "Password reset email sent"
    })
    .catch((error) => {
      authenticateError.value = String(error)
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

  try {
    await new Promise((resolve) => setTimeout(resolve, 2000))
  } catch (error) {
    authenticateError.value = String(error)
  } finally {
    authenticateAppleInProgress.value = false
  }
}
</script>

<template>
  <div>
    <Tabs v-model="authMode" class="flex flex-col gap-4 p-4">
      <TabsList class="grid grid-cols-2 rounded-xl">
        <TabsTrigger value="sign-up" class="rounded-lg py-2">
          Sign up
        </TabsTrigger>
        <TabsTrigger value="sign-in" class="rounded-lg py-2">
          Sign in
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sign-up">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-4">
            <div class="grid gap-4">
              <Label for="email">Email</Label>
              <div class="relative w-full items-center">
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
              <div class="relative w-full items-center">
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
                  class="absolute inset-y-0 end-0 right-0.5 flex items-center justify-center"
                >
                  <Button variant="ghost" @click="togglePasswordVisibility()">
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
          <div class="flex items-center justify-center gap-2">
            <Button variant="ghost"> Send Magic link </Button>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="sign-in">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-4">
            <div class="grid gap-4">
              <Label for="email">Email</Label>
              <div class="relative w-full items-center">
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
              <Label for="password">Password</Label>
              <div class="relative w-full items-center">
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
                  class="absolute inset-y-0 end-0 right-0.5 flex items-center justify-center"
                >
                  <Button variant="ghost" @click="togglePasswordVisibility()">
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
          <div class="flex items-center justify-center gap-2">
            <Button variant="ghost" @click="resetPassword()">
              Forgot password?
            </Button>
          </div>
        </div>
      </TabsContent>
      <Separator label="Or continue with" class="my-4" />
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
      <TabsContent value="sign-up">
        <div class="flex items-center justify-center gap-2">
          <span class="text-muted-foreground/50">
            Already have an account?
          </span>
          <Button variant="link" @click="authMode = 'sign-in'">
            Sign in
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="sign-in">
        <div class="flex items-center justify-center gap-2">
          <span class="text-muted-foreground/50"> Don't have an account? </span>
          <Button variant="link" @click="authMode = 'sign-up'">
            Sign up
          </Button>
        </div>
      </TabsContent>
      <Alert
        v-if="authenticateError"
        variant="destructive"
        class="bg-destructive/15"
      >
        <icon-lucide-alert-circle />
        <AlertTitle> Something went wrong </AlertTitle>
        <AlertDescription>
          {{ authenticateError }}
        </AlertDescription>
      </Alert>
    </Tabs>
  </div>
</template>
