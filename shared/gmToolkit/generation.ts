import {
  ENCOUNTER_TIME_OF_DAY_VALUES,
  ENCOUNTER_WEATHER_VALUES,
  type EncounterTimeOfDay,
  type EncounterWeather,
} from './encounterTables'

export const WILD_GENERATION_SCHEMA_VERSION = 1 as const
export const WILD_GENERATION_REQUEST_MAXIMUM = 30 as const
export const WILD_GENERATION_COMMIT_MAXIMUM = 10 as const

export interface WildGenerationTrainerRefV1 {
  readonly trainerSlug: string
  readonly expectedRevision: number
}

export interface WildGenerationExplorationRefV1 {
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly campaignClockRevision: number
}

export interface WildGenerationPreviewCommandV1 {
  readonly schemaVersion: 1
  readonly mode: 'preview'
  readonly operationId: string
  readonly tableId: string
  readonly expectedTableRevision: number
  readonly requestedSlots: number | null
  readonly party: { readonly trainerRefs: readonly WildGenerationTrainerRefV1[] }
  readonly environment: { readonly timeOfDay: EncounterTimeOfDay | null; readonly weather: EncounterWeather | null }
  readonly policy: { readonly shinyChancePercent: number; readonly heldItemName: string | null }
  readonly exploration: WildGenerationExplorationRefV1 | null
}

export interface WildGenerationCommitCommandV1 {
  readonly schemaVersion: 1
  readonly mode: 'commit'
  readonly operationId: string
  readonly previewToken: string
  readonly selectedCandidateIds: readonly string[]
  readonly folder: string
}

export type WildGenerationCommandV1 = WildGenerationPreviewCommandV1 | WildGenerationCommitCommandV1

export interface WildGenerationJournalDrawV1 {
  readonly ordinal: number
  readonly purpose: string
  readonly rawUint32: number
  readonly range: { readonly minimum: number; readonly maximum: number }
  readonly result: number
  readonly accepted: boolean
}

export interface WildGenerationCandidateProjectionV1 {
  readonly candidateId: string
  readonly slot: number
  readonly speciesId: string
  readonly level: number
  readonly gender: 'Male' | 'Female' | 'Genderless'
  readonly nature: string
  readonly shiny: boolean
  readonly heldItemName: string | null
  readonly abilityNames: readonly string[]
  readonly moveNames: readonly string[]
  readonly statTotals: Readonly<Record<'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd', number>>
  readonly capabilitySummary: readonly string[]
}

export interface WildGenerationPreviewProjectionV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly table: { readonly name: string; readonly revision: number }
  readonly requestedSlots: number
  readonly nothingSlots: number
  readonly repelledSlots: number
  readonly candidates: readonly WildGenerationCandidateProjectionV1[]
  readonly previewToken: string
  readonly journal: readonly WildGenerationJournalDrawV1[]
  readonly sourceDefinitionHashes: readonly string[]
  readonly previewHash: string
  readonly expiresAt: string
}

export interface WildGenerationCommittedSheetRefV1 {
  readonly kind: 'pokemon'
  readonly slug: string
  readonly revision: 0
  readonly candidateId: string
  readonly custody: 'gm-campaign'
  readonly ownerTrainerSlug: null
}

export interface WildGenerationCommitProjectionV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly exactRetry: boolean
  readonly committedAt: string
  readonly packageId: string
  readonly table: { readonly name: string; readonly revision: number }
  readonly sheets: readonly WildGenerationCommittedSheetRefV1[]
  readonly candidates: readonly WildGenerationCandidateProjectionV1[]
}

export class WildGenerationContractError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'WildGenerationContractError'
    this.path = path
  }
}

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WildGenerationContractError(path, 'must be an object')
  return value as Record<string, unknown>
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new WildGenerationContractError(`${path}.${key}`, 'is not allowed')
  for (const key of keys) if (!(key in value)) throw new WildGenerationContractError(`${path}.${key}`, 'is required')
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new WildGenerationContractError(path, `must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}
const stableId = (value: unknown, path: string, pattern: RegExp): string => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new WildGenerationContractError(path, 'must be a stable bounded ID')
  return value
}
const nullableEnum = <T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null => {
  if (value === null) return null
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new WildGenerationContractError(path, `must be null or one of ${allowed.join(', ')}`)
  return value as T
}
const OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const TABLE_ID = /^encounter-table:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CANDIDATE_ID = /^wild-candidate:v1:[a-f0-9]{24}:[1-9][0-9]?$/

const parseExploration = (value: unknown): WildGenerationExplorationRefV1 | null => {
  if (value === null) return null
  const row = record(value, 'command.exploration')
  exactKeys(row, ['trainerSlug', 'trainerRevision', 'campaignClockRevision'], 'command.exploration')
  return {
    trainerSlug: stableId(row.trainerSlug, 'command.exploration.trainerSlug', SLUG),
    trainerRevision: integer(row.trainerRevision, 'command.exploration.trainerRevision', 0, Number.MAX_SAFE_INTEGER),
    campaignClockRevision: integer(row.campaignClockRevision, 'command.exploration.campaignClockRevision', 0, Number.MAX_SAFE_INTEGER),
  }
}

export const parseWildGenerationPreviewCommandV1 = (value: unknown): WildGenerationPreviewCommandV1 => {
  const row = record(value, 'command')
  exactKeys(row, ['schemaVersion', 'mode', 'operationId', 'tableId', 'expectedTableRevision', 'requestedSlots', 'party', 'environment', 'policy', 'exploration'], 'command')
  if (row.schemaVersion !== 1 || row.mode !== 'preview') throw new WildGenerationContractError('command', 'must be a schema-v1 preview command')
  const party = record(row.party, 'command.party')
  exactKeys(party, ['trainerRefs'], 'command.party')
  if (!Array.isArray(party.trainerRefs) || party.trainerRefs.length > 6) throw new WildGenerationContractError('command.party.trainerRefs', 'must contain at most six Trainer references')
  const trainerRefs = party.trainerRefs.map((value, index): WildGenerationTrainerRefV1 => {
    const ref = record(value, `command.party.trainerRefs[${index}]`)
    exactKeys(ref, ['trainerSlug', 'expectedRevision'], `command.party.trainerRefs[${index}]`)
    return {
      trainerSlug: stableId(ref.trainerSlug, `command.party.trainerRefs[${index}].trainerSlug`, SLUG),
      expectedRevision: integer(ref.expectedRevision, `command.party.trainerRefs[${index}].expectedRevision`, 0, Number.MAX_SAFE_INTEGER),
    }
  })
  if (new Set(trainerRefs.map(ref => ref.trainerSlug)).size !== trainerRefs.length) throw new WildGenerationContractError('command.party.trainerRefs', 'must be unique')
  const environment = record(row.environment, 'command.environment')
  exactKeys(environment, ['timeOfDay', 'weather'], 'command.environment')
  const policy = record(row.policy, 'command.policy')
  exactKeys(policy, ['shinyChancePercent', 'heldItemName'], 'command.policy')
  const heldItemName = policy.heldItemName
  if (heldItemName !== null && (typeof heldItemName !== 'string' || heldItemName.length < 1 || heldItemName.length > 120 || heldItemName.trim() !== heldItemName)) {
    throw new WildGenerationContractError('command.policy.heldItemName', 'must be null or trimmed bounded text')
  }
  const shinyChancePercent = Number(policy.shinyChancePercent)
  if (!Number.isFinite(shinyChancePercent) || shinyChancePercent < 0 || shinyChancePercent > 100 || Math.round(shinyChancePercent * 100) !== shinyChancePercent * 100) {
    throw new WildGenerationContractError('command.policy.shinyChancePercent', 'must be a percentage from 0 to 100 with at most two decimals')
  }
  return {
    schemaVersion: 1,
    mode: 'preview',
    operationId: stableId(row.operationId, 'command.operationId', OPERATION_ID),
    tableId: stableId(row.tableId, 'command.tableId', TABLE_ID),
    expectedTableRevision: integer(row.expectedTableRevision, 'command.expectedTableRevision', 0, Number.MAX_SAFE_INTEGER),
    requestedSlots: row.requestedSlots === null ? null : integer(row.requestedSlots, 'command.requestedSlots', 1, WILD_GENERATION_REQUEST_MAXIMUM),
    party: { trainerRefs },
    environment: {
      timeOfDay: nullableEnum(environment.timeOfDay, 'command.environment.timeOfDay', ENCOUNTER_TIME_OF_DAY_VALUES),
      weather: nullableEnum(environment.weather, 'command.environment.weather', ENCOUNTER_WEATHER_VALUES),
    },
    policy: { shinyChancePercent, heldItemName },
    exploration: parseExploration(row.exploration),
  }
}

export const parseWildGenerationCommitCommandV1 = (value: unknown): WildGenerationCommitCommandV1 => {
  const row = record(value, 'command')
  exactKeys(row, ['schemaVersion', 'mode', 'operationId', 'previewToken', 'selectedCandidateIds', 'folder'], 'command')
  if (row.schemaVersion !== 1 || row.mode !== 'commit') throw new WildGenerationContractError('command', 'must be a schema-v1 commit command')
  if (typeof row.previewToken !== 'string' || row.previewToken.length < 32 || row.previewToken.length > 16_384) throw new WildGenerationContractError('command.previewToken', 'must be a bounded opaque server token')
  if (!Array.isArray(row.selectedCandidateIds) || row.selectedCandidateIds.length < 1 || row.selectedCandidateIds.length > WILD_GENERATION_COMMIT_MAXIMUM) {
    throw new WildGenerationContractError('command.selectedCandidateIds', `must contain from 1 to ${WILD_GENERATION_COMMIT_MAXIMUM} candidates`)
  }
  const selectedCandidateIds = row.selectedCandidateIds.map((id, index) => stableId(id, `command.selectedCandidateIds[${index}]`, CANDIDATE_ID))
  if (new Set(selectedCandidateIds).size !== selectedCandidateIds.length) throw new WildGenerationContractError('command.selectedCandidateIds', 'must be unique')
  if (typeof row.folder !== 'string' || row.folder.length > 200 || row.folder.startsWith('/') || row.folder.includes('..') || /\\/.test(row.folder)) {
    throw new WildGenerationContractError('command.folder', 'must be a bounded relative campaign folder')
  }
  return {
    schemaVersion: 1,
    mode: 'commit',
    operationId: stableId(row.operationId, 'command.operationId', OPERATION_ID),
    previewToken: row.previewToken,
    selectedCandidateIds,
    folder: row.folder,
  }
}

export const parseWildGenerationCommandV1 = (value: unknown): WildGenerationCommandV1 => {
  const row = record(value, 'command')
  return row.mode === 'preview' ? parseWildGenerationPreviewCommandV1(row) : parseWildGenerationCommitCommandV1(row)
}
