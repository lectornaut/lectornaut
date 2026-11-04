<template>
  <div class="flex grow flex-col">
    <!-- data-route-scroller: this scroller outlives navigations between
         landing pages, so the router resets / restores it (see router.ts). -->
    <ScrollContainer data-route-scroller>
      <div
        class="pointer-events-none absolute top-0 left-0 z-0 size-full bg-black opacity-15 dark:bg-white"
        style="
          mask-image: url(/assets/images/hands.jpg);
          mask-size: cover;
          mask-repeat: no-repeat;
          mask-mode: luminance;
        "
      ></div>
      <!-- <img
        src="/assets/images/shadow.png"
        alt="Hero"
        class="pointer-events-none absolute top-0 left-0 z-0 h-auto w-full object-cover object-top opacity-25 invert"
      /> -->
      <Header />
      <Separator />
      <RouterView />
      <QRCode />
      <CTA />
      <Footer />
    </ScrollContainer>
  </div>
</template>
