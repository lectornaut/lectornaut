<template>
  <div class="flex items-center justify-between gap-2 p-2">
    <div class="flex gap-2">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink as-child>
              <Button variant="ghost" as-child>
                <RouterLink to="/exit">
                  <span>Exit</span>
                </RouterLink>
              </Button>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage as-child>
              <BreadcrumbLink as-child>
                <Button variant="ghost" as-child>
                  <RouterLink to="/welcome">
                    <span>Breadcrumb</span>
                  </RouterLink>
                </Button>
              </BreadcrumbLink>
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
    <div class="flex gap-2">
      <Button variant="outline">
        <icon-lucide-play />
        <span>Run</span>
      </Button>
      <Button>
        <icon-lucide-check-check />
        <span>Publish</span>
      </Button>
    </div>
  </div>
</template>
