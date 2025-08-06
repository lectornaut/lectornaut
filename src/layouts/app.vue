<template>
  <SidebarProvider :default-open="false" class="min-h-auto">
    <SidebarInset class="bg-transparent">
      <Titlebar />
      <Separator />
      <AppLayout />
    </SidebarInset>
  </SidebarProvider>
</template>
