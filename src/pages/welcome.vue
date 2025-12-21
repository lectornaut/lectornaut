<script lang="ts" setup>
import {
  IconAperture,
  IconArrowRight,
  IconBlocks,
  IconBox,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
} from "@/data/icons"
import { updateUserData } from "@/queries/updateUserData"

definePage({
  meta: {
    requiresUser: true,
  },
})

useHead({
  title: "Welcome",
})

const router = useRouter()

const completeOnboarding = () => {
  updateUserData({ onboarding: false })
  router.push("/home")
}

const steps = [
  {
    step: 1,
    title: "Account",
    description: "Add your address",
    icon: IconBox,
  },
  {
    step: 2,
    title: "Preferences",
    description: "Set your preferred",
    icon: IconAperture,
  },
  {
    step: 3,
    title: "Payment",
    description: "Add any payment",
    icon: IconBlocks,
  },
  {
    step: 4,
    title: "Confirmation",
    description: "Confirm your order",
    icon: IconCheck,
  },
]

const currentStep = ref(2)

const handleNextStep = () => {
  currentStep.value = currentStep.value + 1
}
</script>

<template>
  <div data-tauri-drag-region class="relative h-dvh w-dvw overscroll-none">
    <img src="/assets/images/sky.png" class="size-full object-cover" />
    <img
      src="/assets/images/bg-clear.png"
      class="fixed bottom-0 z-20 w-full overflow-visible object-cover"
    />
    <div
      class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 p-8"
    >
      <Logo class="text-primary-foreground size-8" />
      <div
        class="bg-background/25 flex size-full max-w-2xl flex-col gap-2 rounded-md p-2 text-center shadow-2xl backdrop-blur-lg"
      >
        <Stepper
          v-model="currentStep"
          class="bg-background hidden rounded-md p-4 md:flex"
        >
          <StepperItem
            v-for="step in steps"
            :key="step.step"
            v-slot="{ state }"
            :step="step.step"
            class="relative flex flex-1 flex-col items-center justify-center"
          >
            <StepperTrigger class="w-full">
              <StepperIndicator
                class="bg-muted group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-foreground"
              >
                <template v-if="step.icon">
                  <Component :is="step.icon" />
                </template>
                <template v-else>{{ step.step }}</template>
              </StepperIndicator>
              <StepperTitle>{{ step.title }}</StepperTitle>
              <StepperDescription>
                {{ step.step }} - {{ state }}
              </StepperDescription>
            </StepperTrigger>
            <StepperSeparator
              v-if="step.step < steps.length"
              class="bg-secondary/75 group-data-[state=completed]:bg-accent absolute top-5 right-[calc(-50%+10px)] left-[calc(50%+20px)] z-40 block h-1 shrink-0 rounded-full"
            />
          </StepperItem>
        </Stepper>
        <div
          class="bg-background flex flex-1 flex-col items-center justify-center gap-4 rounded-md p-4"
        >
          <template v-if="currentStep === 1">
            <h2 class="text-xl font-semibold">Account Details</h2>
            <p class="text-muted-foreground">
              Enter your personal information and address to get started.
            </p>
          </template>
          <template v-else-if="currentStep === 2">
            <h2 class="text-xl font-semibold">Your Preferences</h2>
            <p class="text-muted-foreground">
              Customize your experience by setting your preferred options.
            </p>
          </template>
          <template v-else-if="currentStep === 3">
            <h2 class="text-xl font-semibold">Payment Method</h2>
            <p class="text-muted-foreground">
              Add a payment method to complete your subscription.
            </p>
          </template>
          <template v-else-if="currentStep === 4">
            <h2 class="text-xl font-semibold">Confirmation</h2>
            <p class="text-muted-foreground">
              Review and confirm your details before proceeding.
            </p>
          </template>
          <template v-else>
            <h2 class="text-xl font-semibold">All Set!</h2>
            <p class="text-muted-foreground">
              You're ready to start using the app.
            </p>
          </template>
        </div>
        <div class="flex items-center gap-2 rounded-md backdrop-blur-lg">
          <Button
            variant="ghost"
            size="icon"
            :disabled="currentStep === 1"
            @click="currentStep = currentStep - 1"
          >
            <IconChevronLeft />
          </Button>
          <Stepper v-model="currentStep" class="flex flex-1 gap-2">
            <StepperItem
              v-for="step in steps"
              :key="step.step"
              :step="step.step"
              class="flex-1"
            >
              <StepperTrigger
                class="w-full flex-col items-start gap-2"
                as-child
              >
                <StepperIndicator
                  class="bg-border group-data-[state=active]:bg-primary-foreground h-1 w-full"
                >
                  <span class="sr-only">{{ step }}</span>
                </StepperIndicator>
              </StepperTrigger>
            </StepperItem>
          </Stepper>
          <Button
            v-if="currentStep <= steps.length"
            variant="ghost"
            size="icon"
            :disabled="currentStep > steps.length"
            @click="handleNextStep"
          >
            <IconChevronRight />
          </Button>
          <Button v-else size="icon" @click="completeOnboarding">
            <IconArrowRight />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
