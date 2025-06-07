<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <div class="flex items-center justify-between gap-2 p-2">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage as-child>
            <BreadcrumbLink as-child>
              <RouterLink to="/home"> Home </RouterLink>
            </BreadcrumbLink>
          </BreadcrumbPage>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>
            {{ route.meta.title }}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    <div class="flex gap-2">
      <Button variant="outline">
        <icon-lucide-play />
        Run
      </Button>
      <Button>
        <icon-lucide-check-check />
        Publish
      </Button>
    </div>
  </div>
</template>
