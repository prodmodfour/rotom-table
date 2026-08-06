import { isSlug } from '../paths'
import { parseBreedingOperationIdSyntax, parsePokemonEggIdSyntax, type BreedingOperationId, type PokemonEggId } from './ids'

export type PokemonEggHatchCompletionAudienceV1 = 'owner' | 'gm'
export interface PokemonEggHatchCompletionProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: PokemonEggHatchCompletionAudienceV1
  readonly status: 'hatched'
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly childSheetSlug: string
  readonly childSheetRevision: 0 | 1
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly destinationKind: 'box' | 'team'
  readonly hatchedAtCampaignMinute: number
  readonly settlementOperationId: BreedingOperationId
}

export type PokemonEggHatchCompletionProjectionValidationCode =
  | 'breeding.hatch-completion.invalid-document'
  | 'breeding.hatch-completion.unknown-field'
  | 'breeding.hatch-completion.invalid-invariant'
export class PokemonEggHatchCompletionProjectionValidationError extends Error {
  readonly code: PokemonEggHatchCompletionProjectionValidationCode
  readonly path: string
  constructor(code: PokemonEggHatchCompletionProjectionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggHatchCompletionProjectionValidationError'
    this.code = code
    this.path = path
  }
}
const fail = (code: PokemonEggHatchCompletionProjectionValidationCode, path: string, message: string): never => {
  throw new PokemonEggHatchCompletionProjectionValidationError(code, path, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-completion.invalid-document', path, 'must be one plain data object.')
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-completion.unknown-field', path, 'must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-completion.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const integer = (value: unknown, path: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > 2_147_483_647) {
    return fail('breeding.hatch-completion.invalid-document', path, `must be a safe integer from ${minimum} through 2147483647.`)
  }
  return Number(value)
}
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.hatch-completion.invalid-document', path, 'must be a canonical sheet slug.')

export const parsePokemonEggHatchCompletionProjectionV1 = (
  value: unknown,
  path = 'pokemonEggHatchCompletionProjection',
): PokemonEggHatchCompletionProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'status', 'eggId', 'eggRevision', 'childSheetSlug', 'childSheetRevision',
    'ownerTrainerSlug', 'ownerTrainerRevision', 'destinationKind', 'hatchedAtCampaignMinute', 'settlementOperationId',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'owner' && row.audience !== 'gm') || row.status !== 'hatched'
    || (row.destinationKind !== 'box' && row.destinationKind !== 'team')
    || (row.childSheetRevision !== 0 && row.childSheetRevision !== 1)) {
    return fail('breeding.hatch-completion.invalid-invariant', path, 'must be a v1 owner/GM hatched projection with an initialized child and at most one atomic Marsupial-link revision.')
  }
  const eggId = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.hatch-completion.invalid-document', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const settlementOperationId = parseBreedingOperationIdSyntax(row.settlementOperationId)
    ?? fail('breeding.hatch-completion.invalid-document', `${path}.settlementOperationId`, 'must be a Breeding operation ID.')
  return Object.freeze({
    schemaVersion: 1,
    audience: row.audience,
    status: 'hatched',
    eggId,
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`, 1),
    childSheetSlug: slug(row.childSheetSlug, `${path}.childSheetSlug`),
    childSheetRevision: integer(row.childSheetRevision, `${path}.childSheetRevision`, 0) as 0 | 1,
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    ownerTrainerRevision: integer(row.ownerTrainerRevision, `${path}.ownerTrainerRevision`, 1),
    destinationKind: row.destinationKind,
    hatchedAtCampaignMinute: integer(row.hatchedAtCampaignMinute, `${path}.hatchedAtCampaignMinute`),
    settlementOperationId,
  }) as PokemonEggHatchCompletionProjectionV1
}
