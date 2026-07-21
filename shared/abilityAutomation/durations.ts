import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION = 1 as const
export const ABILITY_EFFECT_DURATION_KINDS = [
  'turn',
  'round',
  'scene',
  'source-presence',
  'source-ability',
  'target-presence',
  'weather',
  'terrain',
  'until-triggered',
] as const
export type AbilityEffectDurationKind = (typeof ABILITY_EFFECT_DURATION_KINDS)[number]
export type AbilityEffectBoundary = 'start' | 'end'

export type AbilityEffectDuration =
  | {
      readonly kind: 'turn'
      readonly subject: 'source' | 'target'
      readonly subjectPlacementId: string
      readonly boundary: AbilityEffectBoundary
      readonly remaining: number
    }
  | {
      readonly kind: 'round'
      readonly boundary: AbilityEffectBoundary
      readonly remaining: number
    }
  | { readonly kind: 'scene' }
  | { readonly kind: 'source-presence' }
  | { readonly kind: 'source-ability' }
  | {
      readonly kind: 'target-presence'
      readonly policy: 'any-target-leaves' | 'all-targets-leave'
    }
  | { readonly kind: 'weather'; readonly fieldId: string }
  | { readonly kind: 'terrain'; readonly fieldId: string }
  | { readonly kind: 'until-triggered'; readonly triggerId: string }

export interface AbilityEffectLifecycleEntry {
  readonly effectId: string
  readonly sourcePlacementId: string
  readonly sourceAbilityInstanceId: string
  readonly targetPlacementIds: readonly string[]
  readonly duration: AbilityEffectDuration
}

export interface AbilityEffectLifecycleState {
  readonly schemaVersion: typeof ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION
  readonly entries: readonly AbilityEffectLifecycleEntry[]
}

export const ABILITY_EFFECT_LIFECYCLE_LIMITS = Object.freeze({
  entries: 512,
  targetsPerEffect: 64,
  roundsOrTurns: 10_000,
  identifierLength: 200,
})

export type AbilityEffectLifecycleValidationCode =
  | 'invalid-lifecycle'
  | 'duplicate-effect-id'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityEffectLifecycleValidationError extends Error {
  readonly code: AbilityEffectLifecycleValidationCode
  readonly path: string

  constructor(code: AbilityEffectLifecycleValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityEffectLifecycleValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'entries'] as const
const ENTRY_FIELDS = [
  'effectId', 'sourcePlacementId', 'sourceAbilityInstanceId', 'targetPlacementIds', 'duration',
] as const
const DURATION_FIELDS: Record<AbilityEffectDurationKind, readonly string[]> = {
  turn: ['kind', 'subject', 'subjectPlacementId', 'boundary', 'remaining'],
  round: ['kind', 'boundary', 'remaining'],
  scene: ['kind'],
  'source-presence': ['kind'],
  'source-ability': ['kind'],
  'target-presence': ['kind', 'policy'],
  weather: ['kind', 'fieldId'],
  terrain: ['kind', 'fieldId'],
  'until-triggered': ['kind', 'triggerId'],
}
const KIND_SET = new Set<string>(ABILITY_EFFECT_DURATION_KINDS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: AbilityEffectLifecycleValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityEffectLifecycleValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 7,
    nodes: 16_384,
    objectFields: 12,
    arrayEntries: ABILITY_EFFECT_LIFECYCLE_LIMITS.entries,
    stringLength: ABILITY_EFFECT_LIFECYCLE_LIMITS.identifierLength,
    objectKeyLength: ABILITY_EFFECT_LIFECYCLE_LIMITS.identifierLength,
  },
  rootLabel: 'ability effect lifecycle',
  valueLabel: 'ability effect lifecycle state',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-lifecycle', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) fail('invalid-lifecycle', path, 'has an invalid shape.')
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_EFFECT_LIFECYCLE_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)
  ) return fail('invalid-lifecycle', path, 'must be a bounded stable identifier.')
  return value
}

const remaining = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > ABILITY_EFFECT_LIFECYCLE_LIMITS.roundsOrTurns
  ) return fail('invalid-lifecycle', path, 'must be a bounded positive count.')
  return Number(value)
}

export const parseAbilityEffectDuration = (
  value: unknown,
  path = 'abilityEffectDuration',
): AbilityEffectDuration => {
  const input = record(value, path)
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    fail('invalid-lifecycle', `${path}.kind`, 'is unsupported.')
  }
  const kind = input.kind as AbilityEffectDurationKind
  exact(input, DURATION_FIELDS[kind], path)
  if (kind === 'turn') {
    if (input.subject !== 'source' && input.subject !== 'target') {
      fail('invalid-lifecycle', `${path}.subject`, 'must be source or target.')
    }
    if (input.boundary !== 'start' && input.boundary !== 'end') {
      fail('invalid-lifecycle', `${path}.boundary`, 'must be start or end.')
    }
    return Object.freeze({
      kind,
      subject: input.subject as 'source' | 'target',
      subjectPlacementId: stableId(input.subjectPlacementId, `${path}.subjectPlacementId`),
      boundary: input.boundary as AbilityEffectBoundary,
      remaining: remaining(input.remaining, `${path}.remaining`),
    })
  }
  if (kind === 'round') {
    if (input.boundary !== 'start' && input.boundary !== 'end') {
      fail('invalid-lifecycle', `${path}.boundary`, 'must be start or end.')
    }
    return Object.freeze({
      kind,
      boundary: input.boundary as AbilityEffectBoundary,
      remaining: remaining(input.remaining, `${path}.remaining`),
    })
  }
  if (kind === 'target-presence') {
    if (input.policy !== 'any-target-leaves' && input.policy !== 'all-targets-leave') {
      fail('invalid-lifecycle', `${path}.policy`, 'is unsupported.')
    }
    return Object.freeze({
      kind,
      policy: input.policy as 'any-target-leaves' | 'all-targets-leave',
    })
  }
  if (kind === 'weather' || kind === 'terrain') {
    return Object.freeze({ kind, fieldId: stableId(input.fieldId, `${path}.fieldId`) })
  }
  if (kind === 'until-triggered') {
    return Object.freeze({ kind, triggerId: stableId(input.triggerId, `${path}.triggerId`) })
  }
  return Object.freeze({ kind }) as AbilityEffectDuration
}

export const createEmptyAbilityEffectLifecycleState = (): AbilityEffectLifecycleState => ({
  schemaVersion: ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION,
  entries: [],
})

export const parseAbilityEffectLifecycleState = (
  value: unknown,
  path = 'abilityEffectLifecycle',
): AbilityEffectLifecycleState => {
  const input = record(clone(value, path), path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION) {
    fail('invalid-lifecycle', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_EFFECT_LIFECYCLE_LIMITS.entries) {
    fail('limit-exceeded', `${path}.entries`, 'must be a bounded array.')
  }
  const entries = (input.entries as readonly unknown[]).map((value, index): AbilityEffectLifecycleEntry => {
    const entryPath = `${path}.entries[${index}]`
    const entry = record(value, entryPath)
    exact(entry, ENTRY_FIELDS, entryPath)
    if (!Array.isArray(entry.targetPlacementIds)
      || entry.targetPlacementIds.length > ABILITY_EFFECT_LIFECYCLE_LIMITS.targetsPerEffect) {
      fail('limit-exceeded', `${entryPath}.targetPlacementIds`, 'must be a bounded array.')
    }
    const targetPlacementIds = (entry.targetPlacementIds as readonly unknown[]).map((id, targetIndex) => (
      stableId(id, `${entryPath}.targetPlacementIds[${targetIndex}]`)
    ))
    if (new Set(targetPlacementIds).size !== targetPlacementIds.length) {
      fail('invalid-lifecycle', `${entryPath}.targetPlacementIds`, 'must not repeat targets.')
    }
    const duration = parseAbilityEffectDuration(entry.duration, `${entryPath}.duration`)
    if (duration.kind === 'target-presence' && targetPlacementIds.length === 0) {
      fail('invalid-lifecycle', entryPath, 'target-presence duration requires targets.')
    }
    if (
      duration.kind === 'turn'
      && duration.subject === 'target'
      && !targetPlacementIds.includes(duration.subjectPlacementId)
    ) fail('invalid-lifecycle', entryPath, 'target turn subject must be one of the targets.')
    if (
      duration.kind === 'turn'
      && duration.subject === 'source'
      && duration.subjectPlacementId !== entry.sourcePlacementId
    ) fail('invalid-lifecycle', entryPath, 'source turn subject must match the source.')
    return Object.freeze({
      effectId: stableId(entry.effectId, `${entryPath}.effectId`),
      sourcePlacementId: stableId(entry.sourcePlacementId, `${entryPath}.sourcePlacementId`),
      sourceAbilityInstanceId: stableId(
        entry.sourceAbilityInstanceId,
        `${entryPath}.sourceAbilityInstanceId`,
      ),
      targetPlacementIds: Object.freeze(targetPlacementIds),
      duration,
    })
  })
  if (new Set(entries.map(entry => entry.effectId)).size !== entries.length) {
    fail('duplicate-effect-id', `${path}.entries`, 'must not repeat effect IDs.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION,
    entries,
  })
}
