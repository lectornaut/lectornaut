<script lang="ts" setup>
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useKeychain } from "@/composables/useKeychain"
import {
  IconAppleFilled,
  IconArrowRight,
  IconChevronRight,
  IconCircleAlert,
  IconCircleUser,
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
  IconTrash,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import {
  sendAuthenticateEmail,
  sendResetEmailPassword,
  signInWithApple,
  signInWithEmailPassword,
  signInWithGoogle,
  signInWithMicrosoft,
  signUpWithEmailPassword,
  switchAccount,
} from "@/modules/auth"
import { getAuthErrorMessage } from "@/utils/firebase-errors"

const { t } = useI18n()

const { accounts, removeAccount } = useKeychain()

const authMode = ref<"sign-up" | "sign-in">("sign-in")
const authenticateError = ref<string | boolean>(false)

const email = ref<string>("")
const password = ref<string>("")
const passwordInputType = ref<"password" | "text">("password")

const lastAuthProvider = useStorage<string | null>("lastAuthProvider", null)

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
    authenticateError.value = getAuthErrorMessage(error)
  } finally {
    loadingState.value = false
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

const isShowAllOptionsOpen = ref(accounts.value.length === 0)

watch(accounts, (newAccounts) => {
  if (newAccounts.length === 0) {
    isShowAllOptionsOpen.value = true
  }
})
</script>

<template>
  <Collapsible v-model:open="isShowAllOptionsOpen">
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
          <Button variant="link" tabindex="-1" @click="authMode = 'sign-in'">
            {{ t("enter.signIn") }}
            <IconChevronRight />
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
          <Button variant="link" tabindex="-1" @click="authMode = 'sign-up'">
            {{ t("enter.signUp") }}
            <IconChevronRight />
          </Button>
        </div>
      </TabsContent>
      <!-- <TabsList class="mx-auto w-full">
      <TabsTrigger value="sign-up"> Sign up </TabsTrigger>
      <TabsTrigger value="sign-in"> Sign in </TabsTrigger>
    </TabsList> -->
      <template v-if="accounts.length > 0 && !isShowAllOptionsOpen">
        <div class="grid gap-2">
          <Item
            v-for="account in accounts"
            :key="account.uid"
            variant="muted"
            size="sm"
            class="group hover:bg-accent w-full"
            @click="switchAccount(account.uid)"
          >
            <ItemMedia>
              <Avatar class="size-9 rounded-md">
                <AvatarImage
                  v-if="account.photoURL"
                  class="rounded-md"
                  :src="account.photoURL"
                  :alt="account?.displayName"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback class="rounded-md">
                  {{ getInitials(account.displayName!) }}
                </AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">{{ account.displayName }}</ItemTitle>
              <ItemDescription class="truncate text-xs">
                {{ account.email }}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="invisible transition group-hover:visible"
                      @click.stop="removeAccount(account.uid)"
                    >
                      <IconTrash />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("enter.removeAccount") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon">
                      <IconArrowRight />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("enter.useAccount") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ItemActions>
          </Item>
        </div>
      </template>
      <CollapsibleContent class="grid gap-8">
        <div class="flex flex-col gap-2">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <Label for="email" class="text-foreground">
                {{ t("enter.labels.email") }}
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
                      <p>{{ t("enter.tooltips.notifications") }}</p>
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
                        {{ t("enter.magicLink.tooltip") }}
                      </TooltipContent>
                      <TooltipProvider v-if="lastAuthProvider === 'email-link'">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Badge
                              variant="destructive"
                              tabindex="-1"
                              class="absolute -top-3 right-3"
                            >
                              <IconDisc /> {{ t("enter.magicLink.recent") }}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {{ t("enter.magicLink.lastUsed") }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Tooltip>
                  </TooltipProvider>
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
                      <Button
                        :disabled="!email"
                        variant="destructive"
                        @click="authenticateEmail"
                      >
                        <Spinner v-if="authenticateEmailInProgress" />
                        {{ t("enter.magicLink.send") }}
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
                :placeholder="t('enter.placeholders.emailExample')"
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
                      <AlertDialogCancel>{{
                        t("enter.cancel")
                      }}</AlertDialogCancel>
                      <Button
                        :disabled="!email"
                        variant="destructive"
                        @click="resetPassword"
                      >
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
                      class="absolute -top-3 right-3"
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
        </div>
        <div class="relative">
          <Separator />
          <Badge
            variant="outline"
            class="bg-muted text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            {{ t("enter.orContinueWith") }}
          </Badge>
        </div>
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
            {{ t("enter.microsoft") }}
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
            {{ t("enter.apple") }}
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
      </CollapsibleContent>
      <CollapsibleTrigger v-if="accounts.length > 0" as-child class="mx-auto">
        <Badge variant="outline">
          <IconCircleUser v-if="isShowAllOptionsOpen" />
          <IconLock v-else />
          {{
            isShowAllOptionsOpen
              ? t("enter.showAllAccounts")
              : t("enter.showAllAuthOptions")
          }}
          <IconChevronRight />
        </Badge>
      </CollapsibleTrigger>
      <Alert
        v-if="authenticateError"
        variant="destructive"
        class="bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] bg-fixed"
      >
        <IconCircleAlert />
        <AlertTitle> {{ t("enter.uhoh") }} </AlertTitle>
        <AlertDescription>
          {{ authenticateError }}
        </AlertDescription>
      </Alert>
    </Tabs>
  </Collapsible>
</template>
