<template>
  <SidebarProvider
    :default-open="false"
    class="flex min-h-auto grow flex-col overflow-auto overscroll-none"
  >
    <Titlebar />
    <Separator />
    <AppLayout />
    <Separator />
    <Footbar />
  </SidebarProvider>
</template>
