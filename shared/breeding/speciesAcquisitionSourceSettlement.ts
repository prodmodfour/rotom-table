import { isSlug } from '../paths'
import type { TrainerSpeciesAcquisitionSourceKind } from '../speciesAcquisition'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingOperationId,
  type BreedingSpeciesId,
} from './ids'

export type ExternalBreedingSpeciesAcquisitionSourceKind = Exclude<
  TrainerSpeciesAcquisitionSourceKind,
  'hatch'
>

export type BreedingSpeciesAcquisitionSourceAuthorityKindV1 =
  | 'live-play-capture'
  | 'pokemon-evolution'
  | 'pokemon-trade'
  | 'reviewed-migration'
  | 'gm-reviewed'

export interface BreedingSpeciesAcquisitionSourceEvidenceDocumentV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly sourceKind: ExternalBreedingSpeciesAcquisitionSourceKind
  readonly sourceAuthorityKind: BreedingSpeciesAcquisitionSourceAuthorityKindV1
  readonly sourceEventId: string
  readonly sourceAuthorityDefinitionSha256: string
  readonly trainerSheetSlug: string
  readonly trainerRevisionBeforeReward: number
  readonly speciesId: BreedingSpeciesId
  readonly pokemonSheetSlug: string | null
  readonly pokemonSheetRevision: number | null
  readonly campaignMinute: number
  readonly integrationPolicyDefinitionSha256: string
  readonly definitionSha256: string
}

export interface BreedingSpeciesAcquisitionSourceSettlementDocumentV1 {
  readonly schemaVersion: 1
  readonly evidence: BreedingSpeciesAcquisitionSourceEvidenceDocumentV1
  readonly outcome: 'first-acquisition-rewarded' | 'already-acquired'
  readonly acquisitionDefinitionSha256: string
  readonly trainerRevisionAfterReward: number
  readonly trainerDexExpAfterReward: number
  readonly appliedRewardAmount: 0 | 1
  readonly settledAtCampaignMinute: number
  readonly definitionSha256: string
}

export type BreedingSpeciesAcquisitionSourceSettlementValidationCode =
  | 'breeding.species-acquisition-source.invalid-document'
  | 'breeding.species-acquisition-source.unknown-field'
  | 'breeding.species-acquisition-source.invalid-id'
  | 'breeding.species-acquisition-source.invalid-invariant'

export class BreedingSpeciesAcquisitionSourceSettlementValidationError extends Error {
  readonly code: BreedingSpeciesAcquisitionSourceSettlementValidationCode
  readonly path: string

  constructor(
    code: BreedingSpeciesAcquisitionSourceSettlementValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'BreedingSpeciesAcquisitionSourceSettlementValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const SOURCE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const AUTHORITY_BY_SOURCE = Object.freeze({
  capture: 'live-play-capture',
  evolution: 'pokemon-evolution',
  trade: 'pokemon-trade',
  migration: 'reviewed-migration',
  'gm-reviewed': 'gm-reviewed',
} as const)
const SOURCE_KINDS = new Set<string>(Object.keys(AUTHORITY_BY_SOURCE))
const AUTHORITY_KINDS = new Set<string>(Object.values(AUTHORITY_BY_SOURCE))

const fail = (
  code: BreedingSpeciesAcquisitionSourceSettlementValidationCode,
  path: string,
  message: string,
): never => {
  throw new BreedingSpeciesAcquisitionSourceSettlementValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.species-acquisition-source.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail(
      'breeding.species-acquisition-source.invalid-document',
      path,
      'must be plain data without symbols.',
    )
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail(
        'breeding.species-acquisition-source.invalid-document',
        `${path}.${key}`,
        'must be an enumerable data field.',
      )
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    return fail(
      'breeding.species-acquisition-source.unknown-field',
      path,
      'must contain exactly the declared fields.',
    )
  }
  return row
}
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value)
  && Number(value) >= 0
  && Number(value) < Number.MAX_SAFE_INTEGER
  ? Number(value)
  : fail(
      'breeding.species-acquisition-source.invalid-document',
      path,
      'must be a bounded nonnegative safe integer.',
    )
const hash = (value: unknown, path: string): string => typeof value === 'string'
  && SHA256.test(value)
  ? value
  : fail(
      'breeding.species-acquisition-source.invalid-document',
      path,
      'must be a lowercase SHA-256 digest.',
    )
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail(
      'breeding.species-acquisition-source.invalid-id',
      path,
      'must be a canonical bounded slug.',
    )
const sourceEventId = (value: unknown, path: string): string => typeof value === 'string'
  && SOURCE_EVENT_ID.test(value)
  && !value.includes('..')
  && !value.includes('//')
  && !value.endsWith('/')
  ? value
  : fail(
      'breeding.species-acquisition-source.invalid-id',
      path,
      'must be a bounded traversal-safe source-event ID.',
    )
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const parseBreedingSpeciesAcquisitionSourceEvidenceDocumentV1 = (
  value: unknown,
  path = 'sourceEvidence',
): BreedingSpeciesAcquisitionSourceEvidenceDocumentV1 => {
  const row = exact(value, [
    'schemaVersion',
    'operationId',
    'sourceKind',
    'sourceAuthorityKind',
    'sourceEventId',
    'sourceAuthorityDefinitionSha256',
    'trainerSheetSlug',
    'trainerRevisionBeforeReward',
    'speciesId',
    'pokemonSheetSlug',
    'pokemonSheetRevision',
    'campaignMinute',
    'integrationPolicyDefinitionSha256',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || typeof row.sourceKind !== 'string'
    || !SOURCE_KINDS.has(row.sourceKind) || typeof row.sourceAuthorityKind !== 'string'
    || !AUTHORITY_KINDS.has(row.sourceAuthorityKind)) {
    return fail(
      'breeding.species-acquisition-source.invalid-document',
      path,
      'must be one closed schema-v1 source evidence record.',
    )
  }
  const sourceKind = row.sourceKind as ExternalBreedingSpeciesAcquisitionSourceKind
  const sourceAuthorityKind = row.sourceAuthorityKind as BreedingSpeciesAcquisitionSourceAuthorityKindV1
  if (AUTHORITY_BY_SOURCE[sourceKind] !== sourceAuthorityKind) {
    return fail(
      'breeding.species-acquisition-source.invalid-invariant',
      `${path}.sourceAuthorityKind`,
      'must match the source kind exactly.',
    )
  }
  const pokemonSheetSlug = row.pokemonSheetSlug === null
    ? null
    : slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`)
  const pokemonSheetRevision = row.pokemonSheetRevision === null
    ? null
    : integer(row.pokemonSheetRevision, `${path}.pokemonSheetRevision`)
  const pokemonRequired = sourceKind === 'capture' || sourceKind === 'evolution' || sourceKind === 'trade'
  if (pokemonRequired !== (pokemonSheetSlug !== null)
    || pokemonRequired !== (pokemonSheetRevision !== null)) {
    return fail(
      'breeding.species-acquisition-source.invalid-invariant',
      `${path}.pokemonSheetSlug`,
      'Pokémon identity and revision must exist exactly for capture, evolution, and trade.',
    )
  }
  return freeze({
    schemaVersion: 1,
    operationId: parseBreedingOperationIdSyntax(row.operationId)
      ?? fail(
        'breeding.species-acquisition-source.invalid-id',
        `${path}.operationId`,
        'must be a typed operation ID.',
      ),
    sourceKind,
    sourceAuthorityKind,
    sourceEventId: sourceEventId(row.sourceEventId, `${path}.sourceEventId`),
    sourceAuthorityDefinitionSha256: hash(
      row.sourceAuthorityDefinitionSha256,
      `${path}.sourceAuthorityDefinitionSha256`,
    ),
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerRevisionBeforeReward: integer(
      row.trainerRevisionBeforeReward,
      `${path}.trainerRevisionBeforeReward`,
    ),
    speciesId: parseBreedingSpeciesIdSyntax(row.speciesId)
      ?? fail(
        'breeding.species-acquisition-source.invalid-id',
        `${path}.speciesId`,
        'must be a canonical Species ID.',
      ),
    pokemonSheetSlug,
    pokemonSheetRevision,
    campaignMinute: integer(row.campaignMinute, `${path}.campaignMinute`),
    integrationPolicyDefinitionSha256: hash(
      row.integrationPolicyDefinitionSha256,
      `${path}.integrationPolicyDefinitionSha256`,
    ),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

/**
 * Portable schema parser. Current policy, canonical Species membership, and both
 * self-hashes are revalidated by the server authoritative parser before use.
 */
export const parseBreedingSpeciesAcquisitionSourceSettlementDocumentV1 = (
  value: unknown,
  path = 'sourceSettlement',
): BreedingSpeciesAcquisitionSourceSettlementDocumentV1 => {
  const row = exact(value, [
    'schemaVersion',
    'evidence',
    'outcome',
    'acquisitionDefinitionSha256',
    'trainerRevisionAfterReward',
    'trainerDexExpAfterReward',
    'appliedRewardAmount',
    'settledAtCampaignMinute',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1
    || (row.outcome !== 'first-acquisition-rewarded' && row.outcome !== 'already-acquired')
    || (row.appliedRewardAmount !== 0 && row.appliedRewardAmount !== 1)) {
    return fail(
      'breeding.species-acquisition-source.invalid-document',
      path,
      'must be one closed schema-v1 terminal source settlement.',
    )
  }
  const evidence = parseBreedingSpeciesAcquisitionSourceEvidenceDocumentV1(
    row.evidence,
    `${path}.evidence`,
  )
  const appliedRewardAmount = row.appliedRewardAmount as 0 | 1
  const settledAtCampaignMinute = integer(
    row.settledAtCampaignMinute,
    `${path}.settledAtCampaignMinute`,
  )
  const trainerRevisionAfterReward = integer(
    row.trainerRevisionAfterReward,
    `${path}.trainerRevisionAfterReward`,
  )
  if ((row.outcome === 'first-acquisition-rewarded') !== (appliedRewardAmount === 1)
    || settledAtCampaignMinute !== evidence.campaignMinute
    || trainerRevisionAfterReward !== evidence.trainerRevisionBeforeReward + appliedRewardAmount) {
    return fail(
      'breeding.species-acquisition-source.invalid-invariant',
      path,
      'outcome, reward, Trainer revision, and campaign checkpoint must agree exactly.',
    )
  }
  return freeze({
    schemaVersion: 1,
    evidence,
    outcome: row.outcome,
    acquisitionDefinitionSha256: hash(
      row.acquisitionDefinitionSha256,
      `${path}.acquisitionDefinitionSha256`,
    ),
    trainerRevisionAfterReward,
    trainerDexExpAfterReward: integer(
      row.trainerDexExpAfterReward,
      `${path}.trainerDexExpAfterReward`,
    ),
    appliedRewardAmount,
    settledAtCampaignMinute,
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
