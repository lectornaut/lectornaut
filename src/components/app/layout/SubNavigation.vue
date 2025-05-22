<script setup lang="ts">
const active = ref(true)
const running = refAutoReset(false, 5000)
</script>

<template>
  <div class="bg-sidebar flex items-center justify-between gap-2 p-2">
    <div class="flex gap-2">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink as-child>
              <Button variant="ghost" as-child>
                <RouterLink to="/exit" class="gap-2">
                  <span class="truncate">Exit</span>
                </RouterLink>
              </Button>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage as-child>
              <BreadcrumbLink as-child>
                <Button variant="ghost" as-child>
                  <RouterLink to="/welcome" class="gap-2">
                    <span class="truncate">Breadcrumb</span>
                    <Badge
                      variant="secondary"
                      class="gap-1 py-1 pr-2.5 pl-2"
                      :class="
                        running
                          ? 'border-sky-500 bg-sky-500/10 text-sky-600'
                          : active
                            ? 'border-green-500 bg-green-500/10 text-green-600'
                            : 'border-amber-500 bg-amber-500/10 text-amber-600'
                      "
                    >
                      <icon-lucide-loader-circle
                        v-if="running"
                        class="animate-spin"
                      />
                      <span
                        v-else
                        class="relative flex size-4 items-center justify-center"
                      >
                        <span
                          class="absolute inline-flex size-2 rounded-full opacity-75"
                          :class="
                            active
                              ? 'animate-ping bg-green-400'
                              : 'bg-amber-400'
                          "
                        ></span>
                        <span
                          class="relative inline-flex size-2 rounded-full"
                          :class="active ? 'bg-green-500' : 'bg-amber-500'"
                        ></span>
                      </span>
                      <span class="truncate leading-normal">
                        {{ running ? "Running" : active ? "Live" : "Paused" }}
                      </span>
                    </Badge>
                  </RouterLink>
                </Button>
              </BreadcrumbLink>
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
    <div class="flex gap-2">
      <Button class="gap-2" variant="ghost" as-child>
        <Label for="active">
          <Switch id="active" v-model="active" />
          <span class="truncate">Enabled</span>
        </Label>
      </Button>
      <Button
        :disabled="running"
        class="gap-2"
        variant="outline"
        @click="running = !running"
      >
        <icon-lucide-play />
        <span class="truncate"> Run </span>
      </Button>
      <Button class="gap-2">
        <icon-lucide-check-check />
        <span class="truncate">Publish</span>
      </Button>
    </div>
  </div>
</template>
