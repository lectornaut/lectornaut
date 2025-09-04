import { tags as t } from "@lezer/highlight"
import { createTheme } from "thememirror"

export const lightTheme = createTheme({
  variant: "light",
  settings: {
    background: "var(--background)",
    foreground: "var(--foreground)",
    caret: "var(--foreground)",
    selection: "color-mix(in oklch, var(--ring) 24%, transparent)",
    gutterBackground: "var(--background)",
    gutterForeground: "var(--muted-foreground)",
    lineHighlight: "color-mix(in oklch, var(--foreground) 10%, transparent)",
  },
  styles: [
    {
      tag: t.comment,
      color: "var(--muted-foreground)",
    },
    {
      tag: t.string,
      color: "var(--chart-3, var(--primary))",
    },
    {
      tag: t.regexp,
      color: "var(--chart-2, var(--ring))",
    },
    {
      tag: [t.number, t.bool, t.null],
      color: "var(--chart-1, var(--primary))",
    },
    {
      tag: t.variableName,
      color: "var(--foreground)",
    },
    {
      tag: [t.definitionKeyword, t.modifier],
      color: "var(--ring)",
    },
    {
      tag: [t.keyword, t.special(t.brace)],
      color: "var(--primary)",
    },
    {
      tag: t.operator,
      color: "var(--primary)",
    },
    {
      tag: t.separator,
      color: "var(--muted-foreground)",
    },
    {
      tag: t.punctuation,
      color: "var(--foreground)",
    },
    {
      tag: [t.definition(t.propertyName), t.function(t.variableName)],
      color: "var(--chart-2, var(--ring))",
    },
    {
      tag: [t.className, t.definition(t.typeName)],
      color: "var(--chart-1, var(--primary))",
    },
    {
      tag: [t.tagName, t.typeName, t.self, t.labelName],
      color: "var(--chart-4, var(--primary))",
    },
    {
      tag: t.angleBracket,
      color:
        "color-mix(in oklch, var(--chart-4, var(--primary)) 50%, transparent)",
    },
    {
      tag: t.attributeName,
      color: "var(--chart-2, var(--ring))",
    },
  ],
})

export const darkTheme = createTheme({
  variant: "dark",
  settings: {
    background: "var(--background)",
    foreground: "var(--foreground)",
    caret: "var(--foreground)",
    selection: "color-mix(in oklch, var(--ring) 24%, transparent)",
    gutterBackground: "var(--background)",
    gutterForeground: "var(--muted-foreground)",
    lineHighlight: "color-mix(in oklch, var(--foreground) 10%, transparent)",
  },
  styles: [
    {
      tag: t.comment,
      color: "var(--muted-foreground)",
    },
    {
      tag: [t.string, t.special(t.brace), t.regexp],
      color: "var(--chart-3, var(--primary))",
    },
    {
      tag: [
        t.className,
        t.definition(t.propertyName),
        t.function(t.variableName),
        t.function(t.definition(t.variableName)),
        t.definition(t.typeName),
      ],
      color: "var(--chart-1, var(--primary))",
    },
    {
      tag: [t.number, t.bool, t.null],
      color: "var(--chart-2, var(--ring))",
    },
    {
      tag: [t.keyword, t.operator],
      color: "var(--primary)",
    },
    {
      tag: [t.definitionKeyword, t.modifier],
      color: "var(--ring)",
    },
    {
      tag: [t.variableName, t.self],
      color: "var(--foreground)",
    },
    {
      tag: [t.angleBracket, t.tagName, t.typeName, t.propertyName],
      color: "var(--chart-4, var(--primary))",
    },
    {
      tag: t.derefOperator,
      color: "var(--foreground)",
    },
    {
      tag: t.attributeName,
      color: "var(--chart-2, var(--ring))",
    },
  ],
})
