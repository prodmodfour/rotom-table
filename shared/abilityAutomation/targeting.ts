import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_TARGETING_PREDICATE_KIND = 'ability-targeting' as const
export const ABILITY_TARGET_RELATIONSHIPS = ['self', 'other', 'ally', 'enemy', 'same-side', 'any'] as const
export const ABILITY_TARGET_WILLINGNESS = ['any', 'willing', 'unwilling'] as const
export const ABILITY_TARGET_VISIBILITY_POLICIES = ['required', 'ignored'] as const
export const ABILITY_TARGET_LINE_OF_SIGHT_POLICIES = ['required', 'ignored'] as const
export const ABILITY_TARGET_GEOMETRY_KINDS = ['direct', 'adjacent', 'area'] as const
export const ABILITY_TARGET_AREA_TEMPLATE_KINDS = [
  'burst', 'close-blast', 'ranged-blast', 'cone', 'line', 'cardinally-adjacent',
] as const

export type AbilityTargetRelationship = (typeof ABILITY_TARGET_RELATIONSHIPS)[number]
export type AbilityTargetWillingness = (typeof ABILITY_TARGET_WILLINGNESS)[number]
export type AbilityTargetVisibilityPolicy = (typeof ABILITY_TARGET_VISIBILITY_POLICIES)[number]
export type AbilityTargetLineOfSightPolicy = (typeof ABILITY_TARGET_LINE_OF_SIGHT_POLICIES)[number]
export type AbilityTargetAreaTemplateKind = (typeof ABILITY_TARGET_AREA_TEMPLATE_KINDS)[number]

export type AbilityTargetGeometry =
  | { readonly kind: 'direct' }
  | { readonly kind: 'adjacent'; readonly cardinalOnly: boolean }
  | {
      readonly kind: 'area'
      readonly templateKind: AbilityTargetAreaTemplateKind
      readonly size: number
      readonly range: number | null
    }

export interface AbilityTargetingPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_TARGETING_PREDICATE_KIND
  readonly relationship: AbilityTargetRelationship
  readonly willingness: AbilityTargetWillingness
  readonly excludeActor: boolean
  readonly minimumRange: number
  readonly maximumRange: number | null
  readonly visibility: AbilityTargetVisibilityPolicy
  readonly lineOfSight: AbilityTargetLineOfSightPolicy
  readonly geometry: AbilityTargetGeometry
}

export class AbilityTargetingValidationError extends Error {
  constructor(readonly code: 'invalid-targeting' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityTargetingValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = [
  'kind', 'relationship', 'willingness', 'excludeActor', 'minimumRange', 'maximumRange',
  'visibility', 'lineOfSight', 'geometry',
] as const
const GEOMETRY_FIELDS: Readonly<Record<'direct' | 'adjacent' | 'area', readonly string[]>> = {
  direct: ['kind'], adjacent: ['kind', 'cardinalOnly'],
  area: ['kind', 'templateKind', 'size', 'range'],
}
const fail = (code: AbilityTargetingValidationError['code'], path: string, detail: string): never => {
  throw new AbilityTargetingValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-targeting', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-targeting', path, 'has invalid shape.')
}
const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value) ? value as Value : fail('invalid-targeting', path, 'is unsupported.')
)
const range = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    fail('invalid-targeting', path, 'must be an integer from 0 through 10000.')
  }
  return Number(value)
}

export const parseAbilityTargetingPredicate = (
  value: unknown,
  path = 'abilityTargeting',
): AbilityTargetingPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 5, nodes: 128, objectFields: 16, arrayEntries: 16, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability targeting predicate', valueLabel: 'ability targeting predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.kind !== ABILITY_TARGETING_PREDICATE_KIND || typeof input.excludeActor !== 'boolean') {
    fail('invalid-targeting', path, 'has an invalid kind or actor policy.')
  }
  const minimumRange = range(input.minimumRange, `${path}.minimumRange`)
  const maximumRange = input.maximumRange === null ? null : range(input.maximumRange, `${path}.maximumRange`)
  if (maximumRange !== null && minimumRange > maximumRange) {
    fail('invalid-targeting', path, 'range bounds are inverted.')
  }
  const geometryInput = record(input.geometry, `${path}.geometry`)
  if (typeof geometryInput.kind !== 'string'
    || !ABILITY_TARGET_GEOMETRY_KINDS.includes(geometryInput.kind as never)) {
    fail('invalid-targeting', `${path}.geometry.kind`, 'is unsupported.')
  }
  const geometryKind = geometryInput.kind as 'direct' | 'adjacent' | 'area'
  exact(geometryInput, GEOMETRY_FIELDS[geometryKind], `${path}.geometry`)
  let geometry: AbilityTargetGeometry
  if (geometryKind === 'direct') geometry = Object.freeze({ kind: 'direct' })
  else if (geometryKind === 'adjacent') {
    if (typeof geometryInput.cardinalOnly !== 'boolean') {
      fail('invalid-targeting', `${path}.geometry.cardinalOnly`, 'must be boolean.')
    }
    geometry = Object.freeze({ kind: 'adjacent', cardinalOnly: geometryInput.cardinalOnly as boolean })
  }
  else {
    const templateKind = oneOf(
      geometryInput.templateKind,
      `${path}.geometry.templateKind`,
      ABILITY_TARGET_AREA_TEMPLATE_KINDS,
    )
    const size = range(geometryInput.size, `${path}.geometry.size`)
    if (size < 1 || size > 100) fail('invalid-targeting', `${path}.geometry.size`, 'must be 1 through 100.')
    const templateRange = geometryInput.range === null
      ? null
      : range(geometryInput.range, `${path}.geometry.range`)
    if ((templateKind === 'ranged-blast') !== (templateRange !== null)) {
      fail('invalid-targeting', `${path}.geometry.range`, 'is required only for ranged blast.')
    }
    geometry = Object.freeze({ kind: 'area', templateKind, size, range: templateRange })
  }
  if (geometry.kind === 'adjacent' && (minimumRange > 1 || maximumRange !== 1)) {
    fail('invalid-targeting', path, 'adjacency requires maximum range 1.')
  }
  return deepFreezeStrictJson({
    kind: ABILITY_TARGETING_PREDICATE_KIND,
    relationship: oneOf(input.relationship, `${path}.relationship`, ABILITY_TARGET_RELATIONSHIPS),
    willingness: oneOf(input.willingness, `${path}.willingness`, ABILITY_TARGET_WILLINGNESS),
    excludeActor: input.excludeActor as boolean,
    minimumRange,
    maximumRange,
    visibility: oneOf(input.visibility, `${path}.visibility`, ABILITY_TARGET_VISIBILITY_POLICIES),
    lineOfSight: oneOf(input.lineOfSight, `${path}.lineOfSight`, ABILITY_TARGET_LINE_OF_SIGHT_POLICIES),
    geometry,
  }) as AbilityTargetingPredicate
}
