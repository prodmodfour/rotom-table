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
import {
  TRAINER_SPECIES_ACQUISITION_SOURCE_KINDS,
  type TrainerSpeciesAcquisitionSourceKind,
} from './speciesAcquisition'

export interface BreedingSpeciesAcquisitionArchiveRecordV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string
  readonly trainerRevisionBeforeReward: number
  readonly trainerSheetUpdatedAt: number
  readonly speciesId: BreedingSpeciesId
  readonly sourceKind: TrainerSpeciesAcquisitionSourceKind
  readonly firstAcquiredAtCampaignMinute: number
  readonly sourceEggId: PokemonEggId | null
  readonly operationId: BreedingOperationId
  readonly definitionSha256: string
}

export type SpeciesAcquisitionHistoryValidationCode =
  | 'breeding.archive.invalid-document'
  | 'breeding.archive.unknown-field'
  | 'breeding.archive.invalid-id'
  | 'breeding.archive.invalid-invariant'

export class SpeciesAcquisitionHistoryValidationError extends Error {
  readonly code: SpeciesAcquisitionHistoryValidationCode
  readonly path: string
  constructor(code: SpeciesAcquisitionHistoryValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'SpeciesAcquisitionHistoryValidationError'
    this.code = code
    this.path = path
  }
}

const SHA256 = /^[0-9a-f]{64}$/
const SOURCE_KINDS = new Set<string>(TRAINER_SPECIES_ACQUISITION_SOURCE_KINDS)
const fail = (
  code: SpeciesAcquisitionHistoryValidationCode,
  path: string,
  message: string,
): never => {
  throw new SpeciesAcquisitionHistoryValidationError(code, path, message)
}
const clone = (value: unknown, path: string): StrictJsonObject => {
  const result = cloneStrictJson(value, path, {
    limits: {
      depth: 3,
      nodes: 32,
      objectFields: 12,
      arrayEntries: 0,
      stringLength: 200,
      objectKeyLength: 80,
    },
    rootLabel: path,
    valueLabel: 'Species acquisition history',
    failNotJson: (field, detail) => fail('breeding.archive.invalid-document', field, detail),
    failLimit: (field, detail) => fail('breeding.archive.invalid-document', field, detail),
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return fail('breeding.archive.invalid-document', path, 'must be a plain object.')
  }
  return result as StrictJsonObject
}
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const row = clone(value, path)
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    fail('breeding.archive.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : fail('breeding.archive.invalid-document', path, 'must be a safe nonnegative integer.')
)
const hash = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.archive.invalid-document', path, 'must be a lowercase SHA-256 value.')
)

/** Leaf parser shared by archives and runtime acquisition integrations. */
export const parseBreedingSpeciesAcquisitionArchiveRecordV1 = (
  value: unknown,
  path = 'speciesAcquisition',
): BreedingSpeciesAcquisitionArchiveRecordV1 => {
  const row = exact(value, [
    'schemaVersion',
    'trainerSheetSlug',
    'trainerRevisionBeforeReward',
    'trainerSheetUpdatedAt',
    'speciesId',
    'sourceKind',
    'firstAcquiredAtCampaignMinute',
    'sourceEggId',
    'operationId',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1
    || typeof row.sourceKind !== 'string'
    || !SOURCE_KINDS.has(row.sourceKind)) {
    fail('breeding.archive.invalid-document', `${path}.sourceKind`, 'must be a v1 acquisition source kind.')
  }
  const sourceKind = row.sourceKind as TrainerSpeciesAcquisitionSourceKind
  const sourceEggId = row.sourceEggId === null
    ? null
    : parsePokemonEggIdSyntax(row.sourceEggId)
      ?? fail('breeding.archive.invalid-id', `${path}.sourceEggId`, 'must be an Egg ID.')
  if ((sourceKind === 'hatch') !== (sourceEggId !== null)) {
    fail(
      'breeding.archive.invalid-invariant',
      `${path}.sourceEggId`,
      'must exist exactly for a hatch acquisition.',
    )
  }
  const trainerSheetSlug = isSlug(row.trainerSheetSlug) && row.trainerSheetSlug.length <= 160
    ? row.trainerSheetSlug
    : fail('breeding.archive.invalid-id', `${path}.trainerSheetSlug`, 'must be a canonical sheet slug.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    trainerSheetSlug,
    trainerRevisionBeforeReward: integer(
      row.trainerRevisionBeforeReward,
      `${path}.trainerRevisionBeforeReward`,
    ),
    trainerSheetUpdatedAt: integer(row.trainerSheetUpdatedAt, `${path}.trainerSheetUpdatedAt`),
    speciesId: parseBreedingSpeciesIdSyntax(row.speciesId)
      ?? fail('breeding.archive.invalid-id', `${path}.speciesId`, 'must be a Species ID.'),
    sourceKind,
    firstAcquiredAtCampaignMinute: integer(
      row.firstAcquiredAtCampaignMinute,
      `${path}.firstAcquiredAtCampaignMinute`,
    ),
    sourceEggId,
    operationId: parseBreedingOperationIdSyntax(row.operationId)
      ?? fail('breeding.archive.invalid-id', `${path}.operationId`, 'must be an operation ID.'),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
