<script lang="ts" setup>
import { summarizeNode } from "@/composables/useFunctions"
import {
  IconCalendar,
  IconClock,
  IconFolder,
  IconHash,
  IconInfo,
  IconRefreshCw,
  IconSparkles,
  IconUserRound,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { isAgentMembership, isUserMembership } from "@/types/membership"
import {
  ROOT_PARENT_ID,
  type WorkspaceNode,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import { FirebaseError } from "firebase/app"
import { storeToRefs } from "pinia"
import { ref, toRef, watch } from "vue"
import { toast } from "vue-sonner"

const props = defineProps<{
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  node: WorkspaceNode
}>()

const { t } = useI18n()

const node = toRef(props, "node")
const authStore = useAuthStore()
const membershipStore = useMembershipStore()

const { currentUser, userProfile } = storeToRefs(authStore)
const { teamMembers } = storeToRefs(membershipStore)

// ── AI summary (structured output) ─────────────────────────────────────
//
// Backed by the `summarizeNode` callable, which uses Genkit's
// `ai.generate({ output: { schema } })` to force the model into a
// strictly-shaped JSON payload (summary + keyPoints + suggestedTags).
// We render the parsed object directly — no markdown parsing, no
// free-text guesswork — because the server-side Zod schema guarantees
// the shape.
//
// Cached per node *for the lifetime of this component instance*.
// Switching nodes resets the state (the `watch(node.id)` below) so the
// inspector never shows a previous file's summary against a new file.
interface NodeSummary {
  summary: string
  keyPoints: string[]
  suggestedTags: string[]
  model: string
}

const summary = ref<NodeSummary | null>(null)
const isSummarizing = ref(false)
const summaryError = ref<string | null>(null)

// Reset on node switch so the user never sees stale results.
watch(
  () => node.value.id,
  () => {
    summary.value = null
    summaryError.value = null
  }
)

const handleGenerateSummary = async () => {
  if (isSummarizing.value) return
  isSummarizing.value = true
  summaryError.value = null
  try {
    const { data } = await summarizeNode({
      teamId: props.teamId,
      workspaceId: props.workspaceId,
      scope: props.scope,
      nodeId: node.value.id,
    })
    summary.value = {
      summary: data.summary,
      keyPoints: data.keyPoints,
      suggestedTags: data.suggestedTags,
      model: data.model,
    }
  } catch (error) {
    console.error("[NodeDetails] summarize failed:", error)
    const code = error instanceof FirebaseError ? error.code : null
    const msg =
      code === "functions/failed-precondition"
        ? t("inspector.summary.errorArchived")
        : code === "functions/not-found"
          ? t("inspector.summary.errorNotFound")
          : t("inspector.summary.errorGeneric")
    summaryError.value = msg
    toast.error(msg)
  } finally {
    isSummarizing.value = false
  }
}

const formatTimestamp = (
  value:
    | {
        toDate?: () => Date
      }
    | null
    | undefined
) => {
  const timestamp = value?.toDate?.()
  return timestamp
    ? useDateFormat(timestamp, "MMM D, YYYY · h:mm A").value
    : "—"
}

const formatActor = (userId: string | null | undefined) => {
  if (!userId) return "Unknown"
  if (userId === "local") return "Local"

  if (currentUser.value?.uid === userId) {
    return (
      userProfile.value?.displayName ||
      currentUser.value.displayName ||
      currentUser.value.email ||
      "You"
    )
  }

  const member = teamMembers.value
    .filter(isUserMembership)
    .find((entry) => entry.userId === userId)
  if (member) {
    return member.user?.displayName || member.user?.email || member.userId
  }

  // Agent-authored edits record the agent id in updatedBy/createdBy.
  const agentMember = teamMembers.value
    .filter(isAgentMembership)
    .find((entry) => entry.agentId === userId)
  if (agentMember) return agentMember.agent.name

  return userId
}

const nodeTypeLabel = computed(() =>
  node.value.type === "file" ? "File" : "Folder"
)

const nodeParentLabel = computed(() =>
  node.value.parentId === ROOT_PARENT_ID ? "Root" : node.value.parentId
)

const nodeStatusLabel = computed(() =>
  node.value.isArchived ? "Archived" : "Active"
)
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col">
    <Card size="sm" class="m-2 shadow-none">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <IconSparkles class="text-muted-foreground" />
          {{ t("inspector.summary.title") }}
        </CardTitle>
        <CardAction>
          <Button
            v-if="!summary && !isSummarizing"
            size="sm"
            variant="secondary"
            :disabled="node.isArchived"
            @click="handleGenerateSummary"
          >
            {{ t("inspector.summary.generate") }}
          </Button>
          <Button
            v-else-if="summary && !isSummarizing"
            size="sm"
            variant="ghost"
            @click="handleGenerateSummary"
          >
            <IconRefreshCw />
            {{ t("inspector.summary.regenerate") }}
          </Button>
          <div
            v-else-if="isSummarizing"
            class="text-muted-foreground flex items-center gap-2 text-xs"
          >
            <Spinner />
            {{ t("inspector.summary.loading") }}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div
          v-if="!summary && !isSummarizing && !summaryError"
          class="text-muted-foreground text-xs"
        >
          {{
            node.isArchived
              ? t("inspector.summary.archivedHint")
              : t("inspector.summary.empty")
          }}
        </div>

        <div
          v-if="summaryError && !isSummarizing"
          class="text-destructive text-xs"
        >
          {{ summaryError }}
        </div>

        <div v-if="summary" class="flex flex-col gap-2">
          <p class="text-foreground leading-relaxed">
            {{ summary.summary }}
          </p>

          <div v-if="summary.keyPoints.length > 0" class="flex flex-col gap-1">
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("inspector.summary.keyPoints") }}
            </span>
            <ul class="text-foreground list-inside list-disc space-y-1">
              <li
                v-for="(point, idx) in summary.keyPoints"
                :key="idx"
                class="leading-relaxed"
              >
                {{ point }}
              </li>
            </ul>
          </div>

          <div
            v-if="summary.suggestedTags.length > 0"
            class="flex flex-col gap-1"
          >
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("inspector.summary.tags") }}
            </span>
            <div class="flex flex-wrap gap-1">
              <Badge
                v-for="tag in summary.suggestedTags"
                :key="tag"
                variant="secondary"
                class="text-xs"
              >
                {{ tag }}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter v-if="summary">
        <p class="text-muted-foreground text-xs">
          {{ t("inspector.summary.modelFooter", { model: summary.model }) }}
        </p>
      </CardFooter>
    </Card>
    <OverlayScrollbarsWrapper>
      <dl>
        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconUserRound />
            Author
          </dt>
          <dd class="text-right break-all">
            {{ formatActor(node.createdBy) }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconUserRound />
            Updated by
          </dt>
          <dd class="text-right break-all">
            {{ formatActor(node.updatedBy) }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconCalendar />
            Created
          </dt>
          <dd class="text-right">
            {{ formatTimestamp(node.createdAt) }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconClock />
            Updated
          </dt>
          <dd class="text-right">
            {{ formatTimestamp(node.updatedAt) }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconInfo />
            Type
          </dt>
          <dd class="text-right">
            {{ nodeTypeLabel }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconInfo />
            Status
          </dt>
          <dd class="text-right">
            {{ nodeStatusLabel }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconFolder />
            Parent
          </dt>
          <dd class="text-right break-all">
            {{ nodeParentLabel }}
          </dd>
        </div>

        <div
          v-if="node.isArchived"
          class="flex items-start justify-between gap-2"
        >
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconCalendar />
            Archived
          </dt>
          <dd class="text-right">
            {{ formatTimestamp(node.archivedAt) }}
          </dd>
        </div>

        <div
          v-if="node.isArchived"
          class="flex items-start justify-between gap-2"
        >
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconUserRound />
            Archived by
          </dt>
          <dd class="text-right break-all">
            {{ formatActor(node.archivedBy) }}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground flex items-center gap-2">
            <IconHash />
            Node ID
          </dt>
          <dd class="text-right break-all">{{ node.id }}</dd>
        </div>
      </dl>
    </OverlayScrollbarsWrapper>
  </div>
</template>
