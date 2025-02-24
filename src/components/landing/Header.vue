<template>
  <div
    class="fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-2 p-2"
  >
    <div class="flex grow items-center justify-start">
      <Button variant="ghost" as-child>
        <RouterLink to="/">
          <icon-material-symbols-circle />
          Hyperjump
        </RouterLink>
      </Button>
    </div>
    <div class="flex grow items-center justify-center"></div>
    <div class="flex grow items-center justify-end">
      <LanguageSwitcher />
      <ColorMode />
    </div>
  </div>
</template>
