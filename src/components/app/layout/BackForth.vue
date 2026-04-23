<script lang="ts" setup>
import { IconArrowLeft, IconArrowRight } from "@/data/icons"

const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <TooltipProvider>
    <ButtonGroup>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="secondary" size="icon-sm" @click="router.go(-1)">
            <IconArrowLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent> {{ t("tabs.goBack") }} </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="secondary" size="icon-sm" @click="router.go(1)">
            <IconArrowRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent> {{ t("tabs.goForward") }} </TooltipContent>
      </Tooltip>
    </ButtonGroup>
  </TooltipProvider>
</template>
