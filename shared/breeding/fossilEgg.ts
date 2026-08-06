import { isSlug } from '../paths'
import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
} from './ids'

export const BREEDING_FOSSIL_SOURCE_AUTHORITY_SCHEMA_VERSION = 1 as const
export const BREEDING_FOSSIL_REANIMATION_AUTHORITY_SCHEMA_VERSION = 1 as const
export const BREEDING_FOSSIL_EGG_PROJECTION_SCHEMA_VERSION = 1 as const

export interface BreedingFossilSourceAuthorityV1 {
  readonly schemaVersion: 1
  readonly eggId: PokemonEggId
  readonly sourceId: string
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly ownerTrainerDefinitionSha256: string
  readonly sourceInventoryEntryId: string
  readonly sourceUnitOrdinal: number
  readonly sourceInventoryEntryDefinitionSha256: string
  readonly designationReasonId: 'breeding.fossil-source.gm-designated'
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}

export interface BreedingFossilReanimationAuthorityV1 {
  readonly schemaVersion: 1
  readonly sourceAuthorityDefinitionSha256: string
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly trainerSheetDefinitionSha256: string
  readonly paleontologistEdgeInstanceId: string
  readonly paleontologistEdgeRecordSha256: string
  readonly paleontologistRuntimeDefinitionSha256: string
  readonly effectiveEdgeProjectionSha256: string
  readonly prerequisiteSkillId: 'pokemon-education' | 'survival'
  readonly prerequisiteSkillRank: 'Novice' | 'Adept' | 'Expert' | 'Master'
  readonly pokemonEducationRank: 'Pathetic' | 'Untrained' | 'Novice' | 'Adept' | 'Expert' | 'Master'
  readonly survivalRank: 'Pathetic' | 'Untrained' | 'Novice' | 'Adept' | 'Expert' | 'Master'
  readonly reanimationMachineInventoryEntryId: string
  readonly reanimationMachineUnitOrdinal: number
  readonly reanimationMachineInventoryEntryDefinitionSha256: string
  readonly reanimationMachineRecordSha256: string
  readonly reanimationMachineMechanicFieldsSha256: string
  readonly edgeOperationPlanDefinitionSha256: string
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}

export interface BreedingFossilEggCreationProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly eggId: PokemonEggId
  readonly eggRevision: 0
  readonly sourceKind: 'fossil'
  readonly status: 'incubating'
  readonly startingLevel: number
  readonly parentSnapshotCount: 0
  readonly traitsBounded: true
  readonly fossilRestorationApplied: boolean
  readonly prehistoricBondApplied: boolean
  readonly createdAtCampaignMinute: number
  readonly operationId: BreedingOperationId
}

export type BreedingFossilEggValidationCode =
  | 'breeding.fossil-egg.invalid-document'
  | 'breeding.fossil-egg.unknown-field'
  | 'breeding.fossil-egg.invalid-id'
  | 'breeding.fossil-egg.invalid-invariant'

export class BreedingFossilEggValidationError extends Error {
  readonly code: BreedingFossilEggValidationCode
  readonly path: string
  constructor(code: BreedingFossilEggValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingFossilEggValidationError'
    this.code = code
    this.path = path
  }
}

type Row = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const fail = (code: BreedingFossilEggValidationCode, path: string, message: string): never => {
  throw new BreedingFossilEggValidationError(code, path, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.fossil-egg.invalid-document', path, 'must be one plain data object.')
  }
  const row = value as Row
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.fossil-egg.unknown-field', path, 'must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.fossil-egg.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value)
  ? value : fail('breeding.fossil-egg.invalid-id', path, 'must be a bounded stable identifier.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value : fail('breeding.fossil-egg.invalid-id', path, 'must be a canonical Trainer slug.')
const revision = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647
  ? Number(value) : fail('breeding.fossil-egg.invalid-document', path, 'must be a bounded revision.')
const minute = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail('breeding.fossil-egg.invalid-document', path, 'must be a nonnegative campaign minute.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value : fail('breeding.fossil-egg.invalid-document', path, 'must be a lowercase SHA-256 digest.')

export const parseBreedingFossilSourceAuthorityV1 = (
  value: unknown,
  path = 'fossilSourceAuthority',
): BreedingFossilSourceAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion','eggId','sourceId','ownerTrainerSlug','ownerTrainerRevision','ownerTrainerDefinitionSha256',
    'sourceInventoryEntryId','sourceUnitOrdinal','sourceInventoryEntryDefinitionSha256','designationReasonId',
    'capturedAtCampaignMinute','definitionSha256',
  ], path)
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.fossil-egg.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  if (row.schemaVersion !== 1 || row.designationReasonId !== 'breeding.fossil-source.gm-designated') {
    return fail('breeding.fossil-egg.invalid-invariant', path, 'must be one reviewed GM-designated fossil source authority.')
  }
  return Object.freeze({
    schemaVersion: 1,
    eggId,
    sourceId: identifier(row.sourceId, `${path}.sourceId`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    ownerTrainerRevision: revision(row.ownerTrainerRevision, `${path}.ownerTrainerRevision`),
    ownerTrainerDefinitionSha256: hash(row.ownerTrainerDefinitionSha256, `${path}.ownerTrainerDefinitionSha256`),
    sourceInventoryEntryId: identifier(row.sourceInventoryEntryId, `${path}.sourceInventoryEntryId`),
    sourceUnitOrdinal: revision(row.sourceUnitOrdinal, `${path}.sourceUnitOrdinal`),
    sourceInventoryEntryDefinitionSha256: hash(row.sourceInventoryEntryDefinitionSha256, `${path}.sourceInventoryEntryDefinitionSha256`),
    designationReasonId: 'breeding.fossil-source.gm-designated',
    capturedAtCampaignMinute: minute(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

export const parseBreedingFossilReanimationAuthorityV1 = (
  value: unknown,
  path = 'fossilReanimationAuthority',
): BreedingFossilReanimationAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion','sourceAuthorityDefinitionSha256','trainerSheetSlug','trainerSheetRevision','trainerSheetDefinitionSha256',
    'paleontologistEdgeInstanceId','paleontologistEdgeRecordSha256','paleontologistRuntimeDefinitionSha256',
    'effectiveEdgeProjectionSha256','prerequisiteSkillId','prerequisiteSkillRank','pokemonEducationRank','survivalRank','reanimationMachineInventoryEntryId',
    'reanimationMachineUnitOrdinal','reanimationMachineInventoryEntryDefinitionSha256','reanimationMachineRecordSha256',
    'reanimationMachineMechanicFieldsSha256','edgeOperationPlanDefinitionSha256','capturedAtCampaignMinute','definitionSha256',
  ], path)
  const ranks = ['Pathetic','Untrained','Novice','Adept','Expert','Master'] as const
  if (row.schemaVersion !== 1
    || (row.prerequisiteSkillId !== 'pokemon-education' && row.prerequisiteSkillId !== 'survival')
    || !['Novice','Adept','Expert','Master'].includes(String(row.prerequisiteSkillRank))
    || !ranks.includes(row.pokemonEducationRank as typeof ranks[number])
    || !ranks.includes(row.survivalRank as typeof ranks[number])) {
    return fail('breeding.fossil-egg.invalid-invariant', path, 'must retain one reviewed Paleontologist prerequisite Skill result.')
  }
  return Object.freeze({
    schemaVersion: 1,
    sourceAuthorityDefinitionSha256: hash(row.sourceAuthorityDefinitionSha256, `${path}.sourceAuthorityDefinitionSha256`),
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerSheetRevision: revision(row.trainerSheetRevision, `${path}.trainerSheetRevision`),
    trainerSheetDefinitionSha256: hash(row.trainerSheetDefinitionSha256, `${path}.trainerSheetDefinitionSha256`),
    paleontologistEdgeInstanceId: identifier(row.paleontologistEdgeInstanceId, `${path}.paleontologistEdgeInstanceId`),
    paleontologistEdgeRecordSha256: hash(row.paleontologistEdgeRecordSha256, `${path}.paleontologistEdgeRecordSha256`),
    paleontologistRuntimeDefinitionSha256: hash(row.paleontologistRuntimeDefinitionSha256, `${path}.paleontologistRuntimeDefinitionSha256`),
    effectiveEdgeProjectionSha256: hash(row.effectiveEdgeProjectionSha256, `${path}.effectiveEdgeProjectionSha256`),
    prerequisiteSkillId: row.prerequisiteSkillId,
    prerequisiteSkillRank: row.prerequisiteSkillRank as BreedingFossilReanimationAuthorityV1['prerequisiteSkillRank'],
    pokemonEducationRank: row.pokemonEducationRank as BreedingFossilReanimationAuthorityV1['pokemonEducationRank'],
    survivalRank: row.survivalRank as BreedingFossilReanimationAuthorityV1['survivalRank'],
    reanimationMachineInventoryEntryId: identifier(row.reanimationMachineInventoryEntryId, `${path}.reanimationMachineInventoryEntryId`),
    reanimationMachineUnitOrdinal: revision(row.reanimationMachineUnitOrdinal, `${path}.reanimationMachineUnitOrdinal`),
    reanimationMachineInventoryEntryDefinitionSha256: hash(row.reanimationMachineInventoryEntryDefinitionSha256, `${path}.reanimationMachineInventoryEntryDefinitionSha256`),
    reanimationMachineRecordSha256: hash(row.reanimationMachineRecordSha256, `${path}.reanimationMachineRecordSha256`),
    reanimationMachineMechanicFieldsSha256: hash(row.reanimationMachineMechanicFieldsSha256, `${path}.reanimationMachineMechanicFieldsSha256`),
    edgeOperationPlanDefinitionSha256: hash(row.edgeOperationPlanDefinitionSha256, `${path}.edgeOperationPlanDefinitionSha256`),
    capturedAtCampaignMinute: minute(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

export const parseBreedingFossilEggCreationProjectionV1 = (
  value: unknown,
  path = 'fossilEggProjection',
): BreedingFossilEggCreationProjectionV1 => {
  const row = exact(value, [
    'schemaVersion','audience','eggId','eggRevision','sourceKind','status','startingLevel','parentSnapshotCount',
    'traitsBounded','fossilRestorationApplied','prehistoricBondApplied','createdAtCampaignMinute','operationId',
  ], path)
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.fossil-egg.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const operationId = parseBreedingOperationIdSyntax(row.operationId)
    ?? fail('breeding.fossil-egg.invalid-id', `${path}.operationId`, 'must be a Breeding operation ID.')
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner') || row.eggRevision !== 0
    || row.sourceKind !== 'fossil' || row.status !== 'incubating' || row.parentSnapshotCount !== 0
    || row.traitsBounded !== true || typeof row.fossilRestorationApplied !== 'boolean'
    || typeof row.prehistoricBondApplied !== 'boolean' || (!row.fossilRestorationApplied && row.prehistoricBondApplied)) {
    return fail('breeding.fossil-egg.invalid-invariant', path, 'must be one coarse committed fossil Egg projection.')
  }
  const startingLevel = revision(row.startingLevel, `${path}.startingLevel`)
  if (startingLevel < 1 || startingLevel > 100) return fail('breeding.fossil-egg.invalid-invariant', `${path}.startingLevel`, 'must be 1 through 100.')
  return Object.freeze({
    schemaVersion: 1,
    audience: row.audience,
    eggId,
    eggRevision: 0,
    sourceKind: 'fossil',
    status: 'incubating',
    startingLevel,
    parentSnapshotCount: 0,
    traitsBounded: true,
    fossilRestorationApplied: row.fossilRestorationApplied,
    prehistoricBondApplied: row.prehistoricBondApplied,
    createdAtCampaignMinute: minute(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`),
    operationId,
  })
}
