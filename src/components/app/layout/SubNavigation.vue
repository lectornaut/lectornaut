<template>
  <div class="bg-background flex items-center justify-between gap-2 p-2">
    <!-- <Breadcrumb>
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
                </RouterLink>
              </Button>
            </BreadcrumbLink>
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb> -->
    <div class="flex gap-2">
      <Button class="gap-3" variant="ghost">
        <span class="relative flex size-2">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/75"
          ></span>
          <span
            class="relative inline-flex size-2 rounded-full bg-green-500"
          ></span>
        </span>
        <span class="truncate">Active</span>
      </Button>
      <Button class="gap-2" variant="ghost">
        <Switch />
        <span class="truncate">Draft</span>
      </Button>
    </div>
    <div class="flex gap-2">
      <Button class="gap-2" variant="outline">
        <icon-lucide-play />
        <span class="truncate">Run</span>
      </Button>
      <Button class="gap-2">
        <icon-lucide-check-check />
        <span class="truncate">Publish</span>
      </Button>
    </div>
  </div>
</template>
