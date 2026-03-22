import type { Timestamp } from "firebase/firestore"

export type DeviceType = "desktop" | "mobile" | "tablet"

export interface IUserSession {
  id: string
  deviceName: string
  browser: string
  os: string
  deviceType: DeviceType
  ip: string
  createdAt: Timestamp
  lastActiveAt: Timestamp
}
