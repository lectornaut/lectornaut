<template>
  <Dialog>
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>
    <DialogContent class="w-sm max-w-fit">
      <DialogHeader class="sr-only">
        <DialogTitle>Enter</DialogTitle>
        <DialogDescription>
          Create an account or sign in to continue.
        </DialogDescription>
      </DialogHeader>
      <EnterContent />
      <DialogFooter>
        <EnterFooter />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
