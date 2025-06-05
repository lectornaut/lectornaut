<script setup lang="ts">
import type { BulletLegendItemInterface } from "@unovis/ts"
import { omit } from "@unovis/ts"
import { VisTooltip } from "@unovis/vue"
import { type Component, createApp } from "vue"
import { ChartTooltip } from "."

const props = defineProps<{
  selector: string
  index: string
  items?: BulletLegendItemInterface[]
  valueFormatter?: (tick: number, i?: number, ticks?: number[]) => string
  customTooltip?: Component
}>()

// Use weakmap to store reference to each datapoint for Tooltip
const wm = new WeakMap()
interface DataRecord {
  [key: string]: unknown
}

function template(
  d: DataRecord,
  i: number,
  elements: (HTMLElement | SVGElement)[]
) {
  const valueFormatter = props.valueFormatter ?? ((tick: number) => `${tick}`)
  if (d && typeof d === "object" && props.index in d) {
    if (wm.has(d)) {
      return wm.get(d)
    } else {
      const componentDiv = document.createElement("div")
      const omittedData = Object.entries(
        omit(d as Record<string, unknown>, [props.index])
      ).map(([key, value]) => {
        const legendReference = props.items?.find((i) => i.name === key)
        return { ...legendReference, value: valueFormatter(Number(value)) }
      })
      const TooltipComponent = props.customTooltip ?? ChartTooltip
      const app = createApp(TooltipComponent, {
        title: d[props.index],
        data: omittedData,
      })
      app.mount(componentDiv)
      wm.set(d, componentDiv.innerHTML)
      app.unmount()
      return componentDiv.innerHTML
    }
  } else if (d && typeof d === "object" && d.data) {
    const data = d.data as Record<string, unknown>

    if (wm.has(data)) {
      return wm.get(data)
    } else {
      const style = getComputedStyle(elements[i] as HTMLElement)
      const omittedData = [
        {
          name: (data as { name?: string }).name,
          value: valueFormatter(Number(data[props.index])),
          color: style.fill,
        },
      ]
      const componentDiv = document.createElement("div")
      const TooltipComponent = props.customTooltip ?? ChartTooltip
      const app = createApp(TooltipComponent, {
        title: d[props.index],
        data: omittedData,
      })
      app.mount(componentDiv)
      wm.set(d as object, componentDiv.innerHTML)
      app.unmount()
      return componentDiv.innerHTML
    }
  }
  return ""
}
</script>

<template>
  <VisTooltip
    :horizontal-shift="20"
    :vertical-shift="20"
    :triggers="{
      [selector]: template,
    }"
  />
</template>
