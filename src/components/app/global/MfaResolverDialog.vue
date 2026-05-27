<script lang="ts" setup>
import { IconKeyRound, IconSmartphone } from "@/data/icons"
import { verifyPhoneNumberWithRecaptcha } from "@/helpers/firebase-phone-verification"
import { finishAuthentication } from "@/modules/auth"
import { auth } from "@/modules/firebase"
import { emitter } from "@/modules/mitt"
import { getAuthErrorMessage } from "@/utils/firebase/firebase-errors"
import {
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  TotpMultiFactorGenerator,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type PhoneInfoOptions,
} from "firebase/auth"
import { REGEXP_ONLY_DIGITS } from "vue-input-otp"
import { toast } from "vue-sonner"

const { t } = useI18n()

const open = ref(false)
const resolver = ref<MultiFactorResolver | null>(null)
const selectedHint = ref<MultiFactorInfo | null>(null)
const otpCode = ref("")
const verificationId = ref("")
const loading = ref(false)
const smsSent = ref(false)
const step = ref<"choose" | "verify">("choose")
const smsRecaptchaContainerId = "mfa-resolver-sms-recaptcha"
const RESEND_COOLDOWN_SECONDS = 10
const resendCountdown = ref(0)

const isTotp = computed(
  () => selectedHint.value?.factorId === TotpMultiFactorGenerator.FACTOR_ID
)

const isSms = computed(
  () => selectedHint.value?.factorId === PhoneMultiFactorGenerator.FACTOR_ID
)

const resendDisabled = computed(
  () => loading.value || resendCountdown.value > 0
)

// Non-reactive flag to guard against @complete firing twice before Vue flushes
let verifying = false
let resendCountdownTimer: number | null = null

function clearResendCountdown() {
  if (resendCountdownTimer !== null) {
    window.clearInterval(resendCountdownTimer)
    resendCountdownTimer = null
  }
}

function startResendCountdown() {
  clearResendCountdown()
  resendCountdown.value = RESEND_COOLDOWN_SECONDS
  resendCountdownTimer = window.setInterval(() => {
    if (resendCountdown.value <= 1) {
      resendCountdown.value = 0
      clearResendCountdown()
      return
    }
    resendCountdown.value -= 1
  }, 1000)
}

function resetState() {
  clearResendCountdown()
  resolver.value = null
  selectedHint.value = null
  otpCode.value = ""
  verificationId.value = ""
  loading.value = false
  smsSent.value = false
  resendCountdown.value = 0
  step.value = "choose"
  verifying = false
}

function handleOpen(mfaResolver: unknown) {
  const r = mfaResolver as MultiFactorResolver
  resetState()
  resolver.value = r

  if (r.hints.length === 1) {
    // Skip factor selection if only one factor enrolled
    selectHint(r.hints[0])
  } else {
    open.value = true
  }
}

async function selectHint(hint: MultiFactorInfo) {
  selectedHint.value = hint
  step.value = "verify"
  open.value = true

  // For SMS, automatically send the verification code
  if (hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
    await sendSmsCode()
  }
}

async function sendSmsCode() {
  if (loading.value || resendCountdown.value > 0) return
  if (!resolver.value || !selectedHint.value) return
  loading.value = true

  try {
    // The SMS verify step owns the hidden reCAPTCHA mount, so wait until the
    // dialog has rendered that branch before asking Firebase to attach to it.
    await nextTick()

    const phoneInfoOptions: PhoneInfoOptions = {
      multiFactorHint: selectedHint.value,
      session: resolver.value.session,
    }

    verificationId.value = await verifyPhoneNumberWithRecaptcha(
      auth,
      phoneInfoOptions,
      smsRecaptchaContainerId
    )
    smsSent.value = true
    startResendCountdown()
  } catch (error) {
    toast.error(getAuthErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function verifyCode() {
  if (verifying) return
  if (!resolver.value || !selectedHint.value) return
  verifying = true
  loading.value = true

  try {
    let assertion

    if (isTotp.value) {
      assertion = TotpMultiFactorGenerator.assertionForSignIn(
        selectedHint.value.uid,
        otpCode.value
      )
    } else if (isSms.value) {
      const cred = PhoneAuthProvider.credential(
        verificationId.value,
        otpCode.value
      )
      assertion = PhoneMultiFactorGenerator.assertion(cred)
    } else {
      toast.error(t("settings.account.mfa.unsupportedFactorType"))
      return
    }

    const result = await resolver.value.resolveSignIn(assertion)
    clearResendCountdown()
    resendCountdown.value = 0
    open.value = false
    await finishAuthentication(result)
  } catch (error) {
    toast.error(getAuthErrorMessage(error))
    otpCode.value = ""
  } finally {
    verifying = false
    loading.value = false
  }
}

function handleClose(isOpen: boolean) {
  if (!isOpen) {
    resetState()
  }
  open.value = isOpen
}

function getHintLabel(hint: MultiFactorInfo): string {
  if (hint.factorId === TotpMultiFactorGenerator.FACTOR_ID) {
    return t("settings.account.mfa.authenticatorApp")
  }
  if (hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
    return (
      (hint as { phoneNumber?: string }).phoneNumber ??
      t("settings.account.mfa.phone")
    )
  }
  return hint.factorId
}

onMounted(() => {
  emitter.on("Dialog.MfaResolver.Open", handleOpen)
})

onUnmounted(() => {
  clearResendCountdown()
  emitter.off("Dialog.MfaResolver.Open", handleOpen)
})
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {{ t("settings.account.mfa.mfaDialogTitle") }}
        </DialogTitle>
        <DialogDescription>
          {{ t("settings.account.mfa.mfaDialogDescription") }}
        </DialogDescription>
      </DialogHeader>
      <!-- Step: choose factor -->
      <div v-if="step === 'choose'" class="flex flex-col gap-2">
        <p class="text-muted-foreground text-sm">
          {{ t("settings.account.mfa.chooseMethod") }}
        </p>
        <Button
          v-for="hint in resolver?.hints"
          :key="hint.uid"
          variant="outline"
          class="justify-start gap-3"
          @click="selectHint(hint)"
        >
          <IconKeyRound
            v-if="hint.factorId === TotpMultiFactorGenerator.FACTOR_ID"
          />
          <IconSmartphone v-else />
          <span class="flex flex-col items-start">
            <span>{{ hint.displayName || getHintLabel(hint) }}</span>
            <span>{{ getHintLabel(hint) }}</span>
          </span>
        </Button>
      </div>
      <!-- Step: verify code -->
      <div v-if="step === 'verify'" class="flex flex-col justify-center gap-2">
        <div
          v-if="isSms && loading && !smsSent"
          class="flex items-center gap-2"
        >
          <Spinner />
          <span class="text-muted-foreground text-sm">
            {{ t("settings.account.mfa.sendingCode") }}
          </span>
        </div>
        <Field v-if="isTotp || smsSent" class="grid gap-4">
          <FieldLabel class="text-secondary-foreground text-xs">
            <template v-if="isTotp">
              {{ t("settings.account.mfa.enterTotpCode") }}
            </template>
            <template v-else-if="isSms">
              {{
                t("settings.account.mfa.enterSmsCode", {
                  phone: getHintLabel(selectedHint!),
                })
              }}
            </template>
          </FieldLabel>
          <InputOTP
            v-model="otpCode"
            :maxlength="6"
            :pattern="REGEXP_ONLY_DIGITS"
            @complete="verifyCode"
          >
            <InputOTPGroup>
              <InputOTPSlot :index="0" />
              <InputOTPSlot :index="1" />
              <InputOTPSlot :index="2" />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot :index="3" />
              <InputOTPSlot :index="4" />
              <InputOTPSlot :index="5" />
            </InputOTPGroup>
          </InputOTP>
        </Field>
        <div v-if="isSms" :id="smsRecaptchaContainerId" class="hidden" />
      </div>
      <DialogFooter
        v-if="step === 'verify' && (isTotp || smsSent)"
        class="flex-row justify-between sm:justify-between"
      >
        <div class="flex gap-2">
          <Button :disabled="otpCode.length < 6 || loading" @click="verifyCode">
            <Spinner v-if="loading" />
            {{ t("settings.account.mfa.verify") }}
          </Button>
          <DialogClose as-child>
            <Button variant="outline">
              {{ t("common.cancel") }}
            </Button>
          </DialogClose>
        </div>
        <Button
          v-if="isSms && smsSent"
          variant="outline"
          :disabled="resendDisabled"
          @click="sendSmsCode"
        >
          <span>{{ t("settings.account.mfa.resendCode") }}</span>
          <span
            v-if="resendCountdown > 0"
            class="text-muted-foreground relative inline-grid min-w-[2ch] place-items-center overflow-hidden tabular-nums"
          >
            <Transition
              enter-active-class="transition duration-200 ease-out"
              leave-active-class="transition duration-150 ease-in"
              enter-from-class="translate-y-2 opacity-0"
              leave-to-class="-translate-y-2 opacity-0"
            >
              <span :key="resendCountdown" class="col-start-1 row-start-1">
                {{ resendCountdown }}
              </span>
            </Transition>
          </span>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
