<script setup lang="ts">
import ChannelForm, {
  type ChannelFormSubmitPayload,
  type ChannelFormValues,
} from "@/components/projects/ChannelForm.vue"
import {
  DEFAULT_CHANNEL_TRANSFORMATION,
  useProjectChannelsStore,
} from "@/stores/projectChannelsStore"
import type { ProjectChannel, ProjectChannelStatus } from "@/types"
import { useClipboard } from "@vueuse/core"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Projects",
    breadcrumb: "Projects",
  },
})

useHead({
  title: "Projects",
})

const router = useRouter()
const route = useRoute()

const getDefaultFormValues = (): ChannelFormValues => ({
  name: "",
  targetUrl: "",
  transformation: DEFAULT_CHANNEL_TRANSFORMATION,
})

const store = useProjectChannelsStore()
const { sortedChannels } = storeToRefs(store)

const createDialogOpen = ref(false)
const createLoading = ref(false)
const createFormValues = ref<ChannelFormValues>(getDefaultFormValues())

const editDialogOpen = ref(false)
const editLoading = ref(false)
const editFormValues = ref<ChannelFormValues>(getDefaultFormValues())
const editingChannelId = ref<string | null>(null)

const { copy: copyToClipboard } = useClipboard()

const statusOrder: ProjectChannelStatus[] = ["active", "paused", "error"]

const channelStatusMeta: Record<
  ProjectChannelStatus,
  { label: string; badge: string; dot: string; description: string }
> = {
  active: {
    label: "Active",
    badge: "bg-emerald-500/10 text-emerald-500",
    dot: "bg-emerald-500",
    description: "Delivering normally",
  },
  paused: {
    label: "Paused",
    badge: "bg-amber-500/10 text-amber-500",
    dot: "bg-amber-500",
    description: "Delivery suspended",
  },
  error: {
    label: "Attention",
    badge: "bg-red-500/10 text-red-500",
    dot: "bg-red-500",
    description: "Investigate delivery errors",
  },
}

const statusCounts = computed(() =>
  sortedChannels.value.reduce<Record<ProjectChannelStatus, number>>(
    (acc, channel) => {
      acc[channel.status] += 1
      return acc
    },
    { active: 0, paused: 0, error: 0 }
  )
)

const totalDeliveries = computed(() =>
  sortedChannels.value.reduce((acc, channel) => acc + channel.totalEvents, 0)
)

const averageSuccessRate = computed(() => {
  if (!sortedChannels.value.length) return 0
  const total = sortedChannels.value.reduce(
    (acc, channel) => acc + channel.successRate,
    0
  )
  return Math.round(total / sortedChannels.value.length)
})

const hasChannels = computed(() => sortedChannels.value.length > 0)

const openCreateDialog = () => {
  createFormValues.value = getDefaultFormValues()
  createDialogOpen.value = true
}

const openEditDialog = (channel: ProjectChannel) => {
  editingChannelId.value = channel.id
  editFormValues.value = {
    name: channel.name,
    targetUrl: channel.targetUrl,
    transformation: channel.transformation,
  }
  editDialogOpen.value = true
}

const viewChannel = (channel: ProjectChannel) => {
  router.push(`/projects/${channel.id}`)
}

const getWebhookUrl = (channelId: string) => {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.lectornaut.io"
  return `${origin}/api/webhooks/projects/${channelId}`
}

const copyWebhookUrl = async (channel: ProjectChannel) => {
  const url = getWebhookUrl(channel.id)
  try {
    await copyToClipboard(url)
    toast.success("Webhook URL copied", {
      description: url,
    })
  } catch (error) {
    console.error(error)
    toast.error("Unable to copy webhook URL")
  }
}

const statusSummary = (channel: ProjectChannel) => {
  const summary = channelStatusMeta[channel.status].description
  const volume = channel.totalEvents
    ? `${channel.totalEvents.toLocaleString()} events · ${channel.successRate}% success`
    : "Awaiting first delivery"
  return `${summary} • ${volume}`
}

const formatRelative = (date: Date | null) => {
  if (!date) return "No deliveries yet"
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return "Just now"
  if (diff < hour) {
    const minutes = Math.round(diff / minute)
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  }
  if (diff < day) {
    const hours = Math.round(diff / hour)
    return `${hours} hour${hours === 1 ? "" : "s"} ago`
  }
  if (diff < day * 7) {
    const days = Math.round(diff / day)
    return `${days} day${days === 1 ? "" : "s"} ago`
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

const handleCreateSubmit = async ({
  values,
  resetForm,
}: ChannelFormSubmitPayload) => {
  createLoading.value = true
  try {
    const channel = await store.createChannel(values)
    toast.success("Channel created", {
      description: `${channel.name} is ready to receive events.`,
    })
    resetForm()
    createDialogOpen.value = false
    await router.push(`/projects/${channel.id}`)
  } catch (error) {
    console.error(error)
    toast.error("Unable to create channel", {
      description: (error as Error)?.message,
    })
  } finally {
    createLoading.value = false
  }
}

const handleEditSubmit = async ({ values }: ChannelFormSubmitPayload) => {
  if (!editingChannelId.value) return

  editLoading.value = true
  try {
    const channel = await store.updateChannel(editingChannelId.value, values)
    toast.success("Channel updated", {
      description: `${channel.name} has been saved.`,
    })
    editDialogOpen.value = false
    editingChannelId.value = null
  } catch (error) {
    console.error(error)
    toast.error("Unable to update channel", {
      description: (error as Error)?.message,
    })
  } finally {
    editLoading.value = false
  }
}

watch(
  () => route.query.new,
  (value) => {
    const shouldOpen = Array.isArray(value)
      ? value.includes("1")
      : value === "1"
    if (shouldOpen && !createDialogOpen.value) {
      openCreateDialog()
    }
  },
  { immediate: true }
)

watch(createDialogOpen, (open) => {
  if (!open) {
    if (route.query.new) {
      const query = { ...route.query }
      delete query.new
      router.replace({ path: route.path, query })
    }
    createLoading.value = false
  }
})

watch(editDialogOpen, (open) => {
  if (!open) {
    editLoading.value = false
    editingChannelId.value = null
  }
})
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <div class="flex items-center justify-between gap-2 px-2 py-3">
          <span class="text-base font-medium">Channels</span>
          <Button size="sm" @click="openCreateDialog">
            <icon-lucide-plus class="size-4" />
            <span class="hidden sm:inline">New</span>
          </Button>
        </div>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <SidebarGroupLabel>Status overview</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="status in statusOrder" :key="status">
                  <SidebarMenuButton class="justify-between">
                    <div class="flex items-center gap-2">
                      <span
                        class="size-2 rounded-full"
                        :class="channelStatusMeta[status].dot"
                      />
                      <span>{{ channelStatusMeta[status].label }}</span>
                    </div>
                    <Badge variant="secondary">
                      {{ statusCounts[status] ?? 0 }}
                    </Badge>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <Separator class="my-2" />
          <SidebarGroup>
            <SidebarGroupLabel>Delivery health</SidebarGroupLabel>
            <SidebarGroupContent class="px-2 py-3">
              <div class="space-y-4 text-sm">
                <div class="flex flex-col gap-1">
                  <span class="text-sm font-medium">
                    {{ totalDeliveries.toLocaleString() }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    Total events delivered
                  </span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-sm font-medium">
                    {{ averageSuccessRate }}%
                  </span>
                  <span class="text-muted-foreground text-xs">
                    Average success rate
                  </span>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
  <OverlayScrollbarsWrapper>
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div
        class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="space-y-1">
          <h1 class="text-3xl font-semibold tracking-tight">
            Project Channels
          </h1>
          <p class="text-muted-foreground max-w-2xl text-sm">
            Manage webhook destinations for your projects. Create channels to
            relay events to downstream systems with optional payload
            transformations.
          </p>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto">
          <Button variant="outline" as-child>
            <a
              href="https://docs.lectornaut.io/webhooks"
              target="_blank"
              rel="noreferrer"
              class="flex items-center gap-2"
            >
              <icon-lucide-book-open />
              <span>Documentation</span>
            </a>
          </Button>
          <Button @click="openCreateDialog">
            <icon-lucide-plus />
            <span>New Channel</span>
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader
          class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <CardTitle>Active channels</CardTitle>
            <CardDescription>
              {{ sortedChannels.length }} destinations configured.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" @click="openCreateDialog">
            <icon-lucide-plus class="size-4" />
            Add channel
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-[240px]">Channel</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead class="w-[220px]">Health</TableHead>
                <TableHead class="w-[160px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody v-if="hasChannels">
              <TableRow v-for="channel in sortedChannels" :key="channel.id">
                <TableCell class="align-top">
                  <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <RouterLink
                        :to="`/projects/${channel.id}`"
                        class="hover:text-primary text-sm font-medium"
                      >
                        {{ channel.name }}
                      </RouterLink>
                      <Badge
                        variant="secondary"
                        :class="channelStatusMeta[channel.status].badge"
                      >
                        {{ channelStatusMeta[channel.status].label }}
                      </Badge>
                    </div>
                    <p class="text-muted-foreground text-xs">
                      {{ statusSummary(channel) }}
                    </p>
                  </div>
                </TableCell>
                <TableCell class="align-top text-sm">
                  <span class="font-mono text-xs break-all md:text-sm">
                    {{ channel.targetUrl }}
                  </span>
                </TableCell>
                <TableCell class="align-top text-sm">
                  <div class="flex flex-col gap-1">
                    <span class="font-medium">
                      {{ channel.successRate }}% success
                    </span>
                    <span class="text-muted-foreground text-xs">
                      Last event {{ formatRelative(channel.lastEventAt) }}
                    </span>
                  </div>
                </TableCell>
                <TableCell class="align-top">
                  <div class="flex items-center justify-end gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-8"
                            @click="copyWebhookUrl(channel)"
                          >
                            <icon-lucide-copy />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent> Copy webhook URL </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-8"
                            @click="openEditDialog(channel)"
                          >
                            <icon-lucide-pencil />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent> Edit channel </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-8"
                            @click="viewChannel(channel)"
                          >
                            <icon-lucide-arrow-up-right />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent> Open details </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
            <TableBody v-else>
              <TableEmpty colspan="4">
                <div class="flex flex-col items-center gap-3">
                  <icon-lucide-radar class="text-muted-foreground size-6" />
                  <div class="text-center">
                    <p class="text-sm font-medium">No channels yet</p>
                    <p class="text-muted-foreground text-xs">
                      Create a channel to start delivering project events to
                      your services.
                    </p>
                  </div>
                  <Button size="sm" @click="openCreateDialog">
                    <icon-lucide-plus class="size-4" />
                    Create channel
                  </Button>
                </div>
              </TableEmpty>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  </OverlayScrollbarsWrapper>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <SidebarGroupLabel>Working with channels</SidebarGroupLabel>
            <SidebarGroupContent class="space-y-3 px-3 py-4 text-sm">
              <p class="text-muted-foreground">
                Channels deliver signed POST requests to your infrastructure.
                Use the transformation function to sanitize payloads or enrich
                them with additional context.
              </p>
              <p class="text-muted-foreground">
                Regenerate the secret any time credentials are rotated. Update
                downstream services with the new value to keep deliveries
                flowing.
              </p>
              <Button variant="ghost" class="w-full justify-start" as-child>
                <RouterLink to="/docs/webhooks" class="gap-2">
                  <icon-lucide-external-link class="size-4" />
                  Webhook guide
                </RouterLink>
              </Button>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>

  <Dialog v-model:open="createDialogOpen">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Create channel</DialogTitle>
        <DialogDescription>
          Define the destination and optional transformation for this webhook.
        </DialogDescription>
      </DialogHeader>
      <ChannelForm
        :initial-values="createFormValues"
        :loading="createLoading"
        @submit="handleCreateSubmit"
      >
        <template #footer="{ isSubmitting }">
          <DialogFooter class="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              :disabled="isSubmitting || createLoading"
              @click="createDialogOpen = false"
            >
              Cancel
            </Button>
            <Button type="submit" :disabled="isSubmitting || createLoading">
              <Spinner
                v-if="isSubmitting || createLoading"
                class="mr-2 size-4"
              />
              Create channel
            </Button>
          </DialogFooter>
        </template>
      </ChannelForm>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="editDialogOpen">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Edit channel</DialogTitle>
        <DialogDescription>
          Update the destination or transformation logic for this channel.
        </DialogDescription>
      </DialogHeader>
      <ChannelForm
        :initial-values="editFormValues"
        :loading="editLoading"
        @submit="handleEditSubmit"
      >
        <template #footer="{ isSubmitting }">
          <DialogFooter class="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              :disabled="isSubmitting || editLoading"
              @click="editDialogOpen = false"
            >
              Cancel
            </Button>
            <Button type="submit" :disabled="isSubmitting || editLoading">
              <Spinner v-if="isSubmitting || editLoading" class="mr-2 size-4" />
              Save changes
            </Button>
          </DialogFooter>
        </template>
      </ChannelForm>
    </DialogContent>
  </Dialog>
</template>
