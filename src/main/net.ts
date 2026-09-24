import { networkInterfaces } from 'node:os'
import type { AppSettings, NetInfo } from '../shared/types'

/** All non-internal IPv4 addresses (Ethernet, Wi-Fi, VPN adapters such as Radmin). */
export function netInfo(): NetInfo {
  const addresses: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address)
    }
  }
  // Prefer classic LAN ranges (192.168.x, 10.x, 172.16-31.x) over VPN/other adapters
  // when guessing, but expose the full list in Settings.
  const lan = addresses.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? null
  return { lanIp: lan ?? addresses[0] ?? null, addresses }
}

/**
 * The host players should use to join: a custom address (e.g. a Radmin VPN IP)
 * when configured, otherwise the machine's LAN IPv4, falling back to localhost.
 * The server itself always binds to all interfaces (server-ip is never set).
 */
export function exposedHost(settings: AppSettings, net: NetInfo): string {
  if (settings.exposeMode === 'custom' && settings.customAddress?.trim()) {
    return settings.customAddress.trim()
  }
  return net.lanIp ?? 'localhost'
}

export function serverAddress(settings: AppSettings, net: NetInfo, port: number): string {
  return `${exposedHost(settings, net)}:${port}`
}

export function localAddress(port: number): string {
  return `localhost:${port}`
}
