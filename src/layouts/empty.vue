<template>
  <RouterView v-slot="{ Component, route }">
    <Transition
      enter-active-class="transition ease-in-out duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in-out duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
      mode="out-in"
    >
      <template v-if="Component">
        <Component :is="Component" :key="route.path" />
      </template>
    </Transition>
  </RouterView>
</template>
