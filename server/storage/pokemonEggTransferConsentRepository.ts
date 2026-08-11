import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parsePokemonEggIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
  type PokemonEggId,
  type PokemonEggTransferConsentId,
} from '#shared/breeding/ids'
import type { PokemonEggTransferConsentV1 } from '#shared/breeding/eggTransfer'
import { isSlug } from '#shared/paths'
import {
  parseAuthoritativePokemonEggTransferConsentV1,
  validatePokemonEggTransferConsentSuccessor,
} from '../domain/breeding/eggTransfer'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryIdentityCollisionError,
  assertBreedingStoredColumn,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryLimit,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
  type BreedingRepositoryReplaceResult,
} from './breedingRepositorySupport'

interface PokemonEggTransferConsentRow {
  readonly consent_id: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly role: unknown
  readonly egg_id: unknown
  readonly egg_revision: unknown
  readonly source_trainer_slug: unknown
  readonly destination_trainer_slug: unknown
  readonly consenting_profile_id: unknown
  readonly expires_at_campaign_minute: unknown
  readonly settlement_operation_id: unknown
}

export interface PokemonEggTransferConsentRepository {
  readonly database: RotomDatabase
  get(consentId: PokemonEggTransferConsentId | string): PokemonEggTransferConsentV1 | null
  listByEgg(eggId: PokemonEggId | string, limit?: number): readonly PokemonEggTransferConsentV1[]
  listActiveByParticipant(trainerSlug: string, limit?: number): readonly PokemonEggTransferConsentV1[]
  insert(consent: PokemonEggTransferConsentV1): PokemonEggTransferConsentV1
  replace(input: {
    readonly expectedRevision: number
    readonly consent: PokemonEggTransferConsentV1
  }): BreedingRepositoryReplaceResult<PokemonEggTransferConsentV1>
}

export class PokemonEggTransferConsentRepositoryTransactionError extends Error {
  constructor() {
    super('Egg-transfer consent mutation requires a caller-owned SQLite transaction.')
    this.name = 'PokemonEggTransferConsentRepositoryTransactionError'
  }
}

const TABLE = 'pokemon_egg_transfer_consents'
const SELECT = `
  SELECT consent_id, document_json, definition_sha256, revision, status, role, egg_id,
         egg_revision, source_trainer_slug, destination_trainer_slug, consenting_profile_id,
         expires_at_campaign_minute, settlement_operation_id
  FROM pokemon_egg_transfer_consents
`
const consentId = (value: unknown): PokemonEggTransferConsentId => (
  parsePokemonEggTransferConsentIdSyntax(value)
  ?? (() => { throw new Error('consentId must be an Egg-transfer consent ID.') })()
)
const eggId = (value: unknown): PokemonEggId => parsePokemonEggIdSyntax(value)
  ?? (() => { throw new Error('eggId must be a Pokémon Egg ID.') })()
const slug = (value: unknown): string => isSlug(value) && value.length <= 160
  ? value
  : (() => { throw new Error('trainerSlug must be one bounded canonical sheet slug.') })()

const rowToConsent = (row: PokemonEggTransferConsentRow): PokemonEggTransferConsentV1 => {
  const identity = consentId(row.consent_id)
  const consent = parseStrictStoredBreedingJson({
    table: TABLE,
    identity,
    json: row.document_json,
    parse: parseAuthoritativePokemonEggTransferConsentV1,
  })
  const revision = parseBreedingRepositoryRevision(row.revision, `${TABLE}.${identity}.revision`)
  const storedEggRevision = parseBreedingRepositoryRevision(row.egg_revision, `${TABLE}.${identity}.egg_revision`)
  assertBreedingStoredColumn(consent.consentId === identity, TABLE, identity, 'consent_id')
  assertBreedingStoredColumn(consent.definitionSha256 === row.definition_sha256, TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(consent.revision === revision, TABLE, identity, 'revision')
  assertBreedingStoredColumn(consent.status === row.status && consent.role === row.role, TABLE, identity, 'status/role')
  assertBreedingStoredColumn(consent.eggId === row.egg_id && consent.eggRevision === storedEggRevision, TABLE, identity, 'egg')
  assertBreedingStoredColumn(consent.sourceTrainerSlug === row.source_trainer_slug, TABLE, identity, 'source_trainer_slug')
  assertBreedingStoredColumn(consent.destinationTrainerSlug === row.destination_trainer_slug, TABLE, identity, 'destination_trainer_slug')
  assertBreedingStoredColumn(consent.consentingProfileId === row.consenting_profile_id, TABLE, identity, 'consenting_profile_id')
  assertBreedingStoredColumn(consent.expiresAtCampaignMinute === row.expires_at_campaign_minute, TABLE, identity, 'expires_at_campaign_minute')
  assertBreedingStoredColumn(consent.settlementOperationId === row.settlement_operation_id, TABLE, identity, 'settlement_operation_id')
  return consent
}
const values = (consent: PokemonEggTransferConsentV1): readonly (string | number | null)[] => [
  consent.consentId,
  stableJsonStringify(consent),
  consent.definitionSha256,
  consent.revision,
  consent.status,
  consent.role,
  consent.eggId,
  consent.eggRevision,
  consent.sourceTrainerSlug,
  consent.destinationTrainerSlug,
  consent.consentingProfileId,
  consent.expiresAtCampaignMinute,
  consent.settlementOperationId,
]

export const createSqlitePokemonEggTransferConsentRepository = (
  database: RotomDatabase = getRotomDatabase(),
): PokemonEggTransferConsentRepository => {
  const get = (input: PokemonEggTransferConsentId | string): PokemonEggTransferConsentV1 | null => {
    const identity = consentId(input)
    const row = database.connection.prepare(`${SELECT} WHERE consent_id = ?`).get(identity) as unknown as PokemonEggTransferConsentRow | undefined
    return row ? rowToConsent(row) : null
  }
  const listByEgg = (input: PokemonEggId | string, limitInput?: number): readonly PokemonEggTransferConsentV1[] => {
    const identity = eggId(input)
    const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT}
      WHERE egg_id = ?
      ORDER BY egg_revision DESC, role ASC, consent_id ASC
      LIMIT ?
    `).all(identity, limit) as unknown as PokemonEggTransferConsentRow[]).map(rowToConsent)
  }
  const listActiveByParticipant = (input: string, limitInput?: number): readonly PokemonEggTransferConsentV1[] => {
    const trainer = slug(input)
    const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT}
      WHERE status = 'active' AND (source_trainer_slug = ? OR destination_trainer_slug = ?)
      ORDER BY expires_at_campaign_minute ASC, consent_id ASC
      LIMIT ?
    `).all(trainer, trainer, limit) as unknown as PokemonEggTransferConsentRow[]).map(rowToConsent)
  }
  const insert = (input: PokemonEggTransferConsentV1): PokemonEggTransferConsentV1 => {
    if (!database.connection.isTransaction) throw new PokemonEggTransferConsentRepositoryTransactionError()
    const consent = parseAuthoritativePokemonEggTransferConsentV1(input)
    if (consent.revision !== 0 || consent.status !== 'active') {
      throw new BreedingRepositoryIdentityCollisionError('Egg-transfer consent initial state', consent.consentId)
    }
    const existing = get(consent.consentId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, consent)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Egg-transfer consent', consent.consentId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO pokemon_egg_transfer_consents (
          consent_id, document_json, definition_sha256, revision, status, role, egg_id,
          egg_revision, source_trainer_slug, destination_trainer_slug, consenting_profile_id,
          expires_at_campaign_minute, settlement_operation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values(consent))
    }
    catch (error) {
      const raced = get(consent.consentId)
      if (raced && exactBreedingDocumentReplay(raced, consent)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Egg-transfer consent', consent.consentId)
      throw error
    }
    return get(consent.consentId)
      ?? (() => { throw new Error('Inserted Egg-transfer consent was not readable.') })()
  }
  const replace: PokemonEggTransferConsentRepository['replace'] = input => {
    if (!database.connection.isTransaction) throw new PokemonEggTransferConsentRepositoryTransactionError()
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const proposed = parseAuthoritativePokemonEggTransferConsentV1(input.consent)
    const current = get(proposed.consentId)
    if (!current) return Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
    if (current.revision !== expectedRevision) {
      return Object.freeze({ kind: 'stale', expectedRevision, currentRevision: current.revision })
    }
    const consent = validatePokemonEggTransferConsentSuccessor(current, proposed)
    const result = database.connection.prepare(`
      UPDATE pokemon_egg_transfer_consents SET
        document_json = ?, definition_sha256 = ?, revision = ?, status = ?, role = ?, egg_id = ?,
        egg_revision = ?, source_trainer_slug = ?, destination_trainer_slug = ?, consenting_profile_id = ?,
        expires_at_campaign_minute = ?, settlement_operation_id = ?
      WHERE consent_id = ? AND revision = ?
    `).run(
      stableJsonStringify(consent), consent.definitionSha256, consent.revision, consent.status,
      consent.role, consent.eggId, consent.eggRevision, consent.sourceTrainerSlug,
      consent.destinationTrainerSlug, consent.consentingProfileId,
      consent.expiresAtCampaignMinute, consent.settlementOperationId,
      consent.consentId, expectedRevision,
    )
    if (Number(result.changes) === 1) return Object.freeze({ kind: 'applied', document: consent })
    const raced = get(consent.consentId)
    return raced
      ? Object.freeze({ kind: 'stale', expectedRevision, currentRevision: raced.revision })
      : Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
  }
  return Object.freeze({ database, get, listByEgg, listActiveByParticipant, insert, replace })
}
