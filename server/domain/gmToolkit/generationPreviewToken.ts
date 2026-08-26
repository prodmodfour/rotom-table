import { createHmac, timingSafeEqual } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseWildGenerationPreviewCommandV1, type WildGenerationPreviewCommandV1 } from '#shared/gmToolkit/generation'

export interface WildGenerationPreviewTokenPayloadV1 {
  readonly schemaVersion: 1
  readonly tokenKind: 'wild-generation-preview'
  readonly command: WildGenerationPreviewCommandV1
  readonly seed: string
  readonly previewHash: string
  readonly issuedAt: string
  readonly expiresAt: string
}

const SHA256 = /^[a-f0-9]{64}$/
const iso = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${path} must be a normalized ISO instant`)
  return value
}
const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')
const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8')
const signature = (payload: string, key: string): string => createHmac('sha256', key).update(payload).digest('base64url')

export const createWildGenerationPreviewToken = (
  payload: WildGenerationPreviewTokenPayloadV1,
  signingKey: string,
): string => {
  if (typeof signingKey !== 'string' || signingKey.length < 32) throw new Error('GM Toolkit signing key must contain at least 32 characters')
  const normalized = parseWildGenerationPreviewTokenPayload(payload)
  const encoded = encode(stableJsonStringify(normalized))
  return `${encoded}.${signature(encoded, signingKey)}`
}

export const parseWildGenerationPreviewTokenPayload = (value: unknown): WildGenerationPreviewTokenPayloadV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Preview token payload must be an object')
  const row = value as Record<string, unknown>
  const keys = ['schemaVersion', 'tokenKind', 'command', 'seed', 'previewHash', 'issuedAt', 'expiresAt']
  if (Object.keys(row).length !== keys.length || keys.some(key => !(key in row))) throw new Error('Preview token payload fields are invalid')
  if (row.schemaVersion !== 1 || row.tokenKind !== 'wild-generation-preview') throw new Error('Preview token kind or version is unsupported')
  if (typeof row.seed !== 'string' || !SHA256.test(row.seed)) throw new Error('Preview token seed is invalid')
  if (typeof row.previewHash !== 'string' || !SHA256.test(row.previewHash)) throw new Error('Preview token hash is invalid')
  const issuedAt = iso(row.issuedAt, 'previewToken.issuedAt')
  const expiresAt = iso(row.expiresAt, 'previewToken.expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error('Preview token expiration must follow issue time')
  return {
    schemaVersion: 1,
    tokenKind: 'wild-generation-preview',
    command: parseWildGenerationPreviewCommandV1(row.command),
    seed: row.seed,
    previewHash: row.previewHash,
    issuedAt,
    expiresAt,
  }
}

export const verifyWildGenerationPreviewToken = (
  token: string,
  signingKey: string,
  now: string,
): WildGenerationPreviewTokenPayloadV1 => {
  if (typeof token !== 'string' || token.length > 16_384) throw new Error('Preview token is invalid')
  const [encoded, claimed, extra] = token.split('.')
  if (!encoded || !claimed || extra !== undefined) throw new Error('Preview token is invalid')
  const expected = signature(encoded, signingKey)
  const expectedBytes = Buffer.from(expected)
  const claimedBytes = Buffer.from(claimed)
  if (expectedBytes.length !== claimedBytes.length || !timingSafeEqual(expectedBytes, claimedBytes)) throw new Error('Preview token signature is invalid')
  let parsed: unknown
  try { parsed = JSON.parse(decode(encoded)) }
  catch { throw new Error('Preview token payload is invalid') }
  const payload = parseWildGenerationPreviewTokenPayload(parsed)
  if (Date.parse(iso(now, 'now')) > Date.parse(payload.expiresAt)) throw new Error('Preview token expired; request a fresh preview')
  return payload
}
