import { isTauri } from "@/composables/usePlatform"
import type { DeviceType } from "@/types/session"
import { hostname, platform, version } from "@tauri-apps/plugin-os"

interface ParsedUserAgent {
  browser: string
  os: string
  deviceName: string
  deviceType: DeviceType
}

export async function parseUserAgent(ua?: string): Promise<ParsedUserAgent> {
  if (isTauri.value) {
    return parseTauriDevice()
  }

  const raw = ua || navigator.userAgent
  const browser = parseBrowser(raw)
  const os = parseOS(raw)
  const deviceType = parseDeviceType(raw)
  const deviceName = `${browser} on ${os}`

  return { browser, os, deviceName, deviceType }
}

async function parseTauriDevice(): Promise<ParsedUserAgent> {
  try {
    const [p, v, h] = await Promise.all([platform(), version(), hostname()])

    const os = formatTauriOS(p, v)
    const browser = h ? `${h}` : "Desktop app"
    const deviceName = `${browser} on ${os}`

    return { browser, os, deviceName, deviceType: "desktop" }
  } catch {
    // Fallback if plugin unavailable
    return {
      browser: "Desktop app",
      os: parseOS(navigator.userAgent),
      deviceName: `Desktop app on ${parseOS(navigator.userAgent)}`,
      deviceType: "desktop",
    }
  }
}

function formatTauriOS(platform: string, version: string): string {
  const v = version || ""
  switch (platform) {
    case "macos":
      return v ? `macOS ${v}` : "macOS"
    case "windows":
      return v ? `Windows ${v}` : "Windows"
    case "linux":
      return v ? `Linux ${v}` : "Linux"
    case "android":
      return v ? `Android ${v}` : "Android"
    case "ios":
      return v ? `iOS ${v}` : "iOS"
    default:
      return v ? `${platform} ${v}` : platform || "Unknown OS"
  }
}

function parseBrowser(ua: string): string {
  // Order matters: check more specific browsers first
  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/)
  if (edgeMatch) return `Edge ${edgeMatch[1]}`

  const operaMatch = ua.match(/OPR\/(\d+)/)
  if (operaMatch) return `Opera ${operaMatch[1]}`

  const chromeMatch = ua.match(/Chrome\/(\d+)/)
  const safariMatch = ua.match(/Safari\//)
  const firefoxMatch = ua.match(/Firefox\/(\d+)/)

  if (firefoxMatch) return `Firefox ${firefoxMatch[1]}`
  if (chromeMatch && safariMatch) return `Chrome ${chromeMatch[1]}`

  const safariVersionMatch = ua.match(/Version\/(\d+).*Safari/)
  if (safariVersionMatch) return `Safari ${safariVersionMatch[1]}`

  if (chromeMatch) return `Chrome ${chromeMatch[1]}`

  return "Unknown Browser"
}

function parseOS(ua: string): string {
  if (ua.includes("iPhone") || ua.includes("iPad")) {
    const match = ua.match(/OS (\d+[_.\d]*)/)
    if (match) return `iOS ${match[1].replace(/_/g, ".")}`
    return "iOS"
  }

  if (ua.includes("Android")) {
    const match = ua.match(/Android (\d+[\d.]*)/)
    if (match) return `Android ${match[1]}`
    return "Android"
  }

  if (ua.includes("Mac OS X") || ua.includes("Macintosh")) {
    const match = ua.match(/Mac OS X (\d+[_.\d]*)/)
    if (match) return `macOS ${match[1].replace(/_/g, ".")}`
    return "macOS"
  }

  if (ua.includes("Windows")) {
    if (ua.includes("Windows NT 10.0")) return "Windows 10+"
    if (ua.includes("Windows NT 6.3")) return "Windows 8.1"
    if (ua.includes("Windows NT 6.1")) return "Windows 7"
    return "Windows"
  }

  if (ua.includes("CrOS")) return "ChromeOS"
  if (ua.includes("Linux")) return "Linux"

  return "Unknown OS"
}

function parseDeviceType(ua: string): DeviceType {
  if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) return "mobile"
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return "tablet"
  return "desktop"
}
