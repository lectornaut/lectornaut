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
    breadcrumb: (route: { params: { channelId?: string } }) =>
      route.params.channelId ? `Channel ${route.params.channelId}` : "Channel",
  },
})

const router = useRouter()
const route = useRoute()

const getDefaultFormValues = (channel?: ProjectChannel): ChannelFormValues => ({
  name: channel?.name ?? "",
  targetUrl: channel?.targetUrl ?? "",
  transformation: channel?.transformation ?? DEFAULT_CHANNEL_TRANSFORMATION,
})

const store = useProjectChannelsStore()
const { sortedChannels } = storeToRefs(store)

const channelId = computed(() => route.params.channelId as string | undefined)
const channel = computed(() =>
  channelId.value ? store.getChannelById(channelId.value) : null
)

useHead(() => ({
  title: channel.value
    ? `${channel.value.name} · Projects`
    : "Channel · Projects",
}))

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

const { copy: copyToClipboard } = useClipboard()

const showSecret = ref(false)
const isRegenerating = ref(false)
const editDialogOpen = ref(false)
const editLoading = ref(false)
const editFormValues = ref<ChannelFormValues>(getDefaultFormValues())

const webhookUrl = computed(() =>
  channel.value ? getWebhookUrl(channel.value.id) : ""
)

const displayedSecret = computed(() => {
  if (!channel.value) return ""
  return showSecret.value
    ? channel.value.secret
    : maskSecret(channel.value.secret)
})

const stats = computed(() => {
  if (!channel.value) return []
  return [
    {
      label: "Total events",
      value: channel.value.totalEvents.toLocaleString(),
    },
    {
      label: "Success rate",
      value: `${channel.value.successRate}%`,
    },
    {
      label: "Last event",
      value: formatRelative(channel.value.lastEventAt),
    },
  ]
})

const goToNewChannel = () => {
  router.push({ path: "/projects", query: { new: "1" } })
}

const getWebhookUrl = (channelId: string) => {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.lectornaut.io"
  return `${origin}/api/webhooks/projects/${channelId}`
}

const maskSecret = (secret: string) => {
  if (!secret) return ""
  if (secret.length <= 6) return "••••"
  return `${secret.slice(0, 3)}••••${secret.slice(-3)}`
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

const copyWebhook = async () => {
  if (!channel.value) return
  try {
    await copyToClipboard(webhookUrl.value)
    toast.success("Webhook URL copied", {
      description: webhookUrl.value,
    })
  } catch (error) {
    console.error(error)
    toast.error("Unable to copy webhook URL")
  }
}

const copySecret = async () => {
  if (!channel.value) return
  try {
    await copyToClipboard(channel.value.secret)
    toast.success("Signing secret copied")
  } catch (error) {
    console.error(error)
    toast.error("Unable to copy secret")
  }
}

const openEditDialog = () => {
  if (!channel.value) return
  editFormValues.value = getDefaultFormValues(channel.value)
  editDialogOpen.value = true
}

const handleEditSubmit = async ({ values }: ChannelFormSubmitPayload) => {
  if (!channel.value) return
  editLoading.value = true
  try {
    const updated = await store.updateChannel(channel.value.id, values)
    toast.success("Channel updated", {
      description: `${updated.name} has been saved.`,
    })
    editDialogOpen.value = false
  } catch (error) {
    console.error(error)
    toast.error("Unable to update channel", {
      description: (error as Error)?.message,
    })
  } finally {
    editLoading.value = false
  }
}

const handleSecretRegeneration = async () => {
  if (!channel.value) return
  isRegenerating.value = true
  try {
    await store.regenerateSecret(channel.value.id)
    showSecret.value = true
    toast.success("Secret regenerated", {
      description: "Update downstream services with the new value.",
    })
  } catch (error) {
    console.error(error)
    toast.error("Unable to regenerate secret", {
      description: (error as Error)?.message,
    })
  } finally {
    isRegenerating.value = false
  }
}

watch(
  channel,
  (current) => {
    if (!current) {
      if (channelId.value) {
        toast.error("Channel not found")
      }
      router.replace("/projects")
      return
    }
    store.selectChannel(current.id)
  },
  { immediate: true }
)

watch(channel, (current) => {
  if (current && !editDialogOpen.value) {
    editFormValues.value = getDefaultFormValues(current)
  }
})

watch(channelId, () => {
  showSecret.value = false
})

watch(editDialogOpen, (open) => {
  if (!open) {
    editLoading.value = false
  }
})
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <div class="flex items-center justify-between gap-2 px-2 py-3">
          <span class="text-base font-medium">Channels</span>
          <Button size="sm" @click="goToNewChannel">
            <icon-lucide-plus class="size-4" />
            <span class="hidden sm:inline">New</span>
          </Button>
        </div>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem
                  v-for="item in sortedChannels"
                  :key="item.id"
                  class="group/nav"
                >
                  <SidebarMenuButton
                    as-child
                    class="group-has-[.router-link-active]/nav:bg-sidebar-accent group-has-[.router-link-active]/nav:text-sidebar-accent-foreground"
                  >
                    <RouterLink
                      :to="`/projects/${item.id}`"
                      class="flex w-full items-center justify-between gap-3"
                    >
                      <div class="flex min-w-0 flex-col gap-1 text-left">
                        <span class="truncate text-sm font-medium">
                          {{ item.name }}
                        </span>
                        <span class="text-muted-foreground text-xs">
                          {{ channelStatusMeta[item.status].label }}
                        </span>
                      </div>
                      <icon-lucide-chevron-right
                        class="text-muted-foreground"
                      />
                    </RouterLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
  <OverlayScrollbarsWrapper>
    <div
      v-if="channel"
      class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                :class="channelStatusMeta[channel.status].badge"
              >
                {{ channelStatusMeta[channel.status].label }}
              </Badge>
              <span class="text-muted-foreground text-xs">
                Updated {{ formatRelative(channel.updatedAt) }}
              </span>
            </div>
            <h1 class="text-3xl font-semibold tracking-tight">
              {{ channel.name }}
            </h1>
            <p class="text-muted-foreground text-sm">
              Delivering to
              <span class="font-mono text-xs break-all md:text-sm">
                {{ channel.targetUrl }}
              </span>
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="secondary" @click="copyWebhook">
                    <icon-lucide-link class="mr-2 size-4" />
                    Copy webhook URL
                  </Button>
                </TooltipTrigger>
                <TooltipContent> Copy the inbound webhook URL </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="outline" @click="openEditDialog">
              <icon-lucide-pencil class="mr-2 size-4" />
              Edit channel
            </Button>
          </div>
        </div>
        <p class="text-muted-foreground text-sm">
          {{ channelStatusMeta[channel.status].description }} ·
          {{ channel.totalEvents.toLocaleString() }} events delivered with
          {{ channel.successRate }}% success.
        </p>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signing secret</CardTitle>
            <CardDescription>
              Use this secret to verify webhook signatures.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex flex-col gap-2">
              <Label class="text-muted-foreground text-xs uppercase">
                Current secret
              </Label>
              <div
                class="bg-muted/30 flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm"
              >
                <span class="truncate break-all">{{ displayedSecret }}</span>
              </div>
            </div>
          </CardContent>
          <CardFooter class="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              @click="showSecret = !showSecret"
            >
              <icon-lucide-eye-off v-if="showSecret" class="mr-2 size-4" />
              <icon-lucide-eye v-else class="mr-2 size-4" />
              {{ showSecret ? "Hide" : "Reveal" }}
            </Button>
            <Button variant="outline" size="sm" @click="copySecret">
              <icon-lucide-copy class="mr-2 size-4" />
              Copy
            </Button>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button variant="destructive" size="sm">
                  <icon-lucide-refresh-cw class="mr-2 size-4" />
                  Regenerate
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Regenerate secret?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will invalidate the current signing secret. Update any
                    downstream services that rely on this value before sending
                    new events.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    :disabled="isRegenerating"
                    @click="handleSecretRegeneration"
                  >
                    <Spinner v-if="isRegenerating" class="mr-2 size-4" />
                    Regenerate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delivery health</CardTitle>
            <CardDescription>Recent performance and activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="grid gap-3">
              <div
                v-for="stat in stats"
                :key="stat.label"
                class="bg-muted/30 rounded-md border p-3"
              >
                <p class="text-muted-foreground text-xs uppercase">
                  {{ stat.label }}
                </p>
                <p class="text-lg font-semibold">{{ stat.value }}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transformation</CardTitle>
          <CardDescription>
            Runs before each payload is forwarded to your destination.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="bg-card rounded-md border">
            <CodeEditor
              :model-value="channel.transformation"
              read-only
              language="javascript"
            />
          </div>
        </CardContent>
      </Card>
    </div>
    <div
      v-else
      class="text-muted-foreground flex h-full items-center justify-center p-6"
    >
      <Spinner class="size-6" />
    </div>
  </OverlayScrollbarsWrapper>

  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup v-if="channel">
            <SidebarGroupLabel>Webhook endpoint</SidebarGroupLabel>
            <SidebarGroupContent class="space-y-3 px-3 py-4 text-sm">
              <div
                class="bg-muted/30 rounded-md border px-3 py-2 font-mono text-xs break-all"
              >
                {{ webhookUrl }}
              </div>
              <Button variant="ghost" size="sm" @click="copyWebhook">
                <icon-lucide-copy class="mr-2 size-4" />
                Copy URL
              </Button>
              <p class="text-muted-foreground text-xs">
                Requests are delivered as POST with an
                <code>X-Lectornaut-Signature</code>
                header containing an HMAC generated with the signing secret.
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Need help?</SidebarGroupLabel>
            <SidebarGroupContent class="space-y-2 px-3 py-4 text-sm">
              <Button variant="ghost" class="w-full justify-start" as-child>
                <RouterLink to="/docs/security">
                  <icon-lucide-shield-check class="mr-2 size-4" />
                  Verifying signatures
                </RouterLink>
              </Button>
              <Button variant="ghost" class="w-full justify-start" as-child>
                <RouterLink to="/docs/transformations">
                  <icon-lucide-code class="mr-2 size-4" />
                  Write transformations
                </RouterLink>
              </Button>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>

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
