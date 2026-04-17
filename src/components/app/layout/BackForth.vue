<script lang="ts" setup>
import { IconArrowLeft, IconArrowRight } from "@/data/icons"

const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <ButtonGroup>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="secondary" size="icon" @click="router.go(-1)">
            <IconArrowLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent> {{ t("tabs.goBack") }} </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="secondary" size="icon" @click="router.go(1)">
            <IconArrowRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent> {{ t("tabs.goForward") }} </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </ButtonGroup>
</template>
