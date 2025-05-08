<script setup lang="ts">
import { Carousel, type CarouselApi } from "@/components/ui/carousel"
import { watchOnce } from "@vueuse/core"
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures"

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
</script>

<template>
  <Carousel
    ref="carouselContainerRef"
    orientation="vertical"
    :plugins="[WheelGesturesPlugin()]"
    class="focus-visible:outline-none"
    @init-api="(val) => (emblaMainApi = val)"
  >
    <CarouselContent class="m-0 h-dvh w-dvw">
      <CarouselItem
        class="flex h-full w-full items-center justify-center gap-4 p-4"
      >
        <div class="m-auto grid w-full max-w-md grid-cols-2 gap-2">
          <button
            class="flex aspect-square flex-col items-center justify-center gap-6 rounded-xl rounded-tl-4xl border border-cyan-500/5 bg-cyan-500/10 p-8 text-cyan-600/90 transition hover:bg-cyan-400/25 hover:text-cyan-800/80"
            @click="carouselContainerRef?.carouselApi.scrollTo(1, true)"
          >
            <span class="rounded-full bg-cyan-500/10 p-4">
              <icon-lucide-camera class="h-8 w-8" />
            </span>
            <span class="text-lg leading-tight font-semibold tracking-tight">
              Take photo
            </span>
          </button>
          <button
            class="flex aspect-square flex-col items-center justify-center gap-6 rounded-xl rounded-tr-4xl border border-lime-500/5 bg-lime-500/10 p-8 text-lime-600/90 transition hover:bg-lime-400/25 hover:text-lime-800/80"
            @click="carouselContainerRef?.carouselApi.scrollTo(2, true)"
          >
            <span class="rounded-full bg-lime-500/10 p-4">
              <icon-lucide-image class="h-8 w-8" />
            </span>
            <span class="text-lg leading-tight font-semibold tracking-tight">
              Upload image
            </span>
          </button>
          <button
            class="flex aspect-square flex-col items-center justify-center gap-6 rounded-xl rounded-bl-4xl border border-emerald-500/5 bg-emerald-500/10 p-8 text-emerald-600/90 transition hover:bg-emerald-400/25 hover:text-emerald-800/80"
            @click="carouselContainerRef?.carouselApi.scrollTo(3, true)"
          >
            <span class="rounded-full bg-emerald-500/10 p-4">
              <icon-lucide-link-2 class="h-8 w-8" />
            </span>
            <span class="text-lg leading-tight font-semibold tracking-tight">
              Paste link
            </span>
          </button>
          <button
            class="flex aspect-square flex-col items-center justify-center gap-6 rounded-xl rounded-br-4xl border border-fuchsia-500/5 bg-fuchsia-500/10 p-8 text-fuchsia-600/90 transition hover:bg-fuchsia-400/25 hover:text-fuchsia-800/80"
            @click="carouselContainerRef?.carouselApi.scrollTo(4, true)"
          >
            <span class="rounded-full bg-fuchsia-500/10 p-4">
              <icon-lucide-sparkles class="h-8 w-8" />
            </span>
            <span class="text-lg leading-tight font-semibold tracking-tight">
              Ask AI
            </span>
          </button>
        </div>
      </CarouselItem>
      <CarouselItem
        class="flex h-full w-full items-center justify-center gap-4 p-4"
      >
        <div class="m-auto w-full max-w-md">
          <div class="bg-secondary relative aspect-square rounded-xl">
            <div v-if="isCameraOpen" v-show="!isLoading">
              <div
                class="absolute inset-0 z-10 bg-white opacity-0 transition"
                :class="{ 'opacity-100': isShotPhoto }"
              ></div>
              <video
                v-show="!isPhotoTaken"
                ref="camera"
                autoplay
                class="aspect-square h-full w-full rotate-y-180 rounded-xl object-cover"
              />
              <canvas
                v-show="isPhotoTaken"
                id="photoTaken"
                ref="canvas"
                class="aspect-square h-full w-full rounded-xl object-cover"
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
                <icon-lucide-circle v-if="!isPhotoTaken" class="h-8 w-8" />
                <icon-lucide-refresh-cw v-else />
              </Button>
            </div>
          </div>
        </div>
      </CarouselItem>
      <CarouselItem
        class="flex h-full w-full items-center justify-center gap-4 p-4"
      >
        <div class="m-auto w-full max-w-md">
          <div
            class="bg-secondary relative flex aspect-square flex-col items-center justify-end gap-4 rounded-xl bg-cover bg-center bg-no-repeat p-4"
            :style="{
              backgroundImage: `url(${fileDataUrl})`,
            }"
          >
            <div class="grid w-full">
              <Label for="picture">
                <Input
                  id="picture"
                  type="file"
                  accept=".jpg, .png"
                  class="bg-background"
                  @change="handleFileChange"
                />
              </Label>
            </div>
          </div>
        </div>
      </CarouselItem>
      <CarouselItem
        class="flex h-full w-full items-center justify-center gap-4 p-4"
        >4</CarouselItem
      >
      <CarouselItem
        class="flex h-full w-full items-center justify-center gap-4 p-4"
      >
        <div class="mx-auto w-full max-w-md">
          <div class="relative w-full items-center">
            <Textarea
              v-model="search"
              class="h-24 resize-none rounded-3xl p-4"
              cols="10"
              placeholder="Ask AI what you want to find..."
            />
            <span
              class="absolute inset-y-0 end-0 flex items-end justify-center p-2"
            >
              <Button
                :variant="search ? 'default' : 'secondary'"
                size="icon"
                class="rounded-full"
              >
                <icon-lucide-arrow-up />
              </Button>
            </span>
          </div>
        </div>
      </CarouselItem>
    </CarouselContent>
  </Carousel>
  <Carousel
    class="fixed top-4 left-1/2 w-full max-w-md -translate-x-1/2 focus-visible:outline-none"
    @init-api="(val) => (emblaThumbnailApi = val)"
  >
    <CarouselContent class="m-0 flex h-8 gap-2">
      <CarouselItem
        :class="
          selectedIndex === 0
            ? 'bg-neutral-400/25 text-neutral-800/80'
            : 'opacity-50'
        "
        class="flex basis-auto items-center justify-center gap-2 rounded-full border-neutral-500/5 bg-neutral-500/10 px-3 py-2 text-neutral-600/90 shadow-none transition-all hover:bg-neutral-400/25 hover:text-neutral-800/80"
        @click="onThumbClick(0)"
      >
        <icon-lucide-grid-2-x-2 />
        <span class="font-medium">Home</span>
      </CarouselItem>
      <CarouselItem
        :class="
          selectedIndex === 1
            ? 'bg-cyan-400/25 text-cyan-800/80'
            : 'aspect-square opacity-50'
        "
        class="flex basis-auto items-center justify-center gap-2 rounded-full border-cyan-500/5 bg-cyan-500/10 px-3 py-2 text-cyan-600/90 shadow-none transition-all hover:bg-cyan-400/25 hover:text-cyan-800/80"
        @click="onThumbClick(1)"
      >
        <icon-lucide-camera />
        <span v-if="selectedIndex === 1" class="font-medium">Camera</span>
      </CarouselItem>
      <CarouselItem
        :class="
          selectedIndex === 2
            ? 'bg-lime-400/25 text-lime-800/80'
            : 'aspect-square opacity-50'
        "
        class="flex basis-auto items-center justify-center gap-2 rounded-full border-lime-500/5 bg-lime-500/10 px-3 py-2 text-lime-600/90 shadow-none transition-all hover:bg-lime-400/25 hover:text-lime-800/80"
        @click="onThumbClick(2)"
      >
        <icon-lucide-image />
        <span v-if="selectedIndex === 2" class="font-medium">Image</span>
      </CarouselItem>
      <CarouselItem
        :class="
          selectedIndex === 3
            ? 'bg-emerald-400/25 text-emerald-800/80'
            : 'aspect-square opacity-50'
        "
        class="flex basis-auto items-center justify-center gap-2 rounded-full border-emerald-500/5 bg-emerald-500/10 px-3 py-2 text-emerald-600/90 shadow-none transition-all hover:bg-emerald-400/25 hover:text-emerald-800/80"
        @click="onThumbClick(3)"
      >
        <icon-lucide-link-2 />
        <span v-if="selectedIndex === 3" class="font-medium">Link</span>
      </CarouselItem>
      <CarouselItem
        :class="
          selectedIndex === 4
            ? 'bg-fuchsia-400/25 text-fuchsia-800/80'
            : 'aspect-square opacity-50'
        "
        class="flex basis-auto items-center justify-center gap-2 rounded-full border-fuchsia-500/5 bg-fuchsia-500/10 px-3 py-2 text-fuchsia-600/90 shadow-none transition-all hover:bg-fuchsia-400/25 hover:text-fuchsia-800/80"
        @click="onThumbClick(4)"
      >
        <icon-lucide-sparkles />
        <span v-if="selectedIndex === 4" class="font-medium">AI</span>
      </CarouselItem>
    </CarouselContent>
  </Carousel>
</template>
