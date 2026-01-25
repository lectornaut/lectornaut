import type { EmblaOptionsType, EmblaPluginType } from "embla-carousel"
import type useEmblaCarousel from "embla-carousel-vue"
import type { EmblaCarouselVueType } from "embla-carousel-vue"
import type { HTMLAttributes, Ref, UnwrapRef } from "vue"

type CarouselApi = EmblaCarouselVueType[1]
type CarouselOptions = EmblaOptionsType
type CarouselPlugin = EmblaPluginType[]

export type UnwrapRefCarouselApi = UnwrapRef<CarouselApi>

export interface CarouselProps {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: "horizontal" | "vertical"
}

export interface CarouselEmits {
  (e: "init-api", payload: UnwrapRefCarouselApi): void
}

export interface WithClassAsProps {
  class?: HTMLAttributes["class"]
}

export interface CarouselContext {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  carouselApi: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: Ref<boolean>
  canScrollNext: Ref<boolean>
  orientation: "horizontal" | "vertical" | undefined
}
