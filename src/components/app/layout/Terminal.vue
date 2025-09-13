<script setup lang="ts">
import XTerminal from "xterminal"

const terminalEl = ref<HTMLElement | null>(null)
const promptPrefix = "user@lectornaut:~ $ "
const term = new XTerminal()
const matches: string[] = []

const promptUser = () => {
  term.write(promptPrefix)
  term.resume()
  term.focus()
}

term.once("load", () => {
  term.writeln("Welcome to Lectornaut CLI")
  term.writeln('Type "help" to see available commands.\n')
  promptUser()
})

const manual = `
  ╱|、
 (˚ˎ 。7
  |、˜〵
  じしˍ,)ノ

Lectornaut CLI is a command line interface (CLI) to interact with Lectornaut.
A lightweight, open-source playload transformer and manager built with web technologies.

 Website: https://lectornaut.com
 Documentation: https://lectornaut.com/docs

Available commands:
 • help......--help......-h......Show this help menu
 • clear.....--clear.....-c......Clear the terminal
 • version...--version...-v......Show version info
 • echo......--echo......-e......Echo the input text
 • js........--js........-j......eval JavaScript code
`

const execute = (term: XTerminal, command = "") => {
  const args = command.split(" ")
  const cmd = args.shift()
  switch (cmd) {
    case "js":
      return new Promise((res, rej) => {
        try {
          const output = eval(args.join(" "))
          res(output)
        } catch (err) {
          rej(err)
        }
      })
    case "help":
      return Promise.resolve(manual)
    case "clear":
      term.clear()
      return Promise.resolve("")
    default:
      return Promise.reject(`"${cmd}" command not found`)
  }
}

onMounted(() => {
  term.mount(terminalEl.value!)
  term.emit("load")
  term.on("data", async (input: string = "") => {
    term.pause()
    await execute(term, input.trim())
      .then((res) => res && term.writeln(res))
      .catch((err) => err && term.writeln("Error: " + err))
      .finally(() => {
        promptUser()
      })
  })
  term.setCompleter((input: string) => {
    if (!matches.length) {
      matches.push(...term.history.filter((c: string) => c.startsWith(input)))
    }
    return matches.pop()
  })
})

onBeforeUnmount(() => {
  term.dispose()
})
</script>

<template>
  <div ref="terminalEl" class="size-full" />
</template>

<style lang="scss">
:root {
  --xt-bg: var(--sidebar);
  --xt-fg: var(--sidebar-foreground);
  --xt-font-size: var(--text-xs);
  --xt-font-family: var(--font-mono);
  --xt-padding: 0.625rem;
}
</style>
