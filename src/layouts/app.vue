<template>
  <SidebarProvider :default-open="false" class="min-h-auto">
    <SidebarInset>
      <Titlebar />
      <Separator />
      <AppLayout />
      <Separator />
      <Footbar />
    </SidebarInset>
  </SidebarProvider>
</template>
