/**
 * Outbound HTTP for destinations a tenant controls (custom-tool webhooks,
 * SSO discovery). Refuses loopback, private, link-local (incl. the GCP
 * metadata server) and other non-public addresses.
 *
 * The check runs inside the socket's DNS `lookup`, so the address that is
 * validated is the address that is connected — a DNS-rebinding answer
 * can't swap in an internal IP between check and connect. IP-literal hosts
 * skip `lookup` in Node, so they're checked up front. Redirects are never
 * followed (a 3xx is returned as-is), and the body is capped while reading.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import http from "node:http"
import https from "node:https"
import { BlockList, isIP } from "node:net"

const blocked = new BlockList()
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4")
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6")
}

const BLOCKED_HEADERS = /^(metadata-flavor|x-google-metadata-request)$/i

export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "")
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) return blocked.check(mapped[1], "ipv4")
  const family = isIP(ip)
  if (family === 4) return blocked.check(ip, "ipv4")
  if (family === 6) return blocked.check(ip, "ipv6")
  return true
}

export class BlockedDestinationError extends Error {
  constructor(message = "Destination address is not allowed.") {
    super(message)
    this.name = "BlockedDestinationError"
  }
}

const guardedLookup: NonNullable<http.RequestOptions["lookup"]> = (
  hostname,
  options,
  callback
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0)
    const list = addresses as LookupAddress[]
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new BlockedDestinationError(), "", 0)
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(
        null,
        list
      )
    }
    callback(null, list[0].address, list[0].family)
  })
}

export interface SafeFetchResult {
  status: number
  ok: boolean
  body: Buffer
  truncated: boolean
}

export function safeFetch(
  rawUrl: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
    maxBytes: number
  }
): Promise<SafeFetchResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return Promise.reject(new BlockedDestinationError("Invalid URL."))
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return Promise.reject(
      new BlockedDestinationError("Only http(s) URLs are allowed.")
    )
  }
  if (url.username || url.password) {
    return Promise.reject(
      new BlockedDestinationError("URLs with credentials are not allowed.")
    )
  }
  if (
    isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
    isBlockedAddress(url.hostname)
  ) {
    return Promise.reject(new BlockedDestinationError())
  }
  for (const name of Object.keys(init.headers ?? {})) {
    if (BLOCKED_HEADERS.test(name)) {
      return Promise.reject(
        new BlockedDestinationError(`Header "${name}" is not allowed.`)
      )
    }
  }

  const transport = url.protocol === "https:" ? https : http
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        signal: init.signal,
        lookup: guardedLookup,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        res.on("data", (chunk: Buffer) => {
          if (truncated) return
          const room = init.maxBytes - size
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room))
            size += room
            truncated = true
            res.destroy()
            finish()
            return
          }
          chunks.push(chunk)
          size += chunk.length
        })
        let done = false
        const finish = () => {
          if (done) return
          done = true
          const status = res.statusCode ?? 0
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: Buffer.concat(chunks),
            truncated,
          })
        }
        res.on("end", finish)
        res.on("error", (e) => (truncated ? finish() : reject(e)))
      }
    )
    req.on("error", reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}
