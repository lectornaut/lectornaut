<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconAperture,
  IconBlocks,
  IconBox,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCommand,
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
const isFullscreen = useIsFullscreen()

const completeOnboarding = () => {
  void updateUserData({ onboarding: false }).catch((error) => {
    console.error("[welcome] Failed to persist onboarding completion:", error)
  })
  router.push("/start")
}

const { t } = useI18n()

const steps = computed(() => [
  {
    step: 1,
    title: t("pages.welcome.steps.account.title"),
    description: t("pages.welcome.steps.account.description"),
    icon: IconBox,
  },
  {
    step: 2,
    title: t("pages.welcome.steps.appearance.title"),
    description: t("pages.welcome.steps.appearance.description"),
    icon: IconAperture,
  },
  {
    step: 3,
    title: t("pages.welcome.steps.teamWorkspace.title"),
    description: t("pages.welcome.steps.teamWorkspace.description"),
    icon: IconBlocks,
  },
  {
    step: 4,
    title: t("pages.welcome.steps.app.title"),
    description: t("pages.welcome.steps.app.description"),
    icon: IconCommand,
  },
  {
    step: 5,
    title: t("pages.welcome.steps.plans.title"),
    description: t("pages.welcome.steps.plans.description"),
    icon: IconCheck,
  },
])

const currentStep = ref(1)
const activeStep = computed(() =>
  steps.value.find((step) => step.step === currentStep.value)
)
const totalSteps = computed(() => steps.value.length)

const handlePreviousStep = () => {
  if (currentStep.value > 1) {
    currentStep.value = currentStep.value - 1
  }
}

const handleNextStep = () => {
  if (currentStep.value < totalSteps.value) {
    currentStep.value = currentStep.value + 1
  }
}
</script>

<template>
  <SidebarProvider :default-open="true">
    <Sidebar collapsible="none">
      <SidebarContent
        data-tauri-drag-region
        :class="{ 'mt-12': isTauri && !isFullscreen }"
      >
        <SidebarGroup>
          <SidebarGroupLabel>
            Step {{ Math.min(currentStep, totalSteps) }} of {{ totalSteps }}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <Stepper
              v-model="currentStep"
              :linear="false"
              orientation="vertical"
              class="flex flex-col"
            >
              <StepperItem
                v-for="step in steps"
                :key="step.step"
                v-slot="{ state }"
                :step="step.step"
                class="relative"
              >
                <SidebarMenuButton as-child :is-active="state === 'active'">
                  <StepperTrigger class="flex flex-row items-center">
                    <StepperIndicator
                      class="size-4 bg-transparent group-data-[state=active]:bg-transparent"
                    >
                      <IconCheck v-if="state === 'completed'" class="size-3!" />
                      <template v-else-if="state === 'active'">
                        <span
                          class="relative flex size-4 items-center justify-center"
                        >
                          <span
                            class="bg-primary/25 absolute size-4 rounded"
                          />
                          <span
                            class="bg-primary relative block size-2 rounded"
                          />
                        </span>
                      </template>
                      <template v-else>
                        <span
                          class="bg-muted-foreground/25 group-hover:bg-muted-foreground/50 block size-2 rounded"
                        />
                      </template>
                    </StepperIndicator>
                    <div class="min-w-0 flex-1">
                      <StepperTitle
                        :class="{
                          'text-primary': state === 'active',
                          'text-foreground': state === 'completed',
                          'text-muted-foreground': state === 'inactive',
                        }"
                      >
                        {{ step.title }}
                      </StepperTitle>
                    </div>
                  </StepperTrigger>
                </SidebarMenuButton>
                <StepperSeparator
                  v-if="step.step < steps.length"
                  class="bg-muted group-data-[state=completed]:bg-primary/50 absolute top-7 left-4 h-4 w-px"
                />
              </StepperItem>
            </Stepper>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
    <Separator orientation="vertical" />
    <SidebarInset class="bg-background flex min-h-0 flex-1 rounded-none">
      <div class="border-b p-5 text-left">
        <h2 class="text-xl font-semibold">
          {{ activeStep?.title || t("pages.welcome.content.allSet") }}
        </h2>
        <p class="text-muted-foreground">
          {{
            activeStep?.description ||
            t("pages.welcome.content.allSetDescription")
          }}
        </p>
      </div>

      <div class="min-h-0 flex-1 overflow-auto text-left">
        <template v-if="currentStep === 1">
          <OnboardingAccountFlow />
        </template>
        <template v-else-if="currentStep === 2">
          <OnboardingAppearanceFlow />
        </template>
        <template v-else-if="currentStep === 3">
          <OnboardingTeamWorkspaceFlow />
        </template>
        <template v-else-if="currentStep === 4">
          <OnboardingAppFlow />
        </template>
        <template v-else-if="currentStep === 5">
          <div
            class="text-muted-foreground flex h-full min-h-80 flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <h3 class="text-foreground text-base font-medium">
              {{ t("pages.welcome.content.plans") }}
            </h3>
            <p class="max-w-md text-sm">
              {{ t("pages.welcome.content.plansDescription") }}
            </p>
          </div>
        </template>
        <template v-else>
          <h2 class="px-6 pt-6 text-xl font-semibold">
            {{ t("pages.welcome.content.allSet") }}
          </h2>
          <p class="text-muted-foreground px-6 pb-6">
            {{ t("pages.welcome.content.allSetDescription") }}
          </p>
        </template>
      </div>

      <div class="border-t p-3">
        <div class="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="currentStep === 1"
            @click="handlePreviousStep"
          >
            <IconChevronLeft />
            Back
          </Button>
          <Button
            v-if="currentStep < totalSteps"
            size="sm"
            @click="handleNextStep"
          >
            Next
            <IconChevronRight />
          </Button>
          <Button v-else size="sm" @click="completeOnboarding">
            Continue
            <IconChevronRight />
          </Button>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
