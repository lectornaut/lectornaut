<template>
  <SidebarProvider :default-open="false">
    <SidebarInset>
      <Titlebar />
      <Separator />
      <AppLayout />
      <Separator />
      <Footbar />
    </SidebarInset>
  </SidebarProvider>
</template>
