<script setup lang="ts">
import { Carousel, type CarouselApi } from "@/components/ui/carousel"
import AutoScroll from "embla-carousel-auto-scroll"
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures"
import IconCamera from "~icons/lucide/camera"
import IconGrix2x2 from "~icons/lucide/grid-2-x-2"
import IconImage from "~icons/lucide/image"
import IconLink2 from "~icons/lucide/link-2"
import IconSparkles from "~icons/lucide/sparkles"

const carouselContainerRef = ref<typeof Carousel | null>(null)

const search = ref<string>("")
const isCameraOpen = ref(false)
const isPhotoTaken = ref(false)
const isShotPhoto = ref(false)
const isLoading = ref(false)

const camera = ref<HTMLVideoElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const toggleCamera = () => {
  if (isCameraOpen.value) {
    isCameraOpen.value = false
    isPhotoTaken.value = false
    isShotPhoto.value = false
    stopCameraStream()
  } else {
    isCameraOpen.value = true
    createCameraElement()
  }
}

const createCameraElement = () => {
  isLoading.value = true

  const constraints = {
    audio: false,
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: "user",
    },
  }

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      if (camera.value) {
        camera.value.srcObject = stream

        camera.value.onloadedmetadata = () => {
          isLoading.value = false
          camera.value?.play()

          if (canvas.value) {
            canvas.value.width = camera.value!.videoWidth
            canvas.value.height = camera.value!.videoHeight
          }
        }
      }
    })
    .catch(() => {
      isLoading.value = false
      isCameraOpen.value = false
      alert("Allow access to the camera in your browser settings.")
    })
}

const stopCameraStream = () => {
  if (camera.value && camera.value.srcObject) {
    const tracks = (camera.value.srcObject as MediaStream).getTracks()
    tracks.forEach((track) => track.stop())
  }
}

const takePhoto = () => {
  if (!isPhotoTaken.value) {
    isShotPhoto.value = true

    const FLASH_TIMEOUT = 50
    setTimeout(() => {
      isShotPhoto.value = false
    }, FLASH_TIMEOUT)
  }

  isPhotoTaken.value = !isPhotoTaken.value

  if (canvas.value && camera.value) {
    const context = canvas.value.getContext("2d")
    if (context) {
      const videoWidth = camera.value.videoWidth
      const videoHeight = camera.value.videoHeight
      canvas.value.width = videoWidth
      canvas.value.height = videoHeight

      context.save()
      context.scale(-1, 1)
      context.drawImage(camera.value, -videoWidth, 0, videoWidth, videoHeight)
      context.restore()
    }
  }
}

const downloadImage = () => {
  const download = document.getElementById("downloadPhoto")
  if (canvas.value) {
    const image = canvas.value
      .toDataURL("image/jpeg")
      .replace("image/jpeg", "image/octet-stream")
    if (download) {
      download.setAttribute("href", image)
    }
  }
}

const emblaMainApi = ref<CarouselApi>()
const emblaThumbnailApi = ref<CarouselApi>()
const selectedIndex = ref(0)

function onSelect() {
  if (!emblaMainApi.value || !emblaThumbnailApi.value) return
  selectedIndex.value = emblaMainApi.value.selectedScrollSnap()
  emblaThumbnailApi.value.scrollTo(
    emblaMainApi.value.selectedScrollSnap(),
    true
  )
}

function onThumbClick(index: number) {
  if (!emblaMainApi.value || !emblaThumbnailApi.value) return
  emblaMainApi.value.scrollTo(index, true)
}

watchOnce(emblaMainApi, (emblaMainApi) => {
  if (!emblaMainApi) return

  onSelect()
  emblaMainApi.on("select", onSelect)
  emblaMainApi.on("reInit", onSelect)
})

const fileDataUrl = ref("")

const handleFileChange = (event: Event) => {
  const file = (event.target as HTMLInputElement)?.files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      fileDataUrl.value = e.target?.result as string
    }
    reader.readAsDataURL(file)
  } else {
    fileDataUrl.value = ""
  }
}

const navItems = [
  {
    text: "Home",
    icon: IconGrix2x2,
    color: "neutral",
    scrollTo: 0,
    primary: true,
    style: {
      button:
        "border-neutral-500/5 bg-neutral-500/10 text-neutral-600/90 hover:bg-neutral-400/25 hover:text-neutral-800/80",
      icon: "bg-neutral-500/10",
      active: "bg-neutral-400/25 text-neutral-800/80",
      inactive:
        "bg-neutral-500/10 text-neutral-600/90 hover:bg-neutral-400/25 hover:text-neutral-800/80 aspect-square",
    },
  },
  {
    text: "Camera",
    icon: IconCamera,
    color: "cyan",
    scrollTo: 1,
    primary: false,
    style: {
      button:
        "border-cyan-500/5 bg-cyan-500/10 text-cyan-600/90 hover:bg-cyan-400/25 hover:text-cyan-800/80",
      icon: "bg-cyan-500/10",
      active: "bg-cyan-400/25 text-cyan-800/80",
      inactive:
        "bg-cyan-500/10 text-cyan-600/90 hover:bg-cyan-400/25 hover:text-cyan-800/80 aspect-square",
    },
  },
  {
    text: "Image",
    icon: IconImage,
    color: "lime",
    scrollTo: 2,
    primary: false,
    style: {
      button:
        "border-lime-500/5 bg-lime-500/10 text-lime-600/90 hover:bg-lime-400/25 hover:text-lime-800/80",
      icon: "bg-lime-500/10",
      active: "bg-lime-400/25 text-lime-800/80",
      inactive:
        "bg-lime-500/10 text-lime-600/90 hover:bg-lime-400/25 hover:text-lime-800/80 aspect-square",
    },
  },
  {
    text: "Link",
    icon: IconLink2,
    color: "emerald",
    scrollTo: 3,
    primary: false,
    style: {
      button:
        "border-emerald-500/5 bg-emerald-500/10 text-emerald-600/90 hover:bg-emerald-400/25 hover:text-emerald-800/80",
      icon: "bg-emerald-500/10",
      active: "bg-emerald-400/25 text-emerald-800/80",
      inactive:
        "bg-emerald-500/10 text-emerald-600/90 hover:bg-emerald-400/25 hover:text-emerald-800/80 aspect-square",
    },
  },
  {
    text: "AI",
    icon: IconSparkles,
    color: "fuchsia",
    scrollTo: 4,
    primary: false,
    style: {
      button:
        "border-fuchsia-500/5 bg-fuchsia-500/10 text-fuchsia-600/90 hover:bg-fuchsia-400/25 hover:text-fuchsia-800/80",
      icon: "bg-fuchsia-500/10",
      active: "bg-fuchsia-400/25 text-fuchsia-800/80",
      inactive:
        "bg-fuchsia-500/10 text-fuchsia-600/90 hover:bg-fuchsia-400/25 hover:text-fuchsia-800/80 aspect-square",
    },
  },
]

const randomIndex = () => {
  return Math.floor(Math.random() * 12) + 1
}
</script>

<template>
  <div class="relative">
    <div
      class="absolute inset-0 grid h-screen w-screen grid-cols-6 bg-black px-1"
    >
      <Carousel
        v-for="(_, columnIndex) in 6"
        :key="columnIndex"
        class="focus-visible:outline-none"
        orientation="vertical"
        :opts="{
          align: 'start',
          loop: true,
        }"
        :plugins="[
          WheelGesturesPlugin(),
          AutoScroll({
            speed: randomIndex() * 0.05,
            startDelay: 0,
            stopOnInteraction: false,
            stopOnMouseEnter: true,
          }),
        ]"
      >
        <CarouselContent class="m-0 max-h-dvh min-h-0">
          <CarouselItem
            v-for="(__, rowIndex) in 15"
            :key="rowIndex"
            class="bg-background group relative m-1 flex aspect-square basis-auto items-center justify-center rounded-md bg-cover bg-center p-0"
            :style="{
              backgroundImage: `url(https://flowbite.s3.amazonaws.com/docs/gallery/masonry/image-${randomIndex()}.jpg)`,
            }"
          >
            <div
              class="absolute inset-0 flex items-center justify-center bg-black/75 transition group-hover:bg-transparent"
            ></div>
          </CarouselItem>
        </CarouselContent>
      </Carousel>
    </div>
    <Carousel
      ref="carouselContainerRef"
      orientation="vertical"
      :plugins="[WheelGesturesPlugin()]"
      class="focus-visible:outline-none"
      @init-api="(val: any) => (emblaMainApi = val.carouselApi.value)"
    >
      <CarouselContent class="m-0 h-screen w-screen">
        <CarouselItem class="flex items-center justify-center gap-4 p-4">
          <div class="m-auto grid w-full max-w-md grid-cols-2 gap-2">
            <template v-for="(item, index) in navItems" :key="index">
              <button
                v-if="!item.primary"
                class="flex aspect-square flex-col items-center justify-center gap-6 rounded-4xl border p-8 transition"
                :class="item.style.button"
                @click="
                  carouselContainerRef?.carouselApi.scrollTo(
                    item.scrollTo,
                    true
                  )
                "
              >
                <span :class="item.style.icon" class="rounded-full p-4">
                  <Component :is="item.icon" class="size-8" />
                </span>
                <span
                  class="text-lg leading-tight font-semibold tracking-tight"
                >
                  {{ item.text }}
                </span>
              </button>
            </template>
          </div>
        </CarouselItem>
        <CarouselItem class="flex items-center justify-center gap-4 p-4">
          <div class="m-auto w-full max-w-md">
            <div
              class="bg-secondary relative flex aspect-square flex-col items-center justify-end gap-4 rounded-4xl"
            >
              <div v-if="isCameraOpen" v-show="!isLoading">
                <div
                  class="absolute inset-0 z-10 bg-white opacity-0 transition"
                  :class="{ 'opacity-100': isShotPhoto }"
                ></div>
                <video
                  v-show="!isPhotoTaken"
                  ref="camera"
                  autoplay
                  class="aspect-square size-full rotate-y-180 rounded-4xl object-cover"
                />
                <canvas
                  v-show="isPhotoTaken"
                  id="photoTaken"
                  ref="canvas"
                  class="aspect-square size-full rounded-4xl object-cover"
                />
              </div>
              <div class="absolute end-4 top-4 z-10 flex flex-col gap-2">
                <Button
                  variant="ghost"
                  class="text-muted-foreground rounded-full"
                  size="icon"
                  @click="toggleCamera"
                >
                  <icon-lucide-aperture v-if="!isCameraOpen" />
                  <icon-lucide-loader
                    v-else-if="isCameraOpen && isLoading"
                    class="animate-spin"
                  />
                  <icon-lucide-x v-else />
                </Button>
                <Button
                  v-if="isPhotoTaken"
                  variant="ghost"
                  class="text-muted-foreground rounded-full"
                  size="icon"
                  as-child
                >
                  <a
                    id="downloadPhoto"
                    download="photo.jpg"
                    role="button"
                    @click="downloadImage"
                  >
                    <icon-lucide-download />
                  </a>
                </Button>
              </div>
              <div
                v-if="isCameraOpen && !isLoading"
                class="absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
              >
                <Button
                  variant="secondary"
                  size="icon"
                  class="rounded-full"
                  @click="takePhoto"
                >
                  <icon-lucide-circle v-if="!isPhotoTaken" class="size-8" />
                  <icon-lucide-refresh-cw v-else />
                </Button>
              </div>
            </div>
          </div>
        </CarouselItem>
        <CarouselItem class="flex items-center justify-center gap-4 p-4">
          <div class="m-auto w-full max-w-md">
            <div
              class="bg-secondary relative flex aspect-square flex-col items-center justify-end gap-4 rounded-4xl bg-cover bg-center bg-no-repeat p-4"
              :style="{
                backgroundImage: `url(${fileDataUrl})`,
              }"
            >
              <div
                v-if="!fileDataUrl"
                class="text-muted-foreground m-auto grid grid-cols-1 gap-16"
              >
                <icon-lucide-image class="h-8 w-auto" />
              </div>
              <div class="grid w-full">
                <div class="relative w-full items-center">
                  <Label for="picture">
                    <Input
                      id="picture"
                      type="file"
                      accept=".jpg, .png"
                      class="bg-muted rounded-full shadow-none"
                      placeholder="Upload a picture"
                      @change="handleFileChange"
                    />
                  </Label>
                  <span
                    class="absolute inset-y-0 end-0 flex items-center justify-center gap-2 p-2"
                  >
                    <Badge class="rounded-full" variant="secondary">
                      <icon-mdi-dots-circle />
                      <span>Try sample image</span>
                    </Badge>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CarouselItem>
        <CarouselItem class="flex items-center justify-center gap-4 p-4">
          <div class="m-auto w-full max-w-md">
            <div
              class="bg-secondary relative flex aspect-square flex-col items-center justify-end gap-4 rounded-4xl p-4"
            >
              <div class="text-muted-foreground m-auto grid grid-cols-3 gap-16">
                <icon-simple-icons-amazon class="h-8 w-auto" />
                <icon-simple-icons-shopify class="h-8 w-auto" />
                <icon-simple-icons-etsy class="h-8 w-auto" />
                <icon-simple-icons-ebay class="h-8 w-auto" />
                <icon-simple-icons-rakuten class="h-8 w-auto" />
                <icon-tabler-brand-walmart class="h-8 w-auto" />
              </div>
              <div class="grid w-full">
                <div class="relative w-full items-center">
                  <Label for="link">
                    <Input
                      id="link"
                      type="text"
                      class="bg-muted rounded-full shadow-none"
                      placeholder="Paste your link here..."
                    />
                  </Label>
                  <span
                    class="absolute inset-y-0 end-0 flex items-center justify-center gap-2 p-2"
                  >
                    <Badge class="rounded-full" variant="secondary">
                      <icon-mdi-dots-circle />
                      <span>Try sample link</span>
                    </Badge>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CarouselItem>
        <CarouselItem class="flex items-center justify-center gap-4 p-4">
          <div class="m-auto w-full max-w-md">
            <div
              class="bg-secondary relative flex aspect-square flex-col items-center justify-end gap-4 rounded-4xl p-4"
            >
              <div class="relative w-full items-center">
                <Label for="search">
                  <Textarea
                    v-model="search"
                    data-gramm="false"
                    class="bg-background h-32 resize-none rounded-3xl p-4 shadow-none"
                    cols="10"
                    placeholder="Ask AI what you want to find..."
                  />
                </Label>
                <span class="absolute end-0 top-0 flex gap-2 p-4">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge class="rounded-full px-0.5" variant="secondary">
                          <icon-mdi-dots-circle />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <span>Try sample prompt</span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
                <span
                  class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-4"
                >
                  <span class="flex gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <DropdownMenu>
                          <TooltipTrigger as-child>
                            <DropdownMenuTrigger as-child>
                              <Button
                                variant="outline"
                                size="icon"
                                class="rounded-full"
                              >
                                <icon-lucide-plus />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="top">Attach</TooltipContent>
                          <DropdownMenuContent
                            class="w-48 rounded-xl shadow-none"
                            align="start"
                            side="top"
                          >
                            <DropdownMenuLabel>
                              Attach to your prompt
                            </DropdownMenuLabel>
                            <DropdownMenuGroup>
                              <DropdownMenuItem>
                                <icon-lucide-upload />
                                <span>Upload image</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <icon-lucide-camera />
                                <span>Take photo</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <icon-lucide-globe />
                                <span>Image URL</span>
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuLabel
                              class="text-muted-foreground text-xs"
                            >
                              JPEG, PNG, GIF, WEBP, AVIF supported. Max 5MB.
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem>
                                <icon-lucide-link-2 />
                                <span>Product Link</span>
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuLabel
                              class="text-muted-foreground text-xs"
                            >
                              Amazon, Shopify, Etsy, eBay, Rakuten, Walmart
                              supported.
                            </DropdownMenuLabel>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                  <span class="flex gap-2">
                    <Button size="icon" class="rounded-full">
                      <icon-lucide-arrow-up />
                    </Button>
                  </span>
                </span>
              </div>
            </div>
          </div>
        </CarouselItem>
      </CarouselContent>
    </Carousel>
    <Carousel
      class="fixed top-4 left-1/2 w-full max-w-md -translate-x-1/2 focus-visible:outline-none"
      @init-api="(val: any) => (emblaThumbnailApi = val)"
    >
      <CarouselContent class="m-0 flex gap-2">
        <template v-for="(item, index) in navItems" :key="index">
          <CarouselItem
            :class="[
              'flex shrink-0 basis-auto items-center justify-center gap-2 rounded-full px-3 transition-all',
              `border-${item.color}-500/5`,
              selectedIndex === index ? item.style.active : item.style.inactive,
            ]"
            @click="onThumbClick(index)"
          >
            <Component :is="item.icon" />
            <span v-if="selectedIndex === index" class="font-medium">
              {{ item.text }}
            </span>
          </CarouselItem>
        </template>
      </CarouselContent>
    </Carousel>
  </div>
</template>
