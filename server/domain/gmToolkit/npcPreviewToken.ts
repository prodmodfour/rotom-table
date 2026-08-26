import { createHmac, timingSafeEqual } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseNpcGenerationPreviewCommandV1, type NpcGenerationPreviewCommandV1 } from '#shared/gmToolkit/npcGeneration'

export interface NpcPreviewTokenPayloadV1 {
  readonly schemaVersion: 1
  readonly tokenKind: 'npc-generation-preview'
  readonly command: NpcGenerationPreviewCommandV1
  readonly seed: string
  readonly previewHash: string
  readonly issuedAt: string
  readonly expiresAt: string
}
const SHA = /^[a-f0-9]{64}$/
const iso = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${path} must be a normalized ISO instant`)
  return value
}
const sign = (value: string, key: string): string => createHmac('sha256', key).update(value).digest('base64url')
const parsePayload = (value: unknown): NpcPreviewTokenPayloadV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('NPC preview token payload must be an object')
  const row = value as Record<string, unknown>
  const keys = ['schemaVersion', 'tokenKind', 'command', 'seed', 'previewHash', 'issuedAt', 'expiresAt']
  if (Object.keys(row).length !== keys.length || keys.some(key => !(key in row)) || row.schemaVersion !== 1 || row.tokenKind !== 'npc-generation-preview') throw new Error('NPC preview token fields are invalid')
  if (typeof row.seed !== 'string' || !SHA.test(row.seed) || typeof row.previewHash !== 'string' || !SHA.test(row.previewHash)) throw new Error('NPC preview token commitments are invalid')
  const issuedAt = iso(row.issuedAt, 'token.issuedAt'); const expiresAt = iso(row.expiresAt, 'token.expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error('NPC preview expiration must follow issue time')
  return { schemaVersion: 1, tokenKind: 'npc-generation-preview', command: parseNpcGenerationPreviewCommandV1(row.command), seed: row.seed, previewHash: row.previewHash, issuedAt, expiresAt }
}
export const createNpcPreviewToken = (payload: NpcPreviewTokenPayloadV1, key: string): string => {
  if (key.length < 32) throw new Error('GM Toolkit signing key must contain at least 32 characters')
  const encoded = Buffer.from(stableJsonStringify(parsePayload(payload))).toString('base64url')
  return `${encoded}.${sign(encoded, key)}`
}
export const verifyNpcPreviewToken = (token: string, key: string, now: string): NpcPreviewTokenPayloadV1 => {
  if (typeof token !== 'string' || token.length > 32_768) throw new Error('NPC preview token is invalid')
  const [encoded, claimed, extra] = token.split('.')
  if (!encoded || !claimed || extra !== undefined) throw new Error('NPC preview token is invalid')
  const expected = sign(encoded, key); const left = Buffer.from(expected); const right = Buffer.from(claimed)
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('NPC preview token signature is invalid')
  let decoded: unknown
  try { decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) } catch { throw new Error('NPC preview token payload is invalid') }
  const payload = parsePayload(decoded)
  if (Date.parse(iso(now, 'now')) > Date.parse(payload.expiresAt)) throw new Error('NPC preview token expired; request a fresh preview')
  return payload
}
