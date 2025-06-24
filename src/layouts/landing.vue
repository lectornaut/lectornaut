<template>
  <div class="flex grow flex-col">
    <OverlayScrollbarsWrapper>
      <Header />
      <Separator />
      <RouterView />
      <FooterText />
      <QRCode />
      <Footer />
      <img
        src="/assets/images/shadow.png"
        alt="Hero"
        class="pointer-events-none absolute inset-0 opacity-25 invert"
      />
    </OverlayScrollbarsWrapper>
  </div>
</template>
