import { clsx, twMerge } from "cnfast"

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(...inputs))
}
