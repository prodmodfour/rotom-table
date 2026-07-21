import { parseAbilityDeclarationOffer, type AbilityDeclarationOffer } from '#shared/abilityAutomation/declarationIntent'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredAbilityDeclarationOffer {
  readonly requestId: string
  readonly requestSha256: string
  readonly offer: AbilityDeclarationOffer
  readonly consumedIntentSha256: string | null
  readonly consumedAt: number | null
}
export interface AbilityDeclarationOfferRepository {
  readonly database?: RotomDatabase
  readonly findByOfferId: (offerId: string) => StoredAbilityDeclarationOffer | null
  readonly findByRequestId: (requestId: string) => StoredAbilityDeclarationOffer | null
  readonly insert: (input: { readonly requestId: string; readonly requestSha256: string; readonly offer: AbilityDeclarationOffer }) => StoredAbilityDeclarationOffer
  readonly consume: (offerId: string, intentSha256: string, consumedAt: number) => StoredAbilityDeclarationOffer
  readonly deleteExpired: (now: number) => number
}
interface OfferRow {
  readonly request_id: unknown
  readonly request_sha256: unknown
  readonly offer_json: unknown
  readonly map_slug: unknown
  readonly map_revision: unknown
  readonly actor_placement_id: unknown
  readonly created_at: unknown
  readonly expires_at: unknown
  readonly consumed_intent_sha256: unknown
  readonly consumed_at: unknown
}
const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const stableId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || !ID.test(value)) throw new Error(`${label} must be a stable ID.`)
  return value
}
const hash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be SHA-256.`)
  return value
}
const timestamp = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer.`)
  return Number(value)
}
const rowToRecord = (row: OfferRow | undefined): StoredAbilityDeclarationOffer | null => {
  if (!row) return null
  if (typeof row.offer_json !== 'string') throw new Error('ability declaration offer_json must be text.')
  const offer = parseAbilityDeclarationOffer(JSON.parse(row.offer_json))
  const requestId = stableId(row.request_id, 'ability declaration request ID')
  const requestSha256 = hash(row.request_sha256, 'ability declaration request hash')
  if (row.map_slug !== offer.mapSlug || row.map_revision !== offer.mapRevision
    || row.actor_placement_id !== offer.actorPlacementId
    || row.created_at !== offer.createdAt || row.expires_at !== offer.expiresAt
    || stableJsonStringify(offer) !== row.offer_json) {
    throw new Error('Ability declaration offer indexed columns or canonical JSON do not match.')
  }
  const consumedIntentSha256 = row.consumed_intent_sha256 === null
    ? null : hash(row.consumed_intent_sha256, 'consumed ability intent hash')
  const consumedAt = row.consumed_at === null ? null : timestamp(row.consumed_at, 'ability declaration consumed_at')
  if ((consumedIntentSha256 === null) !== (consumedAt === null)) throw new Error('Ability declaration consumption columns disagree.')
  return Object.freeze({ requestId, requestSha256, offer, consumedIntentSha256, consumedAt })
}
const columns = `request_id, request_sha256, offer_json, map_slug, map_revision,
  actor_placement_id, created_at, expires_at, consumed_intent_sha256, consumed_at`
export const createSqliteAbilityDeclarationOfferRepository = (
  database: RotomDatabase = getRotomDatabase(),
): AbilityDeclarationOfferRepository => {
  const by = (column: 'offer_id' | 'request_id', value: string): StoredAbilityDeclarationOffer | null => {
    const id = stableId(value, `ability declaration ${column}`)
    const row = database.connection.prepare(`SELECT ${columns} FROM ability_declaration_offers WHERE ${column} = ?`).get(id) as unknown as OfferRow | undefined
    return rowToRecord(row)
  }
  const findByOfferId = (id: string) => by('offer_id', id)
  const findByRequestId = (id: string) => by('request_id', id)
  const insert: AbilityDeclarationOfferRepository['insert'] = input => database.withTransaction(() => {
    const requestId = stableId(input.requestId, 'ability declaration request ID')
    const requestSha256 = hash(input.requestSha256, 'ability declaration request hash')
    const offer = parseAbilityDeclarationOffer(input.offer)
    database.connection.prepare(`
      INSERT INTO ability_declaration_offers (
        offer_id, request_id, request_sha256, map_slug, map_revision, actor_placement_id,
        offer_json, created_at, expires_at, consumed_intent_sha256, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(offer.offerId, requestId, requestSha256, offer.mapSlug, offer.mapRevision,
      offer.actorPlacementId, stableJsonStringify(offer), offer.createdAt, offer.expiresAt)
    return findByOfferId(offer.offerId)!
  })
  const consume: AbilityDeclarationOfferRepository['consume'] = (offerId, intentSha256, consumedAt) => database.withTransaction(() => {
    const id = stableId(offerId, 'ability declaration offer ID')
    const intentHash = hash(intentSha256, 'ability declaration intent hash')
    const at = timestamp(consumedAt, 'ability declaration consumedAt')
    const existing = findByOfferId(id)
    if (!existing) throw new Error(`Ability declaration offer ${id} is missing.`)
    if (existing.consumedIntentSha256 !== null) {
      if (existing.consumedIntentSha256 === intentHash) return existing
      throw new Error(`Ability declaration offer ${id} was consumed by another intent.`)
    }
    database.connection.prepare(`UPDATE ability_declaration_offers SET consumed_intent_sha256 = ?, consumed_at = ? WHERE offer_id = ? AND consumed_intent_sha256 IS NULL`).run(intentHash, at, id)
    return findByOfferId(id)!
  })
  const deleteExpired = (now: number): number => database.withTransaction(() => Number(
    database.connection.prepare('DELETE FROM ability_declaration_offers WHERE expires_at < ?').run(timestamp(now, 'ability declaration expiry time')).changes,
  ))
  return { database, findByOfferId, findByRequestId, insert, consume, deleteExpired }
}
