import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
} from './ids'
import { POKEMON_EGG_GM_PROVENANCE_KINDS, type PokemonEggGmProvenanceKind } from './egg'

export interface BreedingGmEggImportEvidenceV1 {
  readonly schemaVersion: 1
  readonly sourceSystemId: string
  readonly sourceRecordId: string
  readonly sourceRecordDefinitionSha256: string
  readonly importReceiptDefinitionSha256: string
  readonly reviewedAtCampaignMinute: number
  readonly definitionSha256: string
}

export interface BreedingGmEggCreationProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly eggId: PokemonEggId
  readonly eggRevision: 0
  readonly sourceKind: 'gm'
  readonly provenanceKind: PokemonEggGmProvenanceKind | null
  readonly status: 'incubating'
  readonly startingLevel: number
  readonly parentSnapshotCount: 0
  readonly traitsBounded: true
  readonly imported: boolean | null
  readonly createdAtCampaignMinute: number
  readonly operationId: BreedingOperationId
}

export type BreedingGmEggValidationCode =
  | 'breeding.gm-egg.invalid-document'
  | 'breeding.gm-egg.unknown-field'
  | 'breeding.gm-egg.invalid-id'
  | 'breeding.gm-egg.invalid-invariant'

export class BreedingGmEggValidationError extends Error {
  readonly code: BreedingGmEggValidationCode
  readonly path: string
  constructor(code: BreedingGmEggValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingGmEggValidationError'
    this.code = code
    this.path = path
  }
}

type Row = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const fail = (code: BreedingGmEggValidationCode, path: string, message: string): never => {
  throw new BreedingGmEggValidationError(code, path, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.gm-egg.invalid-document', path, 'must be one plain data object.')
  }
  const row = value as Row
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.gm-egg.unknown-field', path, 'must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.gm-egg.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value)
  ? value : fail('breeding.gm-egg.invalid-id', path, 'must be a bounded stable identifier.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value : fail('breeding.gm-egg.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const minute = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail('breeding.gm-egg.invalid-document', path, 'must be a nonnegative campaign minute.')

export const parseBreedingGmEggImportEvidenceV1 = (
  value: unknown,
  path = 'gmEggImportEvidence',
): BreedingGmEggImportEvidenceV1 => {
  const row = exact(value, [
    'schemaVersion','sourceSystemId','sourceRecordId','sourceRecordDefinitionSha256',
    'importReceiptDefinitionSha256','reviewedAtCampaignMinute','definitionSha256',
  ], path)
  if (row.schemaVersion !== 1) return fail('breeding.gm-egg.invalid-invariant', path, 'must be v1 import evidence.')
  return Object.freeze({
    schemaVersion: 1,
    sourceSystemId: identifier(row.sourceSystemId, `${path}.sourceSystemId`),
    sourceRecordId: identifier(row.sourceRecordId, `${path}.sourceRecordId`),
    sourceRecordDefinitionSha256: hash(row.sourceRecordDefinitionSha256, `${path}.sourceRecordDefinitionSha256`),
    importReceiptDefinitionSha256: hash(row.importReceiptDefinitionSha256, `${path}.importReceiptDefinitionSha256`),
    reviewedAtCampaignMinute: minute(row.reviewedAtCampaignMinute, `${path}.reviewedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

export const parseBreedingGmEggCreationProjectionV1 = (
  value: unknown,
  path = 'gmEggCreationProjection',
): BreedingGmEggCreationProjectionV1 => {
  const row = exact(value, [
    'schemaVersion','audience','eggId','eggRevision','sourceKind','provenanceKind','status','startingLevel',
    'parentSnapshotCount','traitsBounded','imported','createdAtCampaignMinute','operationId',
  ], path)
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.gm-egg.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const operationId = parseBreedingOperationIdSyntax(row.operationId)
    ?? fail('breeding.gm-egg.invalid-id', `${path}.operationId`, 'must be a Breeding operation ID.')
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || row.eggRevision !== 0 || row.sourceKind !== 'gm' || row.status !== 'incubating'
    || row.parentSnapshotCount !== 0 || row.traitsBounded !== true) {
    return fail('breeding.gm-egg.invalid-invariant', path, 'must be one coarse committed GM Egg projection.')
  }
  const gm = row.audience === 'gm'
  const provenanceKind = row.provenanceKind === null ? null
    : POKEMON_EGG_GM_PROVENANCE_KINDS.includes(row.provenanceKind as PokemonEggGmProvenanceKind)
      ? row.provenanceKind as PokemonEggGmProvenanceKind
      : fail('breeding.gm-egg.invalid-invariant', `${path}.provenanceKind`, 'must be a closed GM provenance kind.')
  if (gm !== (provenanceKind !== null && typeof row.imported === 'boolean')
    || (!gm && row.imported !== null)
    || (gm && row.imported !== (provenanceKind === 'imported'))) {
    return fail('breeding.gm-egg.invalid-invariant', path, 'GM alone may receive the bounded provenance classification.')
  }
  const startingLevel = minute(row.startingLevel, `${path}.startingLevel`)
  if (startingLevel < 1 || startingLevel > 100) return fail('breeding.gm-egg.invalid-invariant', `${path}.startingLevel`, 'must be 1 through 100.')
  return Object.freeze({
    schemaVersion: 1,
    audience: row.audience,
    eggId,
    eggRevision: 0,
    sourceKind: 'gm',
    provenanceKind,
    status: 'incubating',
    startingLevel,
    parentSnapshotCount: 0,
    traitsBounded: true,
    imported: row.imported as boolean | null,
    createdAtCampaignMinute: minute(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`),
    operationId,
  })
}
