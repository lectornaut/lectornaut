<script setup lang="ts">
interface Artwork {
  id: string
  artist: string
  art: string
}

const works: Artwork[] = [
  {
    id: "1",
    artist: "Ornella Binni",
    art: "https://images.unsplash.com/photo-1465869185982-5a1a7522cbcb?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "2",
    artist: "Tom Byrom",
    art: "https://images.unsplash.com/photo-1548516173-3cabfa4607e9?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "3",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "4",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "5",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "6",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "7",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "8",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "9",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "10",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: "11",
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
]
</script>

<template>
  <ScrollArea class="h-80 w-72 whitespace-nowrap">
    <div class="flex h-max flex-col gap-4 p-4">
      <div v-for="artwork in works" :key="artwork.id">
        <figure class="shrink-0">
          <div class="overflow-hidden rounded-md">
            <img
              :src="artwork.art"
              :alt="`Photo by ${artwork.artist}`"
              class="aspect-video w-full object-cover"
            />
          </div>
          <figcaption class="pt-2 text-xs text-muted-foreground">
            Photo by
            <span class="font-semibold text-foreground">
              {{ artwork.artist }}
            </span>
          </figcaption>
        </figure>
      </div>
    </div>
    <ScrollBar />
  </ScrollArea>
</template>
