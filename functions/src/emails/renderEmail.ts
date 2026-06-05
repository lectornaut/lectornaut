import Handlebars from "handlebars"
import mjml2html from "mjml"
import fs from "node:fs"
import path, { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const baseDir = dirname(fileURLToPath(import.meta.url))
// In source this module lives at `src/emails/`, so templates are a sibling
// `templates/` dir. esbuild bundles everything into a single
// `functions-deploy/index.js` at the deploy root, so this module is flattened
// there and the build copies templates to `<root>/emails/templates` instead.
// Resolve whichever layout actually exists so rendering works in both the dev
// source tree and the deployed bundle.
const templatesDir =
  [
    path.join(baseDir, "templates"),
    path.join(baseDir, "emails", "templates"),
  ].find((dir) => fs.existsSync(dir)) ?? path.join(baseDir, "templates")
const templateContentCache = new Map<string, string>()
const compiledTemplateCache = new Map<
  string,
  ReturnType<typeof Handlebars.compile>
>()

function getTemplatePath(templateName: string): string {
  if (!/^[a-z0-9._-]+$/i.test(templateName)) {
    throw new Error(`Invalid template name: ${templateName}`)
  }

  const resolved = path.resolve(templatesDir, `${templateName}.mjml`)
  if (!resolved.startsWith(templatesDir)) {
    throw new Error(`Invalid template name: ${templateName}`)
  }

  return resolved
}

function getTemplateContent(templateName: string): string {
  const cached = templateContentCache.get(templateName)
  if (cached) {
    return cached
  }

  const templatePath = getTemplatePath(templateName)
  let templateContent: string

  try {
    templateContent = fs.readFileSync(templatePath, "utf8")
  } catch (error) {
    throw new Error(`Email template not found: ${templateName}`, {
      cause: error,
    })
  }

  templateContentCache.set(templateName, templateContent)
  return templateContent
}

function getCompiledMjmlTemplate(templateName: string) {
  const cached = compiledTemplateCache.get(templateName)
  if (cached) {
    return cached
  }

  const compiled = Handlebars.compile(getTemplateContent(templateName))
  compiledTemplateCache.set(templateName, compiled)
  return compiled
}

export function preloadEmailTemplates(): void {
  const entries = fs.readdirSync(templatesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mjml")) {
      continue
    }

    const templateName = entry.name.slice(0, -".mjml".length)
    getCompiledMjmlTemplate(templateName)
  }
}

/**
 * Renders an MJML email template with the provided data.
 *
 * MJML v5+ exposes `mjml2html` as async, so this function awaits it.
 *
 * @param templateName The name of the template file (without extension)
 * @param data The data to inject into the template
 * @returns The rendered HTML string
 */
export const renderEmail = async (
  templateName: string,
  data: Record<string, unknown>
): Promise<string> => {
  const compiledMjmlTemplate = getCompiledMjmlTemplate(templateName)

  // Add global variables
  const templateData = {
    year: new Date().getFullYear(),
    ...data,
  }

  // Compile the MJML with Handlebars first to inject variables
  // We use Handlebars to replace {{variables}} inside the MJML structure
  const mjmlContent = compiledMjmlTemplate(templateData)

  const { html, errors } = await mjml2html(mjmlContent, {
    filePath: templatesDir,
  })

  if (errors?.length) {
    throw new Error(`MJML compilation failed for ${templateName}`)
  }

  // Final Handlebars pass to catch variables inside included partials
  const finalTemplate = Handlebars.compile(html)
  return finalTemplate(templateData)
}
