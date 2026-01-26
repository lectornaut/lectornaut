export type ImageValidationResult =
  | { ok: true }
  | { ok: false; message: string }

export function validateImageFile(
  file: File | null | undefined,
  maxSize = 5 * 1024 * 1024
): ImageValidationResult {
  if (!file) return { ok: false, message: "No file provided." }
  if (!file.type || !file.type.startsWith("image/")) {
    return { ok: false, message: "Only image files are allowed." }
  }
  if (file.size > maxSize) {
    return {
      ok: false,
      message: `Image must be less than ${Math.round(maxSize / (1024 * 1024))}MB.`,
    }
  }
  return { ok: true }
}
