import { mergeAttributes } from "@tiptap/core"
import Image from "@tiptap/extension-image"

type ImageAlignment = "left" | "center" | "right"

const normalizeAlign = (value: unknown): ImageAlignment => {
  if (value === "left" || value === "right" || value === "center") {
    return value
  }

  return "center"
}

const normalizeWidth = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}px`
  }

  if (typeof value === "string" && value.trim().length) {
    return value.trim()
  }

  return "100%"
}

const alignToStyle = (align: ImageAlignment): string => {
  if (align === "left") {
    return "display:block;margin-left:0;margin-right:auto"
  }

  if (align === "right") {
    return "display:block;margin-left:auto;margin-right:0"
  }

  return "display:block;margin-left:auto;margin-right:auto"
}

export const RichImage = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "center",
        parseHTML: (element) =>
          normalizeAlign(element.getAttribute("data-align") ?? "center"),
        renderHTML: (attributes) => ({
          "data-align": normalizeAlign(attributes.align),
        }),
      },
      width: {
        default: "100%",
        parseHTML: (element) =>
          normalizeWidth(element.getAttribute("data-width")),
        renderHTML: (attributes) => ({
          "data-width": normalizeWidth(attributes.width),
        }),
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          attributes.caption
            ? { "data-caption": String(attributes.caption) }
            : {},
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const align = normalizeAlign(HTMLAttributes.align)
    const width = normalizeWidth(HTMLAttributes.width)

    const style = [alignToStyle(align), `width:${width}`].join(";")

    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style,
        class: "editor-image-node",
      }),
    ]
  },
})
