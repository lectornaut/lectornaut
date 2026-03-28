<script lang="ts" setup>
import { useCurrentUser } from "vuefire"
import XTerminal from "xterminal"

const user = useCurrentUser()

const terminalEl = ref<HTMLElement | null>(null)
const promptPrefix = `${user.value?.email} $ `
const term = new XTerminal()
const matches: string[] = []

const promptUser = () => {
  term.write(promptPrefix)
  term.resume()
}

term.once("load", () => {
  term.writeln(`<strong>Welcome to Lectornaut CLI</strong>`)
  term.writeln(
    `<span class="text-secondary-foreground">Type "help" to see available commands.</span>\n`
  )
  promptUser()
})

const manual = `
  ╱|、
 (˚ˎ 。7
  |、˜〵
  じしˍ,)ノ

<strong>Lectornaut CLI</strong> is a command line interface (CLI) to interact with Lectornaut.
A lightweight, open-source playload transformer and manager built with web technologies.

Website: <a href="https://lectornaut.com" target="_blank" rel="noopener" class="text-primary underline">lectornaut.com</a>
Documentation: <a href="https://lectornaut.com/docs" target="_blank" rel="noopener" class="text-primary underline">lectornaut.com/docs</a>

<ul class="list-[square] list-inside marker:text-muted-foreground"><li><span class="text-destructive">help</span> - <span class="text-muted-foreground">show this help menu</span></li><li><span class="text-destructive">js</span> - <span class="text-muted-foreground">eval JavaScript code</span></li><li><span class="text-destructive">clear</span> - <span class="text-muted-foreground">clear the terminal</span></li></ul>`

const execute = (term: XTerminal, command = "") => {
  if (!command) {
    return Promise.resolve("")
  }
  const args = command.split(" ")
  const cmd = args.shift()
  switch (cmd) {
    case "help":
      return Promise.resolve(manual)
    case "js":
      return new Promise((res, rej) => {
        try {
          const output = eval(args.join(" "))
          res(output)
        } catch (err) {
          rej(err)
        }
      })
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
      .then((res) => res && term.writeln(String(res)))
      .catch(
        (err) =>
          err &&
          term.writeln(
            `<span class='text-destructive'>Error: ${XTerminal.escapeHTML(String(err))}</span>`
          )
      )
      .finally(() => {
        promptUser()
      })
  })
  term.setCompleter((input: string) => {
    if (!matches.length) {
      matches.push(...term.history.filter((c: string) => c.startsWith(input)))
    }
    return matches.pop() ?? ""
  })
})

onBeforeUnmount(() => {
  term.dispose()
})
</script>

<template>
  <div ref="terminalEl" class="size-full pl-2" />
</template>

<style lang="scss">
:root {
  --xt-bg: var(--color-background);
  --xt-fg: var(--color-foreground);
  --xt-font-size: calc(var(--size) - 4px);
  --xt-font-family: var(--font-mono);
}
</style>
