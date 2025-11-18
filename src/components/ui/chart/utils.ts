import { isClient } from "@vueuse/core"
import { h, render } from "vue"
import type { ChartConfig } from "."

// Simple cache using a Map to store serialized object keys
const cache = new Map<string, string>()

// Convert object to a consistent string key
function serializeKey(key: Record<string, unknown>): string {
  return JSON.stringify(key, Object.keys(key).sort())
}

interface Constructor<P = unknown> {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  new (...args: unknown[]): {
    $props: P
  }
}

export function componentToString<P>(
  config: ChartConfig,
  component: Constructor<P>,
  props?: P
) {
  if (!isClient) return

  // This function will be called once during mount lifecycle
  const id = useId()

  // https://unovis.dev/docs/auxiliary/Crosshair#component-props
  const hasDataProp = (v: unknown): v is { data: unknown } =>
    typeof v === "object" && v !== null && "data" in v

  return (_data: unknown, x: number | Date) => {
    const data = hasDataProp(_data) ? _data.data : _data
    const serializedKey = `${id}-${serializeKey(data as Record<string, unknown>)}`
    const cachedContent = cache.get(serializedKey)
    if (cachedContent) return cachedContent

    const vnode = h<unknown>(component, { ...props, payload: data, config, x })
    const div = document.createElement("div")
    render(vnode, div)
    cache.set(serializedKey, div.innerHTML)
    return div.innerHTML
  }
}
