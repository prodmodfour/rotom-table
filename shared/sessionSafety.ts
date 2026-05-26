export const SESSION_HOST_ENABLE_ENV = 'ROTOM_ENABLE_SESSION_HOST' as const
export const SESSION_HOST_ENABLE_VALUE = '1' as const
export const SESSION_SAFETY_SCHEMA_VERSION = 1 as const

export type SessionSafetyExposure = 'disabled' | 'local' | 'lan' | 'remote' | 'unknown'
export type SessionSafetySeverity = 'safe' | 'caution' | 'danger'

export interface SessionSafetyStatus {
  readonly schemaVersion: typeof SESSION_SAFETY_SCHEMA_VERSION
  readonly hostEnabled: boolean
  readonly requiredFlag: {
    readonly name: typeof SESSION_HOST_ENABLE_ENV
    readonly value: typeof SESSION_HOST_ENABLE_VALUE
  }
  readonly exposure: SessionSafetyExposure
  readonly severity: SessionSafetySeverity
  readonly requestHost: string | null
  readonly forwardedHost: string | null
  readonly effectiveHost: string | null
  readonly forwarded: boolean
  readonly title: string
  readonly summary: string
  readonly warnings: readonly string[]
  readonly recommendedActions: readonly string[]
}

export interface CreateSessionSafetyStatusInput {
  readonly hostEnabled: boolean
  readonly requestHost?: string | null
  readonly forwardedHost?: string | null
  readonly forwardedProto?: string | null
  readonly forwardedFor?: string | null
  readonly cloudflareRay?: string | null
}

export type SessionSafetyRuntimeEnv = Record<string, string | undefined>

export const isSessionHostFlagEnabled = (
  env: SessionSafetyRuntimeEnv,
): boolean => env[SESSION_HOST_ENABLE_ENV] === SESSION_HOST_ENABLE_VALUE

const firstHeaderValue = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null
  const first = value.split(',')[0]?.trim() ?? ''
  return first.length > 0 ? first : null
}

const normalizeHostHeader = (value: string | null | undefined): string | null => {
  const first = firstHeaderValue(value)
  if (first === null) return null

  const withoutProtocol = first.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const withoutPath = withoutProtocol.split('/')[0]?.trim().toLowerCase() ?? ''
  if (withoutPath.length === 0) return null

  if (withoutPath.startsWith('[')) {
    const bracketEnd = withoutPath.indexOf(']')
    const insideBrackets = bracketEnd > 1 ? withoutPath.slice(1, bracketEnd) : withoutPath.slice(1)
    return insideBrackets.replace(/\.$/, '') || null
  }

  const colonCount = [...withoutPath].filter((character) => character === ':').length
  if (colonCount === 1) {
    return withoutPath.replace(/:\d+$/, '').replace(/\.$/, '') || null
  }

  return withoutPath.replace(/\.$/, '') || null
}

const parseIpv4 = (host: string): readonly [number, number, number, number] | null => {
  const parts = host.split('.')
  if (parts.length !== 4) return null

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN
    const octet = Number(part)
    return Number.isInteger(octet) && octet >= 0 && octet <= 255 ? octet : Number.NaN
  })

  return octets.some(Number.isNaN)
    ? null
    : octets as [number, number, number, number]
}

const isLoopbackHost = (host: string): boolean => {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true

  const ipv4 = parseIpv4(host)
  return ipv4 !== null && ipv4[0] === 127
}

const isLanHost = (host: string): boolean => {
  if (host === '0.0.0.0' || host === '::') return true
  if (host.endsWith('.local')) return true
  if (!host.includes('.') && !host.includes(':')) return true

  const ipv4 = parseIpv4(host)
  if (ipv4 !== null) {
    const [a, b] = ipv4
    return (
      a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
    )
  }

  return (
    host.startsWith('fc')
    || host.startsWith('fd')
    || host.startsWith('fe80')
  )
}

const classifyEnabledExposure = (
  requestHost: string | null,
  forwardedHost: string | null,
  forwarded: boolean,
): Exclude<SessionSafetyExposure, 'disabled'> => {
  const effectiveHost = forwardedHost ?? requestHost
  if (effectiveHost === null) return 'unknown'

  if (isLoopbackHost(effectiveHost)) {
    return forwarded ? 'remote' : 'local'
  }

  if (isLanHost(effectiveHost)) return 'lan'
  return 'remote'
}

const severityForExposure = (exposure: SessionSafetyExposure): SessionSafetySeverity => {
  if (exposure === 'disabled') return 'safe'
  if (exposure === 'local') return 'caution'
  return 'danger'
}

const warningTextForExposure = (exposure: SessionSafetyExposure): readonly string[] => {
  switch (exposure) {
    case 'disabled':
      return [
        `Track 2 session endpoints fail closed until ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} is set.`,
        'The existing GM/player role picker remains a local trust switch, not public authentication.',
      ]
    case 'local':
      return [
        'Track 2 session hosting is enabled for this request, but the host looks local-only.',
        'GM keys and join codes are session-local secrets; keep the GM browser private.',
        'The existing GM/player role picker is still not public authentication.',
      ]
    case 'lan':
      return [
        'Track 2 session hosting is enabled and this request looks reachable on a LAN or same-Wi-Fi address.',
        'Anyone who can reach this Rotom Table server can load the local app; share join codes only with trusted players.',
        'The existing GM/player role picker is still not public authentication.',
      ]
    case 'remote':
      return [
        'Track 2 session hosting is enabled and this request appears to use a public hostname, proxy, or tunnel.',
        'Use a named Cloudflare Tunnel with a stable hostname for campaign play; Quick Tunnel is development smoke-test only.',
        'Do not rely on the local GM/player role picker as public auth; keep the GM session key and browser private.',
      ]
    case 'unknown':
      return [
        'Track 2 session hosting is enabled, but Rotom Table could not classify the request host.',
        'Assume the server may be exposed until you verify the bind address, firewall, and tunnel configuration.',
        'The existing GM/player role picker is still not public authentication.',
      ]
  }
}

const actionTextForExposure = (exposure: SessionSafetyExposure): readonly string[] => {
  switch (exposure) {
    case 'disabled':
      return [
        'Use local-first Rotom Table normally, or restart with the explicit session-host flag only when intentionally hosting.',
      ]
    case 'local':
      return [
        'Keep the server on localhost for private prep, or intentionally bind it for LAN/named-tunnel hosting before sharing join codes.',
        `Unset ${SESSION_HOST_ENABLE_ENV} or stop the server when the hosted session is over.`,
      ]
    case 'lan':
      return [
        'Confirm every player is on the intended LAN/same Wi-Fi before sharing the join code.',
        `Unset ${SESSION_HOST_ENABLE_ENV} or stop the server when the hosted session is over.`,
      ]
    case 'remote':
      return [
        'Confirm the hostname is a named Cloudflare Tunnel or another deliberate private-server exposure path before sharing it.',
        'Rotate the join code by starting a new session if it was shared outside the trusted table.',
      ]
    case 'unknown':
      return [
        'Verify the server bind address, reverse proxy headers, firewall, and tunnel configuration before sharing the lobby.',
        `Unset ${SESSION_HOST_ENABLE_ENV} or stop the server if this exposure is unintended.`,
      ]
  }
}

const titleForExposure = (exposure: SessionSafetyExposure): string => {
  switch (exposure) {
    case 'disabled':
      return 'Session hosting disabled'
    case 'local':
      return 'Session hosting enabled locally'
    case 'lan':
      return 'Session hosting enabled on LAN'
    case 'remote':
      return 'Session hosting exposed remotely'
    case 'unknown':
      return 'Session hosting exposure unknown'
  }
}

const summaryForExposure = (exposure: SessionSafetyExposure, effectiveHost: string | null): string => {
  const hostText = effectiveHost ?? 'unknown host'
  switch (exposure) {
    case 'disabled':
      return 'Session start, join, management, and future socket endpoints are disabled by default.'
    case 'local':
      return `This browser reached Rotom Table through ${hostText}, which looks local to the GM machine.`
    case 'lan':
      return `This browser reached Rotom Table through ${hostText}, which looks reachable on a private LAN.`
    case 'remote':
      return `This browser reached Rotom Table through ${hostText}, which looks publicly exposed or proxied.`
    case 'unknown':
      return 'Rotom Table could not determine whether this request is local, LAN, or remote.'
  }
}

export const createSessionSafetyStatus = (
  input: CreateSessionSafetyStatusInput,
): SessionSafetyStatus => {
  const requestHost = normalizeHostHeader(input.requestHost)
  const forwardedHost = normalizeHostHeader(input.forwardedHost)
  const forwarded = (
    forwardedHost !== null
    || firstHeaderValue(input.forwardedProto) !== null
    || firstHeaderValue(input.forwardedFor) !== null
    || firstHeaderValue(input.cloudflareRay) !== null
  )
  const exposure = input.hostEnabled
    ? classifyEnabledExposure(requestHost, forwardedHost, forwarded)
    : 'disabled'
  const effectiveHost = input.hostEnabled ? forwardedHost ?? requestHost : requestHost

  return {
    schemaVersion: SESSION_SAFETY_SCHEMA_VERSION,
    hostEnabled: input.hostEnabled,
    requiredFlag: {
      name: SESSION_HOST_ENABLE_ENV,
      value: SESSION_HOST_ENABLE_VALUE,
    },
    exposure,
    severity: severityForExposure(exposure),
    requestHost,
    forwardedHost,
    effectiveHost,
    forwarded,
    title: titleForExposure(exposure),
    summary: summaryForExposure(exposure, effectiveHost),
    warnings: warningTextForExposure(exposure),
    recommendedActions: actionTextForExposure(exposure),
  }
}
