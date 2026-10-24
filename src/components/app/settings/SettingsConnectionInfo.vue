<script lang="ts" setup>
import { useConnections } from "@/composables/useConnections"
import type { ConnectionAppDescriptor } from "@/data/connectionApps"
import {
  IconBot,
  IconExternalLink,
  IconShieldCheck,
  IconTrash,
  IconUnlink,
  IconWorkflow,
  IconWrench,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import type { IConnectionBinding } from "@/schemas/connections"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { isAgentMembership } from "@/types/membership"
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  type ConnectionProvider,
} from "@lectornaut/shared/domain"
import { storeToRefs } from "pinia"
import { onBeforeUnmount, onMounted } from "vue"

/**
 * Connection app info dialog — details and account/app management for one
 * installable connection app. Patterned on
 * `SettingsCustomTools.vue`'s dialog (mitt-opened, Tabs inside
 * DialogContent), but mounted INSIDE `SettingsConnections.vue` rather than
 * the app layout: this dialog is only openable from that page, and
 * page-scoping keeps the connection/binding listeners and the GIS preload
 * inside `useConnections` from running for every session. The second
 * `useConnections()` instance is cheap — the underlying reads dedupe in the
 * query cache and the GIS load is module-memoized.
 *
 * Tabs:
 *   - **Overview** — what the app does, the tools it contributes
 *     (locale-keyed off the shared tool keys), and the OAuth scopes a
 *     member grants on connect.
 *   - **Accounts** — every member binding (metadata only): avatar + name
 *     from the membership roster, link status, and the bound email for
 *     yourself (admins see all emails — same data their console role
 *     already implies). Members can disconnect or manage their own account.
 *   - **Settings** — Owner/Admin only: install provenance and the
 *     uninstall and "Enabled for the team" kill switch. The switch applies immediately
 *     (no unsaved bar — toggles are immediate everywhere in Settings);
 *     `pendingDisabled` holds the intended value for instant Switch
 *     feedback because `setDisabled` isn't optimistic, and reverts on
 *     failure. Positive polarity (ON = active) so it reads like every
 *     other Switch on these pages; the SERVER state is `status:
 *     "disabled"`.
 *
 * Opened via the `Dialog.ConnectionInfo.Open` mitt event with
 * `{ provider }` (same channel idiom as `Dialog.CustomTools.Open`).
 */

const { t } = useI18n()
const props = defineProps<{
  pendingProviders?: ConnectionProvider[]
  updatingProviders?: ConnectionProvider[]
}>()
const emit = defineEmits<{
  update: [app: ConnectionAppDescriptor]
  uninstall: [app: ConnectionAppDescriptor]
  disconnect: [app: ConnectionAppDescriptor]
}>()

const connections = useConnections()
const connectionRows = connections.rows
const canManage = connections.canManage

const authStore = useAuthStore()
const { currentUser } = storeToRefs(authStore)

const membershipStore = useMembershipStore()
const { teamMembers } = storeToRefs(membershipStore)

// ── Dialog state ────────────────────────────────────────────────────────────

const open = ref(false)
const activeProvider = ref<ConnectionProvider | null>(null)
const activeTab = ref("overview")

const activeRow = computed(
  () =>
    connectionRows.value.find((r) => r.app.provider === activeProvider.value) ??
    null
)
const resourceSections = computed(() => {
  const resources = activeRow.value?.app.resources
  if (!resources) return []
  return [
    {
      type: "tools",
      icon: IconWrench,
      rows: resources.tools.map((r) => ({
        id: r.sourceKey,
        name: r.name,
        description: r.description,
      })),
    },
    {
      type: "agents",
      icon: IconBot,
      rows: resources.agents.map((r) => ({
        id: r.sourceKey,
        name: r.name,
        description: r.description,
      })),
    },
    {
      type: "workflows",
      icon: IconWorkflow,
      rows: resources.workflows.map((r) => ({
        id: r.key,
        name: r.name,
        description: r.description,
      })),
    },
  ].filter((section) => section.rows.length > 0)
})
const isPending = computed(
  () =>
    activeProvider.value !== null &&
    props.pendingProviders?.includes(activeProvider.value) === true
)

type OpenPayload = { provider?: ConnectionProvider } | undefined

const handleOpenEvent = (event: unknown): void => {
  const payload = event as OpenPayload
  if (!payload || typeof payload !== "object" || !payload.provider) return
  activeProvider.value = payload.provider
  // Reset to Overview on every open so a reopened dialog never lands on a
  // stale (possibly no-longer-visible) admin tab.
  activeTab.value = "overview"
  pendingDisabled.value = null
  open.value = true
}

onMounted(() => {
  emitter.on("Dialog.ConnectionInfo.Open", handleOpenEvent)
})
onBeforeUnmount(() => {
  emitter.off("Dialog.ConnectionInfo.Open", handleOpenEvent)
})

// ── Member display (accounts roster + provenance lines) ────────────────────

interface MemberDisplay {
  name: string
  photoURL: string | null
}

/** uid → display info from the membership roster (humans only — bindings
 * are OAuth grants, agents never hold one). */
const membersByUid = computed<Map<string, MemberDisplay>>(() => {
  const map = new Map<string, MemberDisplay>()
  for (const member of teamMembers.value) {
    if (isAgentMembership(member)) continue
    map.set(member.userId, {
      name:
        member.user?.displayName ||
        member.user?.email ||
        t("settings.connections.info.unknownMember"),
      photoURL: member.user?.photoURL ?? null,
    })
  }
  return map
})

const memberName = (uid: string | null | undefined): string =>
  (uid ? membersByUid.value.get(uid)?.name : undefined) ??
  t("settings.connections.info.unknownMember")

interface AccountRow {
  binding: IConnectionBinding
  name: string
  photoURL: string | null
  isSelf: boolean
  /** Bound email — own row always; every row for admins. */
  email: string | null
}

const accountRows = computed<AccountRow[]>(() => {
  const uid = currentUser.value?.uid ?? null
  const rows = (activeRow.value?.bindings ?? []).map((binding) => {
    const display = membersByUid.value.get(binding.id)
    const isSelf = binding.id === uid
    return {
      binding,
      name: display?.name ?? t("settings.connections.info.unknownMember"),
      photoURL: display?.photoURL ?? null,
      isSelf,
      email:
        (isSelf || canManage.value) && binding.email ? binding.email : null,
    }
  })
  // Self first, then alphabetical — the row you can act on leads.
  return rows.sort((a, b) =>
    a.isSelf !== b.isSelf
      ? Number(b.isSelf) - Number(a.isSelf)
      : a.name.localeCompare(b.name)
  )
})

const formatDate = (
  value: { toDate?: () => Date } | null | undefined
): string => {
  const date = value?.toDate?.()
  return date ? useDateFormat(date, "MMM D, YYYY").value : "—"
}

// ── Permissions (OAuth scopes → human copy) ─────────────────────────────────

/**
 * Locale suffix per known scope; unknown scopes fall back to the raw URL in
 * mono type — honest beats pretty for a permission surface.
 */
const SCOPE_LOCALE_SUFFIX: Record<string, string> = {
  openid: "identity",
  email: "email",
  [GOOGLE_CALENDAR_EVENTS_SCOPE]: "calendarEvents",
  [GOOGLE_DRIVE_READONLY_SCOPE]: "driveReadonly",
  [GOOGLE_DRIVE_FILE_SCOPE]: "driveFile",
  [GOOGLE_GMAIL_READONLY_SCOPE]: "gmailReadonly",
  [GOOGLE_GMAIL_SEND_SCOPE]: "gmailSend",
}

const scopeRows = computed(() =>
  (activeRow.value?.app.scopes ?? []).map((scope) => {
    const suffix = SCOPE_LOCALE_SUFFIX[scope]
    return {
      scope,
      label: suffix ? t(`settings.connections.info.scope.${suffix}`) : null,
    }
  })
)

// ── Kill switch (admin tab) ─────────────────────────────────────────────────

/**
 * Hold the intended value during the callable roundtrip (same idiom as
 * SettingsTools' `pendingCustomTools`) — the Switch snaps immediately and
 * reverts if the save fails.
 */
const pendingDisabled = ref<boolean | null>(null)
const isSettingDisabled = computed(() => pendingDisabled.value !== null)
const connectionEnabled = computed(() => {
  const row = activeRow.value
  if (!row) return false
  return !(pendingDisabled.value ?? row.disabled)
})

const handleToggleEnabled = async (enabled: boolean): Promise<void> => {
  const provider = activeProvider.value
  if (
    !provider ||
    !canManage.value ||
    isSettingDisabled.value ||
    isPending.value
  )
    return
  pendingDisabled.value = !enabled
  try {
    await connections.setDisabled(provider, !enabled)
  } catch {
    // Toasted inside useConnections; the Switch just reverts.
  } finally {
    pendingDisabled.value = null
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="grid max-h-[85svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl"
    >
      <template v-if="activeRow">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Component :is="activeRow.app.logo" class="size-5 shrink-0" />
            {{ activeRow.app.name }}
            <Badge v-if="activeRow.disabled" variant="outline">
              {{ t("settings.connections.disabledBadge") }}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {{ activeRow.app.description }}
          </DialogDescription>
        </DialogHeader>

        <Tabs v-model="activeTab" class="min-h-0">
          <TabsList class="bg-input/50 h-9! p-0">
            <TabsTrigger
              value="overview"
              class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
            >
              {{ t("settings.connections.info.tabOverview") }}
            </TabsTrigger>
            <TabsTrigger
              value="accounts"
              class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
            >
              {{
                t("settings.connections.info.tabAccounts", {
                  count: activeRow.bindingCount,
                })
              }}
            </TabsTrigger>
            <!-- Governance tab — install provenance + kill switch. -->
            <TabsTrigger
              v-if="canManage"
              value="settings"
              class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
            >
              {{ t("settings.connections.info.tabSettings") }}
            </TabsTrigger>
          </TabsList>

          <!-- ── Overview — contributed tools + permissions ─────────── -->
          <TabsContent value="overview" class="min-h-0">
            <ScrollContainer class="h-full">
              <!-- House roster idiom (Navigation.vue): a label legend over an
                 ItemGroup of outline xs Items, one row per resource/scope. -->
              <FieldGroup class="gap-6 py-1">
                <FieldSet
                  v-for="section in resourceSections"
                  :key="section.type"
                  class="gap-0"
                >
                  <FieldLegend variant="label">
                    {{ t(`settings.connections.info.${section.type}Title`) }}
                    <span
                      class="text-muted-foreground font-normal tabular-nums"
                    >
                      {{ section.rows.length }}
                    </span>
                  </FieldLegend>
                  <ItemGroup class="gap-2">
                    <Item
                      v-for="resource in section.rows"
                      :key="resource.id"
                      variant="outline"
                      size="xs"
                    >
                      <ItemMedia variant="icon" class="text-muted-foreground">
                        <Component :is="section.icon" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{{ resource.name }}</ItemTitle>
                        <ItemDescription>
                          {{ resource.description }}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  </ItemGroup>
                </FieldSet>

                <FieldSet class="gap-0">
                  <FieldLegend variant="label" class="mb-1">
                    {{ t("settings.connections.info.permissionsTitle") }}
                  </FieldLegend>
                  <FieldDescription class="mb-3">
                    {{ t("settings.connections.info.permissionsDescription") }}
                  </FieldDescription>
                  <ItemGroup class="gap-2">
                    <Item
                      v-for="row in scopeRows"
                      :key="row.scope"
                      variant="muted"
                      size="xs"
                    >
                      <ItemMedia variant="icon" class="text-muted-foreground">
                        <IconShieldCheck />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle v-if="row.label">{{ row.label }}</ItemTitle>
                        <!-- Unknown scope: raw URL, honest over pretty. -->
                        <ItemTitle v-else class="font-mono text-xs break-all">
                          {{ row.scope }}
                        </ItemTitle>
                      </ItemContent>
                    </Item>
                  </ItemGroup>
                </FieldSet>
              </FieldGroup>
            </ScrollContainer>
          </TabsContent>

          <!-- ── Accounts — every member binding (metadata only) ────── -->
          <TabsContent value="accounts" class="min-h-0">
            <ScrollContainer class="h-full">
              <div class="flex flex-col gap-2">
                <Empty
                  v-if="accountRows.length === 0"
                  class="border border-dashed"
                >
                  <EmptyHeader>
                    <EmptyTitle>
                      {{ t("settings.connections.info.accountsEmpty") }}
                    </EmptyTitle>
                  </EmptyHeader>
                </Empty>

                <Item
                  v-for="row in accountRows"
                  :key="row.binding.id"
                  variant="outline"
                >
                  <ItemMedia>
                    <AppAvatar :src="row.photoURL" :name="row.name" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {{ row.name }}
                      <span
                        v-if="row.isSelf"
                        class="text-muted-foreground font-normal"
                      >
                        {{ t("settings.connections.info.you") }}
                      </span>
                    </ItemTitle>
                    <ItemDescription v-if="row.email">
                      {{ row.email }}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge
                      :variant="
                        row.binding.status === 'needs_reauth'
                          ? 'destructive'
                          : 'secondary'
                      "
                    >
                      {{
                        t(
                          row.binding.status === "needs_reauth"
                            ? "settings.connections.info.statusNeedsReauth"
                            : "settings.connections.info.statusConnected"
                        )
                      }}
                    </Badge>
                  </ItemActions>
                  <ItemFooter v-if="row.isSelf && activeRow.installed">
                    <ButtonGroup>
                      <Button
                        v-if="activeRow.app.manage"
                        as="a"
                        :href="activeRow.app.manage.url"
                        variant="outline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <IconExternalLink data-icon="inline-start" />
                        {{ t(activeRow.app.manage.labelKey) }}
                      </Button>
                      <Button
                        variant="outline"
                        :disabled="isPending"
                        @click="emit('disconnect', activeRow.app)"
                      >
                        <Spinner v-if="isPending" data-icon="inline-start" />
                        <IconUnlink v-else data-icon="inline-start" />
                        {{ t("settings.connections.disconnect") }}
                      </Button>
                    </ButtonGroup>
                  </ItemFooter>
                </Item>
              </div>
            </ScrollContainer>
          </TabsContent>

          <!-- ── Settings (Owner/Admin) — provenance + kill switch ──── -->
          <TabsContent v-if="canManage" value="settings" class="min-h-0">
            <ScrollContainer class="h-full">
              <FieldGroup class="gap-4 py-1">
                <FieldSet v-if="activeRow.connection">
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>
                        {{ t("settings.connections.info.installedByLabel") }}
                      </FieldLabel>
                    </FieldContent>
                    <span class="text-muted-foreground text-sm">
                      {{ memberName(activeRow.connection.installedByUid) }}
                    </span>
                  </Field>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>
                        {{ t("settings.connections.info.installedOnLabel") }}
                      </FieldLabel>
                    </FieldContent>
                    <span class="text-muted-foreground text-sm">
                      {{ formatDate(activeRow.connection.createdAt) }}
                    </span>
                  </Field>

                  <FieldSeparator />

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>{{
                        t(
                          activeRow.updateAvailable
                            ? "settings.connectionResources.updateAvailable"
                            : "settings.connectionResources.upToDate"
                        )
                      }}</FieldLabel>
                      <FieldDescription>{{
                        t(
                          activeRow.updateAvailable
                            ? "settings.connectionResources.updateDescription"
                            : "settings.connectionResources.upToDateDescription"
                        )
                      }}</FieldDescription>
                    </FieldContent>
                    <Button
                      v-if="
                        activeRow.updateAvailable ||
                        props.updatingProviders?.includes(
                          activeRow.app.provider
                        )
                      "
                      variant="outline"
                      :disabled="isPending || isSettingDisabled"
                      @click="emit('update', activeRow.app)"
                    >
                      <Spinner
                        v-if="
                          props.updatingProviders?.includes(
                            activeRow.app.provider
                          )
                        "
                        data-icon="inline-start"
                      />
                      {{
                        t(
                          props.updatingProviders?.includes(
                            activeRow.app.provider
                          )
                            ? "settings.connectionResources.installingUpdates"
                            : "settings.connectionResources.installUpdates"
                        )
                      }}
                    </Button>
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel for="connection-enabled">
                        {{ t("settings.connections.info.enabledLabel") }}
                      </FieldLabel>
                      <FieldDescription>
                        {{ t("settings.connections.info.enabledDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="connection-enabled"
                      :model-value="connectionEnabled"
                      :disabled="!canManage || isSettingDisabled || isPending"
                      @update:model-value="
                        (v) => handleToggleEnabled(Boolean(v))
                      "
                    />
                  </Field>
                  <p
                    v-if="activeRow.disabled && activeRow.connection.disabledAt"
                    class="text-muted-foreground text-xs"
                  >
                    {{
                      t("settings.connections.info.disabledProvenance", {
                        name: memberName(activeRow.connection.disabledByUid),
                        date: formatDate(activeRow.connection.disabledAt),
                      })
                    }}
                  </p>
                  <FieldSeparator />
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel>{{
                        t("settings.connections.uninstallApp")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{
                          t("settings.connections.uninstallConfirmBody", {
                            name: activeRow.app.name,
                          })
                        }}
                      </FieldDescription>
                    </FieldContent>
                    <Button
                      variant="destructive"
                      :disabled="!canManage || isPending || isSettingDisabled"
                      @click="emit('uninstall', activeRow.app)"
                    >
                      <Spinner v-if="isPending" data-icon="inline-start" />
                      <IconTrash v-else data-icon="inline-start" />
                      {{ t("settings.connections.uninstallApp") }}
                    </Button>
                  </Field>
                </FieldSet>

                <!-- Uninstalled while the dialog sat open — nothing to govern. -->
                <Empty v-else class="border border-dashed">
                  <EmptyHeader>
                    <EmptyTitle>
                      {{ t("settings.connections.info.notInstalled") }}
                    </EmptyTitle>
                  </EmptyHeader>
                </Empty>
              </FieldGroup>
            </ScrollContainer>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">
              {{ t("common.close") }}
              <Kbd>Esc</Kbd>
            </Button>
          </DialogClose>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
