<script lang="ts" setup>
import { IconArrowLeft, IconArrowRight } from "@/data/icons"

const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" @click="router.go(-1)">
          <IconArrowLeft />
        </Button>
      </TooltipTrigger>
      <TooltipContent> {{ t("tabs.goBack") }} </TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-xs" @click="router.go(1)">
          <IconArrowRight />
        </Button>
      </TooltipTrigger>
      <TooltipContent> {{ t("tabs.goForward") }} </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
