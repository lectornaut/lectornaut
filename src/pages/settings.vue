<script lang="ts" setup>
import SettingsContent from "@/components/app/settings/SettingsContent.vue"
import {
  hashFromTab,
  normalizeSettingsTab,
  tabFromHash,
} from "@/helpers/settingsTabs"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Settings",
    breadcrumb: "Settings",
  },
})

useHead({
  title: "Settings",
})

const route = useRoute()
const router = useRouter()
const activeTab = ref(tabFromHash(route.hash))

watch(
  () => route.hash,
  (hash) => {
    const tabFromRoute = tabFromHash(hash)
    if (activeTab.value !== tabFromRoute) {
      activeTab.value = tabFromRoute
    }

    const canonicalHash = hashFromTab(tabFromRoute)
    if (hash !== canonicalHash) {
      void router.replace({
        path: route.path,
        query: route.query,
        hash: canonicalHash,
      })
    }
  },
  { immediate: true }
)

watch(activeTab, (tab) => {
  const normalizedTab = normalizeSettingsTab(tab)
  if (tab !== normalizedTab) {
    activeTab.value = normalizedTab
    return
  }

  const canonicalHash = hashFromTab(normalizedTab)
  if (route.hash !== canonicalHash) {
    void router.replace({
      path: route.path,
      query: route.query,
      hash: canonicalHash,
    })
  }
})
</script>

<template>
  <div class="h-full p-2">
    <div class="bg-background h-full overflow-hidden rounded-lg border">
      <SettingsContent v-model:active-tab="activeTab" mode="page" />
    </div>
  </div>
</template>
