<script setup lang="ts">
const selectedFruit = ref<string | null>("apple")
const accounts = [
  {
    name: "Apple",
    id: "apple",
    avatar: "https://github.com/apple.png",
  },
  {
    name: "Microsoft",
    id: "microsoft",
    avatar: "https://github.com/microsoft.png",
  },
  {
    name: "Google",
    id: "google",
    avatar: "https://github.com/google.png",
  },
]
const leftSidebarVisibility = useStorage("leftSidebarVisibility", true)
</script>

<template>
  <div>
    <div data-tauri-drag-region class="flex justify-end px-3 py-2">
      <Button variant="ghost" size="xs" @click="leftSidebarVisibility = false">
        <icon-lucide-chevrons-left />
      </Button>
    </div>
    <div class="px-3">
      <Select v-model="selectedFruit">
        <SelectTrigger size="sm">
          <SelectValue placeholder="Select a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="account in accounts"
            :key="account.id"
            :value="account.id"
          >
            <div class="flex items-center gap-2">
              <Avatar class="h-4 w-4">
                <AvatarImage :src="account.avatar" :alt="account.name" />
                <AvatarFallback>{{ account.name }}</AvatarFallback>
              </Avatar>
              <span>{{ account.name }}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
