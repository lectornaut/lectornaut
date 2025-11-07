<script lang="ts" setup>
import type { BulletLegendItemInterface } from "@unovis/ts"
import { omit } from "@unovis/ts"
import { VisTooltip } from "@unovis/vue"
import type { Component } from "vue"
import { h, render } from "vue"
import { ChartTooltip } from "."

const props = defineProps<{
  selector: string
  index: string
  items?: BulletLegendItemInterface[]
  valueFormatter?: (tick: number, i?: number, ticks?: number[]) => string
  customTooltip?: Component
}>()

// Use weakmap to store reference to each datapoint for Tooltip
const wm = new WeakMap<object, string>()
type TooltipDatum =
  | Record<string, unknown>
  | ({ data: Record<string, unknown> } & Record<string, unknown>)
function template(
  d: TooltipDatum,
  i: number,
  elements: (HTMLElement | SVGElement)[]
) {
  const valueFormatter = props.valueFormatter ?? ((tick: number) => `${tick}`)
  if (props.index in d) {
    if (wm.has(d)) {
      return wm.get(d) ?? ""
    } else {
      const componentDiv = document.createElement("div")
      const omittedData = Object.entries(
        omit(d as Record<string, unknown>, [props.index])
      ).map(([key, value]) => {
        const legendReference = props.items?.find((i) => i.name === key)
        return { ...legendReference, value: valueFormatter(Number(value)) }
      })
      const TooltipComponent = props.customTooltip ?? ChartTooltip
      const vnode = h(TooltipComponent, {
        title: String((d as Record<string, unknown>)[props.index]),
        data: omittedData,
      })
      render(vnode, componentDiv)
      wm.set(d, componentDiv.innerHTML)
      return componentDiv.innerHTML
    }
  } else if ("data" in d) {
    const data = d.data as Record<string, unknown>

    if (wm.has(data as object)) {
      return wm.get(data as object) ?? ""
    } else {
      const element = elements[i]
      if (!element) return ""
      const style = getComputedStyle(element) as CSSStyleDeclaration & {
        fill?: string
      }
      const omittedData = [
        {
          name: String(data.name),
          value: valueFormatter(Number(data[props.index])),
          color: style.fill || "",
        },
      ]
      const componentDiv = document.createElement("div")
      const TooltipComponent = props.customTooltip ?? ChartTooltip
      const vnode = h(TooltipComponent, {
        title: String(data[props.index]),
        data: omittedData,
      })
      render(vnode, componentDiv)
      wm.set(data as object, componentDiv.innerHTML)
      return componentDiv.innerHTML
    }
  } else {
    return ""
  }
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
