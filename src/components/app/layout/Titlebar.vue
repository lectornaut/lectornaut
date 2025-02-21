<template>
  <header class="min-h-titlebar-height flex h-auto items-center justify-center">
    <div
      data-tauri-drag-region
      class="grid h-full min-h-7 w-full grid-cols-3 items-center gap-2 p-2"
    >
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-end gap-2"
      ></div>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-center gap-2"
      >
        <CommandK />
      </div>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-start gap-2"
      ></div>
    </div>
  </header>
</template>
