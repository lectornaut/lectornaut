import type useEmblaCarousel from "embla-carousel-vue"
import type { EmblaCarouselVueType } from "embla-carousel-vue"
import type { HTMLAttributes, Ref, UnwrapRef } from "vue"

type CarouselApi = EmblaCarouselVueType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

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
