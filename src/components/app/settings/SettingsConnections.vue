<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useConnections } from "@/composables/useConnections"
import { IconInfo } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import type { ConnectionProvider } from "@lectornaut/shared/domain"
import { ref } from "vue"

/**
 * SettingsConnections — installable apps backed by external accounts
 * (docs/connections-feature.prompt.md). Moved out of SettingsIntegrations:
 * connections are credentialed third-party links, not catalog membership,
 * and unlike that page this one is NOT admin-walled — linking an account is
 * a MEMBER action. Only the Install/Uninstall app buttons are admin-gated
 * (disabled with a tooltip, mirroring SettingsTools' "New tool" CTA).
 *
 * Layout: an `ItemGroup` grid of app cards — provider logo in `ItemMedia`,
 * copy in `ItemContent`, the info + admin install/uninstall actions in
 * `ItemActions`, and (while installed) the signed-in member's own account
 * link in a full-width `ItemFooter` (status + Connect / Reconnect /
 * Disconnect).
 *
 * The info button opens `SettingsConnectionInfo` (mounted below,
 * page-scoped) via the `Dialog.ConnectionInfo.Open` mitt event — tabs for
 * the app's tools/permissions, the connected-accounts roster, and the
 * Owner/Admin settings tab carrying the team-wide kill switch. While that
 * switch is OFF (`row.disabled`) the card shows a Disabled badge and the
 * member footer swaps Connect/Reconnect for an explanatory line — only
 * Disconnect stays (members can always pull their own credentials).
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

const connections = useConnections()
// Top-level refs so the template auto-unwraps them (nested refs on a plain
// object aren't unwrapped in templates).
const connectionRows = connections.rows
const canManage = connections.canManage

// ── Per-row in-flight lockout ──────────────────────────────────────────────
// Reassign the Set (don't mutate) so reactive `:disabled` reads re-run —
// same idiom as SettingsIntegrations. App actions (`app:*`) lock
// independently of binding actions; the two binding verbs get DISTINCT ids
// (`connect:*` / `disconnect:*`) so each button spins only for its own verb
// — in the scope-upgrade state Reconnect and Disconnect render side by side
// — while `isBindingPending` still mutually excludes them per provider.
const pending = ref<Set<string>>(new Set())
const isPendingId = (id: string): boolean => pending.value.has(id)

const appActionId = (provider: ConnectionProvider): string => `app:${provider}`
const connectActionId = (provider: ConnectionProvider): string =>
  `connect:${provider}`
const disconnectActionId = (provider: ConnectionProvider): string =>
  `disconnect:${provider}`
/** Either binding verb in flight — disables BOTH footer buttons. */
const isBindingPending = (provider: ConnectionProvider): boolean =>
  isPendingId(connectActionId(provider)) ||
  isPendingId(disconnectActionId(provider))

const runLocked = async (id: string, action: () => Promise<void>) => {
  if (pending.value.has(id)) return
  pending.value = new Set(pending.value).add(id)
  try {
    await action()
  } catch {
    // Toasted inside useConnections; the row just unlocks.
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}

// ── Destructive-action confirms ────────────────────────────────────────────
// Uninstall and disconnect revoke real Google grants (uninstall: EVERY
// member's binding on the team), so both detour through an AlertDialog.
// Controlled dialogs keyed by provider — not AlertDialogTrigger — because
// the app button is install/uninstall in one (only the uninstall arm
// confirms) and already sits in a tooltip `as-child` stack. The confirmed
// handlers take the provider from row scope rather than reading it back
// from the ref, so confirming can't race the dialog's own close.
const uninstallConfirmFor = ref<ConnectionProvider | null>(null)
const disconnectConfirmFor = ref<ConnectionProvider | null>(null)

const handleAppAction = (
  provider: ConnectionProvider,
  installed: boolean
): void => {
  if (installed) {
    uninstallConfirmFor.value = provider
    return
  }
  void runLocked(appActionId(provider), () => connections.install(provider))
}

const handleUninstallConfirmed = (
  provider: ConnectionProvider
): Promise<void> =>
  runLocked(appActionId(provider), () => connections.uninstall(provider))

// "connect" covers first link AND reconnect (needs_reauth / scope upgrade) —
// same popup flow; the server overwrites the binding. The promise spans the
// whole OAuth handoff (sign-in + consent in another window, then the server
// code exchange), so the lock — and the spinner it drives — can run a while.
const handleConnect = (provider: ConnectionProvider): void => {
  if (isBindingPending(provider)) return
  void runLocked(connectActionId(provider), () => connections.connect(provider))
}

const handleDisconnectConfirmed = (provider: ConnectionProvider): void => {
  if (isBindingPending(provider)) return
  void runLocked(disconnectActionId(provider), () =>
    connections.disconnect(provider)
  )
}

const openInfoDialog = (provider: ConnectionProvider): void => {
  emitter.emit("Dialog.ConnectionInfo.Open", { provider })
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.connections.label") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.connections.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>

        <ItemGroup
          class="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3"
        >
          <template v-for="row in connectionRows" :key="row.app.provider">
            <Item variant="outline">
              <ItemMedia variant="icon">
                <component :is="row.app.logo" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle class="flex items-center gap-1.5">
                  {{ row.app.name }}
                  <!-- Kill switch is on — agents lose the app's tools and new
                     connects are rejected until an admin re-enables it. -->
                  <Badge v-if="row.disabled" variant="outline">
                    {{ t("settings.connections.disabledBadge") }}
                  </Badge>
                </ItemTitle>
                <ItemDescription>{{ row.app.description }}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        :aria-label="t('settings.connections.infoButton')"
                        @click="openInfoDialog(row.app.provider)"
                      >
                        <IconInfo />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("settings.connections.infoButton") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <span class="inline-block">
                        <Button
                          :variant="row.installed ? 'outline' : 'default'"
                          size="sm"
                          :disabled="
                            !canManage ||
                            isPendingId(appActionId(row.app.provider))
                          "
                          @click="
                            handleAppAction(row.app.provider, row.installed)
                          "
                        >
                          <Spinner
                            v-if="isPendingId(appActionId(row.app.provider))"
                          />
                          {{
                            row.installed
                              ? t("settings.connections.uninstallApp")
                              : t("settings.connections.installApp")
                          }}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent v-if="!canManage">
                      {{ t("settings.connections.permissionRequired") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ItemActions>
              <!-- The signed-in member's own account link (member action,
                 deliberately NOT admin-gated). -->
              <ItemFooter
                v-if="row.installed"
                class="bg-secondary rounded-2xl p-4"
              >
                <div class="flex flex-col">
                  <span class="text-sm">
                    <!-- The OAuth handoff runs in another window (GIS popup /
                       system browser) and only settles once the user finishes
                       consenting — say so instead of a stale "isn't
                       connected" while the button spinner runs. -->
                    <template
                      v-if="isPendingId(connectActionId(row.app.provider))"
                    >
                      {{ t("settings.connections.connecting") }}
                    </template>
                    <!-- Disabled leads: any Connect the other states would
                       offer is rejected server-side anyway. -->
                    <template v-else-if="row.disabled">
                      {{ t("settings.connections.disabledByAdmin") }}
                    </template>
                    <template v-else-if="!row.myBinding">
                      {{ t("settings.connections.notConnected") }}
                    </template>
                    <template
                      v-else-if="row.myBinding.status === 'needs_reauth'"
                    >
                      {{ t("settings.connections.needsReauth") }}
                    </template>
                    <template v-else-if="row.myBinding.email">
                      {{
                        t("settings.connections.connectedAs", {
                          email: row.myBinding.email,
                        })
                      }}
                    </template>
                    <template v-else>
                      {{ t("settings.connections.connected") }}
                    </template>
                  </span>
                  <span class="text-muted-foreground text-sm">
                    {{
                      t(
                        "settings.connections.membersConnected",
                        row.bindingCount
                      )
                    }}
                  </span>
                  <!-- Connected under an older, narrower grant (e.g. a P1
                     read-only Google Calendar binding after the P2 write
                     upgrade) — only a fresh consent popup can widen it. -->
                  <span
                    v-if="
                      row.needsScopeUpgrade &&
                      !row.disabled &&
                      !isPendingId(connectActionId(row.app.provider))
                    "
                    class="text-muted-foreground text-sm"
                  >
                    {{ t("settings.connections.scopeUpgradeHint") }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <!-- No Connect/Reconnect while disabled — the server rejects
                     new grants, so don't pose a doomed consent popup. -->
                  <Button
                    v-if="
                      !row.disabled &&
                      (!row.myBinding ||
                        row.myBinding.status === 'needs_reauth' ||
                        row.needsScopeUpgrade)
                    "
                    variant="outline"
                    size="sm"
                    :disabled="isBindingPending(row.app.provider)"
                    @click="handleConnect(row.app.provider)"
                  >
                    <Spinner
                      v-if="isPendingId(connectActionId(row.app.provider))"
                    />
                    {{
                      row.myBinding
                        ? t("settings.connections.reconnect")
                        : t("settings.connections.connect")
                    }}
                  </Button>
                  <!-- Disconnect stays available in EVERY state while a binding
                     exists (incl. disabled / needs_reauth): pulling your own
                     credentials must never be harder than granting them. -->
                  <Button
                    v-if="
                      row.myBinding &&
                      (row.disabled || row.myBinding.status !== 'needs_reauth')
                    "
                    variant="outline"
                    size="sm"
                    :disabled="isBindingPending(row.app.provider)"
                    @click="disconnectConfirmFor = row.app.provider"
                  >
                    <Spinner
                      v-if="isPendingId(disconnectActionId(row.app.provider))"
                    />
                    {{ t("settings.connections.disconnect") }}
                  </Button>
                </div>
              </ItemFooter>
            </Item>

            <!-- Confirm dialogs for the two grant-revoking actions. Item
               siblings inside the v-for so title/body/action all read the
               row directly; AlertDialog renders no element of its own, so
               the ItemGroup grid is unaffected. -->
            <AlertDialog
              :open="uninstallConfirmFor === row.app.provider"
              @update:open="
                (open) => {
                  if (!open) uninstallConfirmFor = null
                }
              "
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t("settings.connections.uninstallConfirmTitle") }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{
                      t("settings.connections.uninstallConfirmBody", {
                        name: row.app.name,
                      })
                    }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {{ t("actions.cancel") }}<Kbd aria-hidden="true">Esc</Kbd>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    @click="handleUninstallConfirmed(row.app.provider)"
                  >
                    {{ t("settings.connections.uninstallApp") }}
                    <Kbd aria-hidden="true">↩</Kbd>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
              :open="disconnectConfirmFor === row.app.provider"
              @update:open="
                (open) => {
                  if (!open) disconnectConfirmFor = null
                }
              "
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t("settings.connections.disconnectConfirmTitle") }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{
                      t("settings.connections.disconnectConfirmBody", {
                        name: row.app.name,
                      })
                    }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {{ t("actions.cancel") }}<Kbd aria-hidden="true">Esc</Kbd>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    @click="handleDisconnectConfirmed(row.app.provider)"
                  >
                    {{ t("settings.connections.disconnect") }}
                    <Kbd aria-hidden="true">↩</Kbd>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </template>
        </ItemGroup>
      </FieldSet>
    </FieldGroup>

    <!-- Page-scoped on purpose (vs the layout-mounted SettingsCustomTools):
         only this page opens it, and scoping keeps useConnections' listeners
         + GIS preload off every unrelated session. -->
    <SettingsConnectionInfo />
  </div>
  <SettingsRestricted v-else />
</template>
