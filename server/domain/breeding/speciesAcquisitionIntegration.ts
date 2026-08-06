import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingOperationId,
  type BreedingSpeciesId,
} from '#shared/breeding/ids'
import type { TrainerSpeciesAcquisitionSourceKind } from '#shared/speciesAcquisition'
import { isSlug } from '#shared/paths'
import { BREEDING_CANONICAL_SPECIES, canonicalBreedingSpeciesIdentity } from './canonicalIds'

const SHA256 = /^[0-9a-f]{64}$/
const SOURCE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

export const BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-species-acquisition-integration-v1' as const,
  sources: Object.freeze(['capture', 'evolution', 'trade', 'migration', 'gm-reviewed'] as const),
  hatchOwner: 'complete-hatch' as const,
  sourceAuthority: 'server-private-self-hashed-evidence-plus-synchronous-current-verifier' as const,
  operationLedger: 'dedicated-external-species-acquisition-source-ledger' as const,
  reward: 'shared-trainer-species-acquisition-service' as const,
  release: 'history-retained-no-delete-authority' as const,
  campaignTime: 'authoritative-campaign-clock' as const,
  clientAuthority: 'none' as const,
})
export const BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256 = sha256(BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION)

export type ExternalTrainerSpeciesAcquisitionSourceKind = Exclude<TrainerSpeciesAcquisitionSourceKind, 'hatch'>
export type BreedingSpeciesAcquisitionSourceAuthorityKind =
  | 'live-play-capture'
  | 'pokemon-evolution'
  | 'pokemon-trade'
  | 'reviewed-migration'
  | 'gm-reviewed'

export interface BreedingSpeciesAcquisitionSourceEvidenceV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly sourceKind: ExternalTrainerSpeciesAcquisitionSourceKind
  readonly sourceAuthorityKind: BreedingSpeciesAcquisitionSourceAuthorityKind
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

export type BreedingSpeciesAcquisitionIntegrationErrorCode =
  | 'breeding.species-acquisition-integration.invalid-input'
  | 'breeding.species-acquisition-integration.invalid-authority'
  | 'breeding.species-acquisition-integration.stale-authority'
export class BreedingSpeciesAcquisitionIntegrationError extends Error {
  readonly code: BreedingSpeciesAcquisitionIntegrationErrorCode
  readonly field: string
  constructor(code: BreedingSpeciesAcquisitionIntegrationErrorCode, field: string, message: string) {
    super(`Species acquisition integration ${field}: ${message}`)
    this.name = 'BreedingSpeciesAcquisitionIntegrationError'
    this.code = code
    this.field = field
  }
}
const fail = (code: BreedingSpeciesAcquisitionIntegrationErrorCode, field: string, message: string): never => { throw new BreedingSpeciesAcquisitionIntegrationError(code, field, message) }
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) fail('breeding.species-acquisition-integration.invalid-input', path, 'must be one plain exact object.')
  const row = value as Record<string, unknown>
  const names = Object.getOwnPropertyNames(row).sort(); const expected = [...fields].sort()
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) fail('breeding.species-acquisition-integration.invalid-input', path, `must contain exactly: ${fields.join(', ')}.`)
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(row, name)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.species-acquisition-integration.invalid-input', `${path}.${name}`, 'must be an enumerable data field.')
  }
  return row
}
const integer = (value: unknown, field: string): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER ? Number(value) : fail('breeding.species-acquisition-integration.invalid-input', field, 'must be a bounded safe nonnegative integer.')
const slug = (value: unknown, field: string): string => isSlug(value) && value.length <= 160 ? value : fail('breeding.species-acquisition-integration.invalid-input', field, 'must be a canonical bounded slug.')
const hash = (value: unknown, field: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.species-acquisition-integration.invalid-input', field, 'must be a lowercase SHA-256 digest.')
const eventId = (value: unknown, field: string): string => typeof value === 'string' && SOURCE_EVENT_ID.test(value) ? value : fail('breeding.species-acquisition-integration.invalid-input', field, 'must be a bounded typed source-event ID.')
const AUTHORITY_BY_SOURCE: Readonly<Record<ExternalTrainerSpeciesAcquisitionSourceKind, BreedingSpeciesAcquisitionSourceAuthorityKind>> = Object.freeze({ capture: 'live-play-capture', evolution: 'pokemon-evolution', trade: 'pokemon-trade', migration: 'reviewed-migration', 'gm-reviewed': 'gm-reviewed' })
const SOURCE_KINDS = new Set<string>(Object.keys(AUTHORITY_BY_SOURCE))
const AUTHORITY_KINDS = new Set<string>(Object.values(AUTHORITY_BY_SOURCE))

const withoutDefinitionHash = (value: BreedingSpeciesAcquisitionSourceEvidenceV1): Omit<BreedingSpeciesAcquisitionSourceEvidenceV1, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}
export const parseBreedingSpeciesAcquisitionSourceEvidenceV1 = (value: unknown, path = 'sourceEvidence'): BreedingSpeciesAcquisitionSourceEvidenceV1 => {
  const row = exact(value, ['schemaVersion', 'operationId', 'sourceKind', 'sourceAuthorityKind', 'sourceEventId', 'sourceAuthorityDefinitionSha256', 'trainerSheetSlug', 'trainerRevisionBeforeReward', 'speciesId', 'pokemonSheetSlug', 'pokemonSheetRevision', 'campaignMinute', 'integrationPolicyDefinitionSha256', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.sourceKind !== 'string' || !SOURCE_KINDS.has(row.sourceKind)) fail('breeding.species-acquisition-integration.invalid-input', `${path}.sourceKind`, 'must be a closed non-hatch source kind.')
  if (typeof row.sourceAuthorityKind !== 'string' || !AUTHORITY_KINDS.has(row.sourceAuthorityKind)) fail('breeding.species-acquisition-integration.invalid-input', `${path}.sourceAuthorityKind`, 'must be a closed source authority kind.')
  const sourceKind = row.sourceKind as ExternalTrainerSpeciesAcquisitionSourceKind
  const sourceAuthorityKind = row.sourceAuthorityKind as BreedingSpeciesAcquisitionSourceAuthorityKind
  if (AUTHORITY_BY_SOURCE[sourceKind] !== sourceAuthorityKind) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.sourceAuthorityKind`, 'must match the source kind exactly.')
  const parsedSpeciesId = parseBreedingSpeciesIdSyntax(row.speciesId)
  if (!parsedSpeciesId || !canonicalBreedingSpeciesIdentity(parsedSpeciesId)) fail('breeding.species-acquisition-integration.invalid-input', `${path}.speciesId`, 'must identify one app-owned canonical Species.')
  const speciesId = parsedSpeciesId as BreedingSpeciesId
  const pokemonSheetSlug = row.pokemonSheetSlug === null ? null : slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`)
  const pokemonSheetRevision = row.pokemonSheetRevision === null ? null : integer(row.pokemonSheetRevision, `${path}.pokemonSheetRevision`)
  const pokemonRequired = sourceKind === 'capture' || sourceKind === 'evolution' || sourceKind === 'trade'
  if (pokemonRequired !== (pokemonSheetSlug !== null) || pokemonRequired !== (pokemonSheetRevision !== null)) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.pokemonSheetSlug`, 'Pokémon identity and revision must exist exactly for capture, evolution, and trade.')
  const operationId = parseBreedingOperationIdSyntax(row.operationId) ?? fail('breeding.species-acquisition-integration.invalid-input', `${path}.operationId`, 'must be a typed operation ID.')
  const evidence = Object.freeze({
    schemaVersion: 1 as const,
    operationId,
    sourceKind,
    sourceAuthorityKind,
    sourceEventId: eventId(row.sourceEventId, `${path}.sourceEventId`),
    sourceAuthorityDefinitionSha256: hash(row.sourceAuthorityDefinitionSha256, `${path}.sourceAuthorityDefinitionSha256`),
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerRevisionBeforeReward: integer(row.trainerRevisionBeforeReward, `${path}.trainerRevisionBeforeReward`),
    speciesId,
    pokemonSheetSlug,
    pokemonSheetRevision,
    campaignMinute: integer(row.campaignMinute, `${path}.campaignMinute`),
    integrationPolicyDefinitionSha256: hash(row.integrationPolicyDefinitionSha256, `${path}.integrationPolicyDefinitionSha256`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
  if (evidence.integrationPolicyDefinitionSha256 !== BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.integrationPolicyDefinitionSha256`, 'must match the current integration policy.')
  if (sha256(withoutDefinitionHash(evidence)) !== evidence.definitionSha256) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.definitionSha256`, 'must hash the exact evidence definition.')
  return evidence
}
export const createBreedingSpeciesAcquisitionSourceEvidenceV1 = (value: Omit<BreedingSpeciesAcquisitionSourceEvidenceV1, 'schemaVersion' | 'operationId' | 'integrationPolicyDefinitionSha256' | 'definitionSha256'>): BreedingSpeciesAcquisitionSourceEvidenceV1 => {
  const base = { schemaVersion: 1 as const, ...value, integrationPolicyDefinitionSha256: BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256 }
  const operationId = parseBreedingOperationIdSyntax(`breeding-operation:v1:${sha256({ purpose: 'external-species-acquisition', base }).slice(0, 32)}`)
    ?? fail('breeding.species-acquisition-integration.invalid-input', 'operationId', 'derived operation ID was invalid.')
  const definition = { ...base, operationId }
  return parseBreedingSpeciesAcquisitionSourceEvidenceV1({ ...definition, definitionSha256: sha256(definition) })
}
export const breedingSpeciesIdFromSheetSpecies = (value: unknown): BreedingSpeciesId | null => {
  if (typeof value !== 'string') return null
  const byId = parseBreedingSpeciesIdSyntax(value)
  if (byId && canonicalBreedingSpeciesIdentity(byId)) return byId
  return BREEDING_CANONICAL_SPECIES.find(identity => identity.sourceName === value)?.id ?? null
}

export interface BreedingSpeciesAcquisitionSourceSettlementV1 {
  readonly schemaVersion: 1
  readonly evidence: BreedingSpeciesAcquisitionSourceEvidenceV1
  readonly outcome: 'first-acquisition-rewarded' | 'already-acquired'
  readonly acquisitionDefinitionSha256: string
  readonly trainerRevisionAfterReward: number
  readonly trainerDexExpAfterReward: number
  readonly appliedRewardAmount: 0 | 1
  readonly settledAtCampaignMinute: number
  readonly definitionSha256: string
}
const withoutSettlementHash = (value: BreedingSpeciesAcquisitionSourceSettlementV1): Omit<BreedingSpeciesAcquisitionSourceSettlementV1, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}
export const parseBreedingSpeciesAcquisitionSourceSettlementV1 = (value: unknown, path = 'sourceSettlement'): BreedingSpeciesAcquisitionSourceSettlementV1 => {
  const row = exact(value, ['schemaVersion', 'evidence', 'outcome', 'acquisitionDefinitionSha256', 'trainerRevisionAfterReward', 'trainerDexExpAfterReward', 'appliedRewardAmount', 'settledAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || (row.outcome !== 'first-acquisition-rewarded' && row.outcome !== 'already-acquired')) fail('breeding.species-acquisition-integration.invalid-input', path, 'must be a v1 terminal source outcome.')
  if (row.appliedRewardAmount !== 0 && row.appliedRewardAmount !== 1) fail('breeding.species-acquisition-integration.invalid-input', `${path}.appliedRewardAmount`, 'must equal zero or one.')
  if ((row.outcome === 'first-acquisition-rewarded') !== (row.appliedRewardAmount === 1)) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.appliedRewardAmount`, 'must equal one exactly for a new historical identity.')
  const settlement = Object.freeze({
    schemaVersion: 1 as const,
    evidence: parseBreedingSpeciesAcquisitionSourceEvidenceV1(row.evidence, `${path}.evidence`),
    outcome: row.outcome,
    acquisitionDefinitionSha256: hash(row.acquisitionDefinitionSha256, `${path}.acquisitionDefinitionSha256`),
    trainerRevisionAfterReward: integer(row.trainerRevisionAfterReward, `${path}.trainerRevisionAfterReward`),
    trainerDexExpAfterReward: integer(row.trainerDexExpAfterReward, `${path}.trainerDexExpAfterReward`),
    appliedRewardAmount: row.appliedRewardAmount,
    settledAtCampaignMinute: integer(row.settledAtCampaignMinute, `${path}.settledAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as BreedingSpeciesAcquisitionSourceSettlementV1
  if (settlement.settledAtCampaignMinute !== settlement.evidence.campaignMinute) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.settledAtCampaignMinute`, 'must equal the evidence campaign checkpoint.')
  if (settlement.trainerRevisionAfterReward
    !== settlement.evidence.trainerRevisionBeforeReward + settlement.appliedRewardAmount) {
    fail('breeding.species-acquisition-integration.invalid-authority', `${path}.trainerRevisionAfterReward`, 'must advance exactly once only when the historical reward was applied.')
  }
  if (sha256(withoutSettlementHash(settlement)) !== settlement.definitionSha256) fail('breeding.species-acquisition-integration.invalid-authority', `${path}.definitionSha256`, 'must hash the exact terminal settlement.')
  return settlement
}
export const createBreedingSpeciesAcquisitionSourceSettlementV1 = (value: Omit<BreedingSpeciesAcquisitionSourceSettlementV1, 'schemaVersion' | 'definitionSha256'>): BreedingSpeciesAcquisitionSourceSettlementV1 => {
  const definition = { schemaVersion: 1 as const, ...value }
  return parseBreedingSpeciesAcquisitionSourceSettlementV1({ ...definition, definitionSha256: sha256(definition) })
}
