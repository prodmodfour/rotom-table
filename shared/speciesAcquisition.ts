import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from './automation/strictJson'
import { isSlug } from './paths'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingSpeciesIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type BreedingSpeciesId,
  type PokemonEggId,
} from './breeding/ids'

export const TRAINER_SPECIES_ACQUISITION_SOURCE_KINDS = Object.freeze([
  'capture', 'hatch', 'evolution', 'trade', 'migration', 'gm-reviewed',
] as const)
export type TrainerSpeciesAcquisitionSourceKind = typeof TRAINER_SPECIES_ACQUISITION_SOURCE_KINDS[number]
export interface RecordTrainerSpeciesAcquisitionRequestV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly speciesId: BreedingSpeciesId
  readonly sourceKind: TrainerSpeciesAcquisitionSourceKind
  readonly sourceEggId: PokemonEggId | null
  readonly acquiredAtCampaignMinute: number
  readonly operationId: BreedingOperationId
  readonly sheetUpdatedAt: number
}
export class TrainerSpeciesAcquisitionContractError extends Error {
  readonly code: 'species-acquisition.invalid-document' | 'species-acquisition.invalid-id' | 'species-acquisition.invalid-invariant'
  readonly field: string
  constructor(code: TrainerSpeciesAcquisitionContractError['code'], field: string, message: string) {
    super(`Trainer Species acquisition ${field}: ${message}`)
    this.name = 'TrainerSpeciesAcquisitionContractError'; this.code = code; this.field = field
  }
}
const fail = (code: TrainerSpeciesAcquisitionContractError['code'], field: string, message: string): never => { throw new TrainerSpeciesAcquisitionContractError(code, field, message) }
const clone = (value: unknown, path: string): StrictJsonObject => {
  const result = cloneStrictJson(value, path, {
    limits: { depth: 3, nodes: 32, objectFields: 12, arrayEntries: 0, stringLength: 200, objectKeyLength: 80 },
    rootLabel: path, valueLabel: 'Species acquisition request',
    failNotJson: (field, detail) => fail('species-acquisition.invalid-document', field, detail),
    failLimit: (field, detail) => fail('species-acquisition.invalid-document', field, detail),
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) return fail('species-acquisition.invalid-document', path, 'must be a plain object.')
  return result as StrictJsonObject
}
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const result = clone(value, path)
  const actual = Object.keys(result).sort(); const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail('species-acquisition.invalid-document', path, `must contain exactly: ${fields.join(', ')}.`)
  return result
}
const integer = (value: unknown, field: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail('species-acquisition.invalid-document', field, 'must be a safe nonnegative integer.')
const sourceKind = (value: unknown, field: string): TrainerSpeciesAcquisitionSourceKind => typeof value === 'string' && (TRAINER_SPECIES_ACQUISITION_SOURCE_KINDS as readonly string[]).includes(value) ? value as TrainerSpeciesAcquisitionSourceKind : fail('species-acquisition.invalid-document', field, 'must be a closed acquisition source kind.')
export const parseRecordTrainerSpeciesAcquisitionRequestV1 = (value: unknown, path = 'request'): RecordTrainerSpeciesAcquisitionRequestV1 => {
  const row = exact(value, ['schemaVersion', 'trainerSheetSlug', 'expectedTrainerRevision', 'speciesId', 'sourceKind', 'sourceEggId', 'acquiredAtCampaignMinute', 'operationId', 'sheetUpdatedAt'], path)
  if (row.schemaVersion !== 1) fail('species-acquisition.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  const trainerSheetSlug = isSlug(row.trainerSheetSlug) && row.trainerSheetSlug.length <= 160 ? row.trainerSheetSlug : fail('species-acquisition.invalid-id', `${path}.trainerSheetSlug`, 'must be a canonical bounded sheet slug.')
  const speciesId = parseBreedingSpeciesIdSyntax(row.speciesId) ?? fail('species-acquisition.invalid-id', `${path}.speciesId`, 'must be a canonical Species ID syntax.')
  const kind = sourceKind(row.sourceKind, `${path}.sourceKind`)
  const sourceEggId = row.sourceEggId === null ? null : parsePokemonEggIdSyntax(row.sourceEggId) ?? fail('species-acquisition.invalid-id', `${path}.sourceEggId`, 'must be an Egg ID or null.')
  if ((kind === 'hatch') !== (sourceEggId !== null)) fail('species-acquisition.invalid-invariant', `${path}.sourceEggId`, 'must exist exactly for a hatch acquisition.')
  return deepFreezeStrictJson({
    schemaVersion: 1, trainerSheetSlug,
    expectedTrainerRevision: integer(row.expectedTrainerRevision, `${path}.expectedTrainerRevision`),
    speciesId, sourceKind: kind, sourceEggId,
    acquiredAtCampaignMinute: integer(row.acquiredAtCampaignMinute, `${path}.acquiredAtCampaignMinute`),
    operationId: parseBreedingOperationIdSyntax(row.operationId) ?? fail('species-acquisition.invalid-id', `${path}.operationId`, 'must be a campaign operation ID.'),
    sheetUpdatedAt: integer(row.sheetUpdatedAt, `${path}.sheetUpdatedAt`),
  })
}
