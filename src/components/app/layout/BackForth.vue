<script lang="ts" setup>
import { IconChevronLeft, IconChevronRight } from "@/data/icons"

const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <TooltipProvider>
    <ButtonGroup>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="outline" size="icon-sm" @click="router.go(-1)">
            <IconChevronLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent> {{ t("tabs.goBack") }} </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="outline" size="icon-sm" @click="router.go(1)">
            <IconChevronRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent> {{ t("tabs.goForward") }} </TooltipContent>
      </Tooltip>
    </ButtonGroup>
  </TooltipProvider>
</template>
