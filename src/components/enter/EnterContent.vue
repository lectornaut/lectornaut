<script setup lang="ts">
import {
  sendAuthenticateEmail,
  signInWithGoogle,
  signInWithMicrosoft,
} from "@/modules/auth"

const email = ref("")
const authenticateError = ref<string | boolean>(false)
const sendAuthenticateViaEmailSuccess = ref(false)

const authenticateViaEmailInProgress = ref(false)
const authenticateViaEmail = async () => {
  authenticateViaEmailInProgress.value = true
  authenticateError.value = false

  await sendAuthenticateEmail(email.value)
    .then(() => {
      sendAuthenticateViaEmailSuccess.value = true
    })
    .catch((error) => {
      authenticateError.value = String(error)
    })
    .finally(() => {
      authenticateViaEmailInProgress.value = false
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
  <form
    v-if="!sendAuthenticateViaEmailSuccess"
    @submit.prevent="authenticateViaEmail"
  >
    <div class="flex flex-col gap-4 p-4">
      <div class="flex flex-col gap-2">
        <div class="relative w-full items-center">
          <span
            class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-4"
          >
            <icon-lucide-mail class="text-muted-foreground" />
          </span>
          <Input
            v-model="email"
            type="email"
            placeholder="Email"
            class="pl-10 focus:border-inherit focus:ring-0"
            :disabled="authenticateViaEmailInProgress"
            required
          />
        </div>
        <Button
          type="submit"
          :disabled="authenticateViaEmailInProgress || !email"
        >
          <template v-if="authenticateViaEmailInProgress">
            <icon-lucide-loader class="animate-spin" />
          </template>
          <template v-else> Continue </template>
        </Button>
      </div>
      <Separator label="Or" />
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
            <icon-mdi-google class="text-muted-foreground" />
          </template>
          Continue with Google
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
            <icon-mdi-microsoft class="text-muted-foreground" />
          </template>
          Continue with Microsoft
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
            <icon-mdi-apple class="text-muted-foreground" />
          </template>
          Continue with Apple
        </Button>
      </div>
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
    </div>
  </form>
  <EnterEmailSent
    v-else
    :email="email"
    @change-email="sendAuthenticateViaEmailSuccess = false"
  />
</template>
