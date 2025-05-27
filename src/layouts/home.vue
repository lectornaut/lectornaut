<template>
  <div
    class="no-scrollbar m-2 flex grow overflow-hidden overscroll-none rounded-md border"
  >
    <FlowSidebar />
    <Separator orientation="vertical" />
    <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
      <main
        class="no-scrollbar bg-background flex grow flex-col overflow-auto overscroll-none"
      >
        <RouterView />
      </main>
    </div>
  </div>
</template>
