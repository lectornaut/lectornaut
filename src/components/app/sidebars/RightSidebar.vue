<script setup lang="ts">
import click from "/assets/sounds/click.mp3"
import { getInitials } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const ask = ref("")
const user = useCurrentUser()

const displayName = computed(() => user.value?.displayName ?? "User")
const photoURL = computed(() => user.value?.photoURL ?? "")

const play = () => new Audio(click).play()
</script>

<template>
  <aside class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div>
      <div
        data-tauri-drag-region
        class="flex items-center justify-between gap-2 p-2"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                @click="emitter.emit('Sidebar.Right.Toggle')"
              >
                <icon-lucide-chevrons-right />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Collapse Sidebar </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="text-muted-foreground data-[state=open]:bg-muted"
                  >
                    <icon-lucide-ellipsis />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent> More </TooltipContent>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem class="gap-2">
                    <icon-lucide-download />
                    <span>Export transcript</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem class="gap-2">
                    <icon-lucide-trash />
                    <span>Clear chat</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Separator />
    </div>
    <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
      <div class="flex grow flex-col gap-2 p-2">
        <div
          v-for="message in 24"
          :key="message"
          class="flex gap-2"
          :class="
            message % 2 !== 0 ? 'ml-16 flex-row-reverse' : 'mr-16 flex-row'
          "
        >
          <Avatar v-if="message % 2 !== 0" class="size-4">
            <AvatarImage
              :src="photoURL! ?? ''"
              referrerpolicy="no-referrer"
              :alt="displayName"
            />
            <AvatarFallback>
              {{ getInitials(displayName) }}
            </AvatarFallback>
          </Avatar>
          <span
            v-else
            class="bg-primary text-primary-foreground flex aspect-square h-4 w-4 items-center justify-center rounded-full"
          >
            <icon-mingcute-ai-fill />
          </span>
          <div
            class="flex w-auto shrink rounded-xl px-4 py-3"
            :class="
              message % 2 !== 0
                ? 'bg-primary/10 ml-auto'
                : 'bg-primary/5 mr-auto'
            "
          >
            Lorem ipsum, dolor sit amet consectetur adipisicing elit. Odio
            necessitatibus deserunt cumque quibusdam minima et corporis ratione
            a ipsa temporibus modi in neque, reiciendis nostrum voluptatibus!
            Enim ut modi repudiandae?
          </div>
        </div>
      </div>
    </div>
    <div>
      <Separator />
      <div class="flex flex-col gap-2 p-2">
        <div class="text-muted-foreground/75 flex items-center gap-2 p-1">
          <icon-mingcute-pencil-2-ai-fill />
          <RadiantText class="w-full"> Try these prompts </RadiantText>
        </div>
        <div class="grid gap-2 md:grid-cols-2">
          <Card
            class="hover:border-primary/25 cursor-pointer rounded-xl shadow-none transition"
          >
            <CardHeader class="gap-1 px-4 py-4">
              <CardTitle>What are the</CardTitle>
              <CardDescription> benefits of upgrading? </CardDescription>
            </CardHeader>
          </Card>
          <Card
            class="hover:border-primary/25 cursor-pointer rounded-xl shadow-none transition"
          >
            <CardHeader class="gap-1 px-4 py-4">
              <CardTitle>How do I</CardTitle>
              <CardDescription> upgrade my account? </CardDescription>
            </CardHeader>
          </Card>
          <Card
            class="hover:border-primary/25 cursor-pointer rounded-xl shadow-none transition"
          >
            <CardHeader class="gap-1 px-4 py-4">
              <CardTitle>How do I</CardTitle>
              <CardDescription> cancel my subscription? </CardDescription>
            </CardHeader>
          </Card>
          <Card
            class="hover:border-primary/25 cursor-pointer rounded-xl shadow-none transition"
          >
            <CardHeader class="gap-1 px-4 py-4">
              <CardTitle>How do I</CardTitle>
              <CardDescription> change my password? </CardDescription>
            </CardHeader>
          </Card>
        </div>
        <div class="relative items-center">
          <span
            class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
          >
            <icon-mingcute-ai-fill />
          </span>
          <Input
            v-model="ask"
            siz
            placeholder="Type your message here."
            class="bg-primary/5 hover:bg-primary/10 focus:bg-primary/10 truncate rounded-full pr-12 pl-8 ring-offset-transparent transition focus:border-inherit focus:ring-0 focus:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <span
            class="absolute inset-y-0 end-0 right-0.5 flex items-center justify-center"
          >
            <Button class="rounded-full" size="icon" @click="play">
              <icon-lucide-arrow-up />
            </Button>
          </span>
        </div>
      </div>
    </div>
  </aside>
</template>
