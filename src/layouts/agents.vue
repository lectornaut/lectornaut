<template>
  <div
    class="m-2 flex grow overflow-auto overscroll-none scroll-smooth rounded-md border"
  >
    <FlowSidebar />
    <Separator orientation="vertical" />
    <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
      <main
        class="bg-background flex grow flex-col overflow-auto overscroll-none scroll-smooth"
      >
        <RouterView />
      </main>
    </div>
  </div>
</template>
