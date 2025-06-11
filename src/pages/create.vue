<script setup lang="ts">
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

const model = ref("gpt-3.5-turbo")
</script>

<template>
  <div class="flex grow gap-2 overflow-auto overscroll-none p-2">
    <div
      class="bg-card flex grow basis-2/5 flex-col overflow-auto overscroll-none rounded border"
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
            <Select id="model" v-model="model">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>OpenAI</SelectLabel>
                  <SelectItem value="gpt-3.5-turbo">gpt-3.5-turbo</SelectItem>
                  <SelectItem value="gpt-4">gpt-4</SelectItem>
                  <SelectItem value="gpt-4-1106-preview"
                    >gpt-4-1106-preview</SelectItem
                  >
                  <SelectItem value="gpt-4-vision-preview"
                    >gpt-4-vision-preview</SelectItem
                  >
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Meta</SelectLabel>
                  <SelectItem value="Meta Llama 3.1">Meta Llama 3.1</SelectItem>
                  <SelectItem value="Meta Llama 3">Meta Llama 3</SelectItem>
                  <SelectItem value="Meta Llama 2">Meta Llama 2</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Anthropic</SelectLabel>
                  <SelectItem value="claude-2">claude-2</SelectItem>
                  <SelectItem value="claude-3">claude-3</SelectItem>
                  <SelectItem value="claude-3-opus">claude-3-opus</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Google</SelectLabel>
                  <SelectItem value="gemini-1.5-flash"
                    >gemini-1.5-flash</SelectItem
                  >
                  <SelectItem value="gemini-1.5-pro">gemini-1.5-pro</SelectItem>
                  <SelectItem value="gemini-1.5-ultra"
                    >gemini-1.5-ultra</SelectItem
                  >
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Other</SelectLabel>
                  <SelectItem value="mistral-7b-instruct"
                    >mistral-7b-instruct</SelectItem
                  >
                  <SelectItem value="mistral-7b">mistral-7b</SelectItem>
                  <SelectItem value="mistral-large">mistral-large</SelectItem>
                  <SelectItem value="mistral-small">mistral-small</SelectItem>
                  <SelectItem value="mistral-medium">mistral-medium</SelectItem>
                  <SelectItem value="mistral-7b-v0.1"
                    >mistral-7b-v0.1</SelectItem
                  >
                </SelectGroup>
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
      class="bg-secondary flex grow basis-3/5 flex-col overflow-auto overscroll-none rounded border"
    >
      <OverlayScrollbarsWrapper>
        <div class="grid grid-cols-1 gap-4 p-2"></div>
      </OverlayScrollbarsWrapper>
    </div>
  </div>
</template>
