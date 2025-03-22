<script lang="ts" setup>
const steps = [
  { name: "Create a workflow", status: "complete" },
  { name: "Add a node", status: "complete" },
  { name: "Run a workflow", status: "current" },
  { name: "Publish an automation", status: "upcoming" },
]
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <nav class="flex flex-col gap-4 rounded-md border p-4">
        <Label
          class="text-secondary-foreground flex items-center justify-between"
        >
          <span class="truncate"> Progress </span>
          <Badge variant="secondary" class="gap-2 p-1 pl-2">
            <span class="truncate"> Skip </span>
            <icon-mdi-arrow-right-circle />
          </Badge>
        </Label>
        <ol role="list" class="grid gap-3">
          <li v-for="step in steps" :key="step.name">
            <div class="flex items-center gap-3">
              <icon-mdi-circle-medium
                v-if="step.status === 'complete'"
                class="text-green-500"
              />
              <icon-mdi-circle-medium
                v-else-if="step.status === 'current'"
                class="text-amber-500"
              />
              <icon-mdi-circle-small v-else class="text-muted-foreground" />
              <span
                class="truncate"
                :class="
                  step.status === 'complete'
                    ? 'text-muted-foreground'
                    : 'text-secondary-foreground'
                "
              >
                {{ step.name }}
              </span>
            </div>
          </li>
        </ol>
      </nav>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
