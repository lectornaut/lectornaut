<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import {
  useIntegrationsRegistry,
  type RegistryItem,
} from "@/composables/useIntegrationsRegistry"
import {
  IconAlertTriangle,
  IconBot,
  IconCirclePlus,
  IconTrash,
  IconWorkflow,
  IconWrench,
} from "@/data/icons"
import { ref } from "vue"

/**
 * SettingsIntegrations — the team's pre-built catalog. Owners/admins ADD or
 * REMOVE predefined agents, tools, and workflows from the team's active list.
 * This is install/uninstall (catalog membership), a SEPARATE axis from
 * enable/disable: an item's on/off lives on its own settings page (Agents /
 * Tools / Workflows); this page only controls whether it's in the list.
 *
 * All three building blocks are presented through one facade
 * (`useIntegrationsRegistry`), which composes their two separate read-models —
 * agents + tools (catalog overlay, opt-out) and workflows (materialized,
 * opt-in) — and routes the install/uninstall verbs per type. This page is
 * STORAGE-AGNOSTIC: it never learns that workflows live in a different
 * collection. For workflows, "installed" means the team has made the preset
 * AVAILABLE; per-workspace enable/configure lives on the Workflows settings
 * page — a separate axis, like agents'/tools' enable/disable.
 *
 * Owner/admin only: members who can view settings but can't manage see an
 * admin wall (mirrors SettingsSecurity); guests get `SettingsRestricted`.
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

const { canManage, agents, tools, workflows, toggleInstalled } =
  useIntegrationsRegistry()

// ── Per-row in-flight lockout ──────────────────────────────────────────────
// Reassign the Set (don't mutate) so the reactive read in `:disabled` re-runs,
// matching the SettingsWorkflows pattern. Keyed by `${type}:${key}` so the
// three sections never collide.
const pending = ref<Set<string>>(new Set())
const rowId = (item: RegistryItem): string => `${item.type}:${item.key}`
const isPending = (item: RegistryItem): boolean =>
  pending.value.has(rowId(item))

const toggle = async (item: RegistryItem): Promise<void> => {
  const id = rowId(item)
  if (pending.value.has(id)) return
  pending.value = new Set(pending.value).add(id)
  try {
    await toggleInstalled(item)
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <!-- Admin wall: viewable by members, manageable only by owner/admin. -->
    <Empty v-if="!canManage" class="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconAlertTriangle />
        </EmptyMedia>
        <EmptyTitle>
          {{ t("settings.integrations.noPermissionTitle") }}
        </EmptyTitle>
        <EmptyDescription>
          {{ t("settings.integrations.noPermissionDescription") }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>

    <FieldGroup v-else>
      <!-- ── Agents ──────────────────────────────────────────────────── -->
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{
              t("settings.integrations.agents.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.integrations.agents.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field v-for="item in agents" :key="item.key" orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ item.name }}</FieldLabel>
            <FieldDescription>{{ item.description }}</FieldDescription>
          </FieldContent>
          <Button
            :variant="item.installed ? 'outline' : 'default'"
            size="sm"
            :disabled="isPending(item)"
            @click="toggle(item)"
          >
            <component :is="item.installed ? IconTrash : IconCirclePlus" />
            {{
              item.installed
                ? t("settings.integrations.remove")
                : t("settings.integrations.add")
            }}
          </Button>
        </Field>

        <Empty v-if="agents.length === 0" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconBot />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("settings.integrations.agents.empty") }}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      </FieldSet>

      <FieldSeparator />

      <!-- ── Tools ───────────────────────────────────────────────────── -->
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{
              t("settings.integrations.tools.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.integrations.tools.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field v-for="item in tools" :key="item.key" orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ item.name }}</FieldLabel>
            <FieldDescription>{{ item.description }}</FieldDescription>
          </FieldContent>
          <Button
            :variant="item.installed ? 'outline' : 'default'"
            size="sm"
            :disabled="isPending(item)"
            @click="toggle(item)"
          >
            <component :is="item.installed ? IconTrash : IconCirclePlus" />
            {{
              item.installed
                ? t("settings.integrations.remove")
                : t("settings.integrations.add")
            }}
          </Button>
        </Field>

        <Empty v-if="tools.length === 0" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconWrench />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("settings.integrations.tools.empty") }}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      </FieldSet>

      <FieldSeparator />

      <!-- ── Workflows (team availability; per-workspace enable is separate) -->
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.integrations.workflows.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.integrations.workflows.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field
          v-for="item in workflows"
          :key="item.key"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel>{{ item.name }}</FieldLabel>
            <FieldDescription>{{ item.description }}</FieldDescription>
          </FieldContent>
          <Button
            :variant="item.installed ? 'outline' : 'default'"
            size="sm"
            :disabled="isPending(item)"
            @click="toggle(item)"
          >
            <component :is="item.installed ? IconTrash : IconCirclePlus" />
            {{
              item.installed
                ? t("settings.integrations.remove")
                : t("settings.integrations.add")
            }}
          </Button>
        </Field>

        <Empty v-if="workflows.length === 0" class="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconWorkflow />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("settings.integrations.workflows.empty") }}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      </FieldSet>
    </FieldGroup>
  </div>
  <SettingsRestricted v-else />
</template>
