<script lang="ts" setup>
import { IconArrowLeft, IconCircleAlert, IconShieldCheck } from "@/data/icons"
import { handleSsoRedirectResult, signInWithSsoRedirect } from "@/modules/auth"

definePage({
  meta: {
    requiresGuest: true,
  },
})

useHead({
  title: "SSO Sign In",
})

const route = useRoute()

const email = computed(() => (route.query.email as string) || "")
const providerId = computed(() => (route.query.providerId as string) || "")
const redirectPath = computed(() => (route.query.redirect as string) || "")

const loading = ref(true)
const error = ref<string | null>(null)
const redirectCompleted = ref(false)

const startSsoRedirect = async () => {
  if (!providerId.value) {
    error.value = "No SSO provider specified. Please go back and try again."
    loading.value = false
    return
  }

  loading.value = true
  error.value = null

  try {
    await signInWithSsoRedirect(providerId.value, email.value)
  } catch (err) {
    console.error("[sso] redirect error:", err)
    error.value =
      err instanceof Error
        ? err.message
        : "Failed to start SSO sign-in. Please try again."
    loading.value = false
  }
}

onMounted(async () => {
  // First check if we're returning from an IdP redirect
  try {
    const completed = await handleSsoRedirectResult()
    if (completed) {
      redirectCompleted.value = true
      return
    }
  } catch (err) {
    console.error("[sso] redirect result error:", err)
    error.value =
      err instanceof Error
        ? err.message
        : "SSO sign-in failed. Please try again."
    loading.value = false
    return
  }

  // No redirect result — initiate the SSO redirect
  await startSsoRedirect()
})
</script>

<template>
  <OverlayScrollbarsWrapper class="bg-background">
    <div data-tauri-drag-region class="grid size-full grow place-items-center">
      <div
        class="mx-auto flex w-full max-w-sm flex-col items-center justify-center gap-8 p-4"
      >
        <!-- Loading / Redirecting -->
        <template v-if="loading && !error">
          <IconShieldCheck class="text-muted-foreground size-12" />
          <h2
            class="font-display text-center text-2xl leading-tight font-bold tracking-tight"
          >
            Signing in with SSO
          </h2>
          <p v-if="email" class="text-muted-foreground text-center text-sm">
            {{ email }}
          </p>
          <Spinner />
          <p class="text-muted-foreground text-center text-sm">
            Redirecting to your identity provider...
          </p>
        </template>

        <!-- Error State -->
        <template v-if="error">
          <Alert
            variant="destructive"
            class="bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px]"
          >
            <IconCircleAlert />
            <AlertTitle>SSO Sign-in Failed</AlertTitle>
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <div class="flex gap-2">
            <Button variant="outline" @click="startSsoRedirect">
              Try Again
            </Button>
            <Button variant="ghost" as-child>
              <RouterLink
                :to="{
                  path: '/enter',
                  query: redirectPath ? { redirect: redirectPath } : undefined,
                }"
              >
                <IconArrowLeft />
                Back to Login
              </RouterLink>
            </Button>
          </div>
        </template>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>
