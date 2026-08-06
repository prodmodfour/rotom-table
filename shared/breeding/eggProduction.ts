import { parsePokemonEggIdSyntax, type PokemonEggId } from './ids'

export interface BreedingEggProductionProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: 'egg-produced'
  readonly eggId: PokemonEggId
  readonly eggRevision: 0
  readonly projectRevision: number
  readonly producedAtCampaignMinute: number
  readonly sourceKind: 'breeding'
  readonly incubationStatus: 'incubating'
}
export type BreedingEggProductionValidationCode =
  | 'breeding.egg-production.invalid-document'
  | 'breeding.egg-production.unknown-field'
  | 'breeding.egg-production.invalid-id'
  | 'breeding.egg-production.invalid-invariant'
export class BreedingEggProductionValidationError extends Error {
  readonly code: BreedingEggProductionValidationCode
  readonly path: string
  constructor(code: BreedingEggProductionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingEggProductionValidationError'
    this.code = code
    this.path = path
  }
}
type Row = Record<string, unknown>
const fail = (code: BreedingEggProductionValidationCode, path: string, message: string): never => { throw new BreedingEggProductionValidationError(code, path, message) }
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.egg-production.invalid-document', path, 'must be a plain object without symbols.')
  const row = value as Row
  for (const key of Object.getOwnPropertyNames(row)) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.egg-production.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.egg-production.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail('breeding.egg-production.invalid-document', path, 'must be a nonnegative safe integer.')
export const parseBreedingEggProductionProjectionV1 = (value: unknown, path='eggProductionProjection'): BreedingEggProductionProjectionV1 => {
  const row = exact(value, ['schemaVersion','audience','status','eggId','eggRevision','projectRevision','producedAtCampaignMinute','sourceKind','incubationStatus'], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner') || row.status !== 'egg-produced'
    || row.eggRevision !== 0 || row.sourceKind !== 'breeding' || row.incubationStatus !== 'incubating') {
    return fail('breeding.egg-production.invalid-invariant', path, 'must be one bounded v1 produced-Egg projection.')
  }
  return Object.freeze({
    schemaVersion: 1,
    audience: row.audience,
    status: 'egg-produced',
    eggId: parsePokemonEggIdSyntax(row.eggId) ?? fail('breeding.egg-production.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'),
    eggRevision: 0,
    projectRevision: integer(row.projectRevision, `${path}.projectRevision`),
    producedAtCampaignMinute: integer(row.producedAtCampaignMinute, `${path}.producedAtCampaignMinute`),
    sourceKind: 'breeding',
    incubationStatus: 'incubating',
  })
}
