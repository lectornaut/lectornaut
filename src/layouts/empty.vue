<template>
  <RouterView v-slot="{ Component, route }">
    <template v-if="Component">
      <Transition
        enter-active-class="transition ease-in-out duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition ease-in-out duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
        mode="out-in"
      >
        <Component :is="Component" :key="route.path" />
      </Transition>
    </template>
  </RouterView>
</template>
