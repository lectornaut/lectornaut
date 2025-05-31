<template>
  <div class="m-2 flex grow overflow-hidden overscroll-none rounded-md border">
    <FlowSidebar />
    <Separator orientation="vertical" />
    <div class="flex grow flex-col overflow-auto overscroll-none">
      <main
        class="bg-background flex grow flex-col overflow-auto overscroll-none"
      >
        <RouterView />
      </main>
    </div>
  </div>
</template>
