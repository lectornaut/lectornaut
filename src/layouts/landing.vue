<template>
  <div class="flex grow flex-col">
    <OverlayScrollbarsWrapper>
      <img
        src="/assets/images/shadow.png"
        alt="Hero"
        class="pointer-events-none absolute top-0 left-0 z-0 h-auto w-full object-cover object-top opacity-25 invert"
      />
      <Header />
      <Separator />
      <RouterView />
      <QRCode />
      <CTA />
      <Footer />
    </OverlayScrollbarsWrapper>
  </div>
</template>
