<script setup lang="ts">
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
      <Card class="shadow-none">
        <CardHeader class="p-4">
          <CardTitle
            class="flex items-center justify-between text-base font-medium"
          >
            <span class="truncate">My progress</span>
            <Badge variant="secondary" class="gap-2 p-1 pl-2">
              <span class="truncate"> Skip </span>
              <icon-mdi-arrow-right-circle />
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent class="px-4 pb-4">
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
        </CardContent>
      </Card>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
