<script setup lang="ts">
import { state } from "@/modules/theme"
import { useResizeObserver } from "@vueuse/core"
import { ClipboardAddon } from "@xterm/addon-clipboard"
import { FitAddon } from "@xterm/addon-fit"
import { LigaturesAddon } from "@xterm/addon-ligatures"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

const terminalEl = ref<HTMLElement | null>(null)

const fitAddon = new FitAddon()
const clipboardAddon = new ClipboardAddon()
const ligaturesAddon = new LigaturesAddon()
const webLinksAddon = new WebLinksAddon()
const unicode11Addon = new Unicode11Addon()

const term = new Terminal({
  fontFamily: "var(--font-mono)",
  convertEol: true,
  cursorBlink: true,
  allowProposedApi: true,
  fontSize: 12,
  letterSpacing: -4,
  wordSeparator: " ",
  lineHeight: 1.5,
  cursorStyle: "block",
  cursorInactiveStyle: "underline",
})

const applyTerminalTheme = (mode: string) => {
  const light = {
    background: "oklch(97% 0.001 106.424)",
    foreground: "oklch(26.8% 0.007 34.298)",
    cursor: "oklch(55.3% 0.013 58.071)",
    cursorAccent: "oklch(92.3% 0.003 48.717)",
    selectionBackground: "oklch(92.3% 0.003 48.717)",
    selectionForeground: "oklch(21.6% 0.006 56.043)",
    selectionInactiveBackground: "oklch(92.3% 0.003 48.717)",
  }
  const dark = {
    background: "oklch(14.1% 0.005 285.823)",
    foreground: "oklch(92% 0.004 286.32)",
    cursor: "oklch(55.2% 0.016 285.938)",
    cursorAccent: "oklch(27.4% 0.006 286.033)",
    selectionBackground: "oklch(27.4% 0.006 286.033)",
    selectionForeground: "oklch(70.5% 0.015 286.067)",
    selectionInactiveBackground: "oklch(27.4% 0.006 286.033)",
  }
  term.options.theme = mode === "light" ? light : dark
}

applyTerminalTheme(state.value)

watch(
  () => state.value,
  (mode) => {
    applyTerminalTheme(mode)
  }
)

const promptPrefix = "lectornaut \x1b[90m$\x1b[0m "
let line = ""

onMounted(async () => {
  term.open(terminalEl.value!)
  term.loadAddon(fitAddon)
  fitAddon.fit()
  term.loadAddon(clipboardAddon)
  term.loadAddon(ligaturesAddon)
  term.loadAddon(webLinksAddon)
  term.loadAddon(unicode11Addon)
  term.unicode.activeVersion = "11"
  // 0. show a one-time welcome message
  term.writeln("\r\n\x1b[1mWelcome to Lectornaut CLI\x1b[0m")
  term.writeln('\x1b[90mType "help" to see available commands.\x1b[0m\r\n')
  // 1. show prompt
  term.write(promptPrefix)
  term.onData((e) => {
    // 1. enter = new line
    // 2. backspace = delete character but not the prompt
    // 3. other characters = append to line
    // 4. help menu
    // 5. clear terminal
    switch (e) {
      case "\r": // enter
        term.write("\r\n")
        if (line === "help" || line === "-h") {
          term.writeln("Available commands:")
          term.writeln(
            "\x1b[0m • \x1b[36mhelp\x1b[90m....\x1b[36m-h\x1b[90m........\x1b[0mShow this help menu"
          )
          term.writeln(
            "\x1b[0m • \x1b[36mclear\x1b[90m...\x1b[36m-c\x1b[90m........\x1b[0mClear the terminal"
          )
          term.writeln(
            "\x1b[0m • \x1b[36mecho\x1b[90m....\x1b[36m-e\x1b[90m........\x1b[0mEcho the input text"
          )
        } else if (line.startsWith("echo ")) {
          term.writeln(line.slice(5))
        } else if (line.startsWith("-e ")) {
          term.writeln(line.slice(3))
        } else if (line === "clear" || line === "-c") {
          term.clear()
        } else if (line.length > 0) {
          term.writeln(`Command not found: ${line}`)
        }
        line = ""
        term.write(promptPrefix)
        break
      case "\u007F": // backspace
        // Do not delete the prompt
        if (line.length > 0) {
          term.write("\b \b")
          line = line.slice(0, -1)
        }
        break
      default: // other characters
        if (e >= String.fromCharCode(0x20) && e <= String.fromCharCode(0x7e)) {
          term.write(e)
          line += e
        }
        break
    }
  })

  useResizeObserver(terminalEl, () => {
    console.log("Bottom panel resized")
    fitAddon.fit()
  })
})

onBeforeUnmount(() => {
  term?.dispose()
})
</script>

<template>
  <div ref="terminalEl" class="size-full"></div>
</template>
