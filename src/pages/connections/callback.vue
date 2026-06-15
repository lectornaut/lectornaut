<script lang="ts" setup>
import { IconCheckCircle } from "@/data/icons"

/**
 * OAuth redirect callback for the generic connection flow (non-Google
 * providers like GitHub). The provider redirects the popup here with
 * `?code&state` (or `?error`); this page is a same-origin RELAY — it
 * postMessages the one-time code to the opener (Settings → Connections, still
 * mounted, holding the CSRF nonce) and closes. The code is exchanged
 * server-side by the opener's `completeConnectionBinding` call; no token ever
 * touches this page.
 */

const { t } = useI18n()

// Must match `CONNECTION_OAUTH_MESSAGE` in useConnections — namespaced so a
// sign-in popup's token message can't be consumed by the connection listener.
const MESSAGE_TYPE = "connection_oauth"

definePage({
  // Transient relay page — no chrome, public (the opener holds the session).
  meta: {
    layout: false,
  },
})

const noOpener = ref(false)

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get("code")
  const state = params.get("state")
  // GitHub denial → ?error=access_denied&error_description=…
  const error =
    params.get("error_description") || params.get("error") || undefined

  if (window.opener) {
    window.opener.postMessage(
      { type: MESSAGE_TYPE, code, state, error },
      window.location.origin
    )
    window.close()
  } else {
    // Opened outside the popup flow — nothing to relay.
    noOpener.value = true
  }
})
</script>

<template>
  <div class="bg-background grid size-full grow place-items-center">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconCheckCircle />
        </EmptyMedia>
        <EmptyTitle>{{ t("pages.connectionCallback.title") }}</EmptyTitle>
        <EmptyDescription>
          {{
            noOpener
              ? t("pages.connectionCallback.noOpener")
              : t("pages.connectionCallback.description")
          }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
</template>
