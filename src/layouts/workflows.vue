<template>
  <div
    class="no-scrollbar m-2 flex grow divide-x overflow-hidden overscroll-none rounded-md border"
  >
    <FlowSidebar />
    <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
      <main
        class="no-scrollbar bg-background flex grow flex-col overflow-auto overscroll-none"
      >
        <RouterView />
      </main>
    </div>
    <RightSidebar />
  </div>
</template>
