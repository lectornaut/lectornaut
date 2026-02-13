import Handlebars from "handlebars"
import mjml2html from "mjml"
import fs from "node:fs"
import path, { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const baseDir = dirname(fileURLToPath(import.meta.url))
const templatesDir = path.join(baseDir, "templates")
const templateContentCache = new Map<string, string>()
const compiledTemplateCache = new Map<
  string,
  ReturnType<typeof Handlebars.compile>
>()

function getTemplatePath(templateName: string): string {
  return path.join(templatesDir, `${templateName}.mjml`)
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
  } catch (_error) {
    throw new Error(`Email template not found: ${templateName}`)
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
 * @param templateName The name of the template file (without extension)
 * @param data The data to inject into the template
 * @returns The rendered HTML string
 */
export const renderEmail = (
  templateName: string,
  data: Record<string, unknown>
): string => {
  const templatePath = getTemplatePath(templateName)
  const compiledMjmlTemplate = getCompiledMjmlTemplate(templateName)

  // Add global variables
  const templateData = {
    year: new Date().getFullYear(),
    ...data,
  }

  // Compile the MJML with Handlebars first to inject variables
  // We use Handlebars to replace {{variables}} inside the MJML structure
  const mjmlContent = compiledMjmlTemplate(templateData)

  const { html, errors } = mjml2html(mjmlContent, {
    filePath: path.dirname(templatePath),
  })

  if (errors?.length) {
    throw new Error(`MJML compilation failed for ${templateName}`)
  }

  // Final Handlebars pass to catch variables inside included partials
  const finalTemplate = Handlebars.compile(html)
  return finalTemplate(templateData)
}
