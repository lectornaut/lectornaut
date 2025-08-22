<script setup lang="ts">
import { getFunctions, httpsCallable } from "firebase/functions"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Create",
    breadcrumb: "Create",
  },
})

useHead({
  title: "Create",
})

const temperature = ref([0.5])
const maxLength = ref([1000])
const topP = ref([0.9])

const selectedModel = ref()
const modelGroups = [
  {
    label: "OpenAI",
    models: [
      { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
      { value: "gpt-4", label: "GPT-4" },
      { value: "gpt-4-1106-preview", label: "GPT-4 1106 Preview" },
    ],
  },
  {
    label: "Anthropic",
    models: [
      { value: "claude-2", label: "Claude 2" },
      { value: "claude-3", label: "Claude 3" },
      { value: "claude-instant-100k", label: "Claude Instant 100k" },
    ],
  },
  {
    label: "Google",
    models: [
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    ],
  },
  {
    label: "Mistral",
    models: [
      { value: "mistral-7b", label: "Mistral 7B" },
      { value: "mistral-large", label: "Mistral Large" },
      { value: "mixtral-8x7b", label: "Mixtral 8x7B" },
    ],
  },
  {
    label: "Meta",
    models: [
      { value: "llama-3-8b", label: "Llama 3 8B" },
      { value: "llama-3-70b", label: "Llama 3 70B" },
      { value: "llama-3-8b-instruct", label: "Llama 3 8B Instruct" },
      { value: "llama-3-70b-instruct", label: "Llama 3 70B Instruct" },
    ],
  },
]

const subject = ref("")
const poem = ref("")

const generatePoem = async () => {
  const poemFlow = httpsCallable(getFunctions(), "generateFlow")
  const response = await poemFlow.stream(subject.value)
  for await (const chunk of response.stream) {
    poem.value += chunk
  }
}
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
  <div class="flex grow gap-2 overflow-auto overscroll-none p-2">
    <div
      class="bg-card flex grow basis-2/5 flex-col overflow-auto overscroll-none rounded-md border"
    >
      <OverlayScrollbarsWrapper>
        <div class="grid grid-cols-1 gap-4 p-2">
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="agent">
              Avatar
            </Label>
            <div class="flex items-center justify-center">
              <Avatar class="size-16">
                <AvatarImage
                  :src="`https://avatar.vercel.sh/agent.png`"
                  alt="Agent"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback> AG </AvatarFallback>
              </Avatar>
            </div>
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="name">
              Name
            </Label>
            <Input id="name" type="text" placeholder="Enter a name" />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="description"
              >Description</Label
            >
            <Textarea
              id="description"
              placeholder="Enter a description"
              rows="3"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="prompt"
              >Prompt</Label
            >
            <Textarea id="prompt" placeholder="Enter a prompt" rows="15" />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="model">
              Model
            </Label>
            <Select id="model" v-model="selectedModel">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <template
                  v-for="(group, index) in modelGroups"
                  :key="group.label"
                >
                  <SelectGroup>
                    <SelectLabel class="text-muted-foreground">
                      {{ group.label }}
                    </SelectLabel>
                    <SelectItem
                      v-for="model in group.models"
                      :key="model.value"
                      :value="model.value"
                    >
                      {{ model.label }}
                    </SelectItem>
                  </SelectGroup>
                  <SelectSeparator v-if="index < modelGroups.length - 1" />
                </template>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="temperature"
              >Temperature</Label
            >
            <Slider
              id="temperature"
              v-model="temperature"
              :max="1"
              :step="0.1"
              class="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
              aria-label="Temperature"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="maxlength"
              >Maximum Length</Label
            >
            <Slider
              id="maxlength"
              v-model="maxLength"
              :max="4000"
              :step="10"
              class="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
              aria-label="Maximum Length"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-secondary-foreground text-xs" for="top-p"
              >Top P</Label
            >
            <Slider
              id="top-p"
              v-model="topP"
              :max="1"
              :step="0.1"
              class="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4"
              aria-label="Top P"
            />
          </div>
        </div>
      </OverlayScrollbarsWrapper>
    </div>
    <div
      class="bg-card flex grow basis-3/5 flex-col overflow-auto overscroll-none rounded-md border"
    >
      <OverlayScrollbarsWrapper>
        <div class="grid grid-cols-1 gap-4 p-2">
          <Input v-model="subject" placeholder="Subject" />
          <Button @click="generatePoem()">Compose</Button>
          <p class="rounded-md border p-2">
            {{ poem ? poem : "Your poem will appear here." }}
          </p>
        </div>
      </OverlayScrollbarsWrapper>
    </div>
  </div>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>
