<template>
  <Dialog>
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>
    <DialogContent class="w-sm max-w-fit">
      <DialogHeader class="sr-only">
        <DialogTitle>Enter Template</DialogTitle>
        <DialogDescription>
          Create an account or sign in to continue.
        </DialogDescription>
      </DialogHeader>
      <div class="mx-auto flex w-full flex-col">
        <EnterContent />
      </div>
      <DialogFooter>
        <EnterFooter />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
