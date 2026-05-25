<script lang="ts" setup>
import { useCurrentUser } from "vuefire"
import XTerminal from "xterminal"

const { t } = useI18n()
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
  term.writeln(`<strong>${t("components.terminal.welcome")}</strong>`)
  term.writeln(
    `<span class="text-secondary-foreground">${t("components.terminal.typeHelp")}</span>\n`
  )
  promptUser()
})

const manual = `

  ╱|、
 (˚ˎ 。7
  |、˜〵
  じしˍ,)ノ

<strong>${t("components.terminal.helpHeader")}</strong> ${t("components.terminal.helpIntro")}
${t("components.terminal.helpDescription")}

${t("components.terminal.website")}: <a href="https://lectornaut.com" target="_blank" rel="noopener" class="text-primary underline">lectornaut.com</a>
${t("components.terminal.documentation")}: <a href="https://lectornaut.com/docs" target="_blank" rel="noopener" class="text-primary underline">lectornaut.com/docs</a>

<ul class="list-[square] list-inside marker:text-muted-foreground"><li><span class="text-destructive">help</span> - <span class="text-muted-foreground">${t("components.terminal.helpCmd")}</span></li><li><span class="text-destructive">js</span> - <span class="text-muted-foreground">${t("components.terminal.jsCmd")}</span></li><li><span class="text-destructive">clear</span> - <span class="text-muted-foreground">${t("components.terminal.clearCmd")}</span></li></ul>`

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
          // Indirect eval: runs in global scope, lets the bundler minify the
          // surrounding scope, and prevents leaking setup-locals to the CLI.
          const output = (0, eval)(args.join(" "))
          res(output)
        } catch (err) {
          rej(err)
        }
      })
    case "clear":
      term.clear()
      return Promise.resolve("")
    default:
      return Promise.reject(t("components.terminal.commandNotFound", { cmd }))
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

<style>
:root {
  --xt-bg: var(--color-background);
  --xt-fg: var(--color-foreground);
  --xt-font-size: calc(var(--size) - 3px);
  --xt-font-family: var(--font-mono);
}
@keyframes blink {
  0% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

.xt-cursor {
  animation: blink 0.8s linear infinite;
}
</style>
