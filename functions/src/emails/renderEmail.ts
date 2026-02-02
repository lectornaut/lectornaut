import fs from "fs"
import Handlebars from "handlebars"
import mjml2html from "mjml"
import path, { dirname } from "path"
import { fileURLToPath } from "url"

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
  const baseDir = dirname(fileURLToPath(import.meta.url))

  const templatePath = path.join(baseDir, "templates", `${templateName}.mjml`)

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}`)
  }

  const templateContent = fs.readFileSync(templatePath, "utf8")

  // Add global variables
  const templateData = {
    year: new Date().getFullYear(),
    ...data,
  }

  // Compile the MJML with Handlebars first to inject variables
  // We use Handlebars to replace {{variables}} inside the MJML structure
  const compiledTemplate = Handlebars.compile(templateContent)
  const mjmlContent = compiledTemplate(templateData)

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
