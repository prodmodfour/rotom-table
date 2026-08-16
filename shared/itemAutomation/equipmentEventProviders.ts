import type {
  AbilityActionEventTiming,
  AbilityConditionOperation,
  AbilityEncounterEventKind,
  AbilityEventCheckpoint,
  AbilityFaintTransition,
  AbilityHpChangeKind,
  AbilityItemChange,
  AbilityLifecycleBoundary,
  AbilityLifecycleTransition,
  AbilityMoveDamageClass,
  AbilityMoveEventTiming,
  AbilityMoveKeyword,
  AbilityMovementCheckpoint,
  AbilityStrikeAccuracyOutcome,
  AbilityStrikeEventTiming,
} from '../abilityAutomation/events'
import type { PokemonTypeId } from '../pokemonTypes'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const EQUIPMENT_EVENT_PROVIDER_SCHEMA_VERSION = 1 as const
export type EquipmentProviderOwnerRole =
  | 'actor' | 'target' | 'user' | 'subject' | 'attacker' | 'defender'
  | 'before' | 'after' | 'either' | 'global'
export type EquipmentProviderRelationship = 'any' | 'foe'

export interface EquipmentActionEventPredicateV1 {
  readonly kind: 'action'
  readonly ownerRole: 'actor' | 'target'
  readonly actionIds: readonly string[]
  readonly timings: readonly AbilityActionEventTiming[]
}
export interface EquipmentMoveEventPredicateV1 {
  readonly kind: 'move'
  readonly ownerRole: 'user' | 'target'
  readonly timings: readonly AbilityMoveEventTiming[]
  readonly canonicalMoveIds: readonly string[]
  readonly keywordsAny: readonly AbilityMoveKeyword[]
  readonly damageClasses: readonly AbilityMoveDamageClass[]
  readonly configuredType: boolean
}
export interface EquipmentStrikeEventPredicateV1 {
  readonly kind: 'strike'
  readonly ownerRole: 'attacker' | 'defender'
  readonly timings: readonly AbilityStrikeEventTiming[]
  readonly accuracyOutcomes: readonly AbilityStrikeAccuracyOutcome[]
  readonly directOnly: boolean
  readonly minimumTotalLoss: number | null
  readonly naturalAccuracyMinimum: number | null
  readonly relationship: EquipmentProviderRelationship
  readonly canonicalMoveIds?: readonly string[]
}
export interface EquipmentHpEventPredicateV1 {
  readonly kind: 'hp'
  readonly ownerRole: 'subject' | 'actor'
  readonly changeKinds: readonly AbilityHpChangeKind[]
  readonly faintTransitions: readonly AbilityFaintTransition[]
  readonly beforeAtMaximum: boolean | null
  readonly reasonCodes: readonly string[]
  readonly moveSourced: boolean | null
}
export interface EquipmentConditionEventPredicateV1 {
  readonly kind: 'condition'
  readonly ownerRole: 'subject'
  readonly conditionIds: readonly string[]
  readonly operations: readonly AbilityConditionOperation[]
  readonly sourceMoveIds: readonly string[]
}
export interface EquipmentItemEventPredicateV1 {
  readonly kind: 'item'
  readonly ownerRole: 'before' | 'after' | 'either'
  readonly changes: readonly AbilityItemChange[]
}
export interface EquipmentLifecycleEventPredicateV1 {
  readonly kind: 'lifecycle'
  readonly ownerRole: 'subject' | 'global'
  readonly boundaries: readonly AbilityLifecycleBoundary[]
  readonly transitions: readonly AbilityLifecycleTransition[]
}
export interface EquipmentMovementEventPredicateV1 {
  readonly kind: 'movement'
  readonly ownerRole: 'subject'
  readonly checkpoints: readonly AbilityMovementCheckpoint[]
}
export type EquipmentEventPredicateV1 =
  | EquipmentActionEventPredicateV1
  | EquipmentMoveEventPredicateV1
  | EquipmentStrikeEventPredicateV1
  | EquipmentHpEventPredicateV1
  | EquipmentConditionEventPredicateV1
  | EquipmentItemEventPredicateV1
  | EquipmentLifecycleEventPredicateV1
  | EquipmentMovementEventPredicateV1

export interface EquipmentProviderEffectBaseV1 { readonly reasonCode: string }
export type EquipmentProviderEffectV1 =
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'prevent-move' })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'add-resistance-step'; readonly steps: number })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'prevent-condition'; readonly conditionId: string })
  | (EquipmentProviderEffectBaseV1 & {
      readonly kind: 'multiply-hp-change'; readonly changeKind: 'drain'
      readonly numerator: number; readonly denominator: number
    })
  | (EquipmentProviderEffectBaseV1 & {
      readonly kind: 'apply-condition'; readonly conditionId: string
      readonly duration: 'turn' | 'encounter' | 'persistent'
    })
  | (EquipmentProviderEffectBaseV1 & {
      readonly kind: 'survive-at-one'
      readonly roll: { readonly sides: 20; readonly minimum: number } | null
      readonly requiresMoveDamageFromMaximum: boolean
    })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'prevent-hp-change' })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'remove-type-immunity'; readonly typeId: PokemonTypeId })
  | (EquipmentProviderEffectBaseV1 & {
      readonly kind: 'lose-max-hp-fraction'; readonly numerator: number; readonly denominator: number
    })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'add-injury'; readonly amount: number })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'gain-temporary-hp-ticks'; readonly ticks: number })
  | (EquipmentProviderEffectBaseV1 & { readonly kind: 'prevent-action'; readonly actionId: string })
  | (EquipmentProviderEffectBaseV1 & {
      readonly kind: 'apply-readied-shield'; readonly evasion: number
      readonly damageReduction: number; readonly conditionId: 'Slowed'
      readonly duration: 'through-next-turn'
    })
  | (EquipmentProviderEffectBaseV1 & {
      readonly kind: 'consume-source-and-add-damage-base'; readonly amount: number
    })

export interface EquipmentProviderChoiceOptionV1 {
  readonly optionId: string
  readonly label: string
}
export type EquipmentProviderChoiceV1 =
  | { readonly kind: 'automatic' }
  | { readonly kind: 'owner-choice'; readonly options: readonly EquipmentProviderChoiceOptionV1[] }

export interface EquipmentEventProviderV1 {
  readonly providerId: string
  readonly label: string
  readonly eventKind: AbilityEncounterEventKind
  readonly checkpoint: AbilityEventCheckpoint
  readonly predicate: EquipmentEventPredicateV1
  readonly frequency: {
    readonly kind: 'at-will' | 'scene'
    readonly consume: 'on-applied' | 'on-matched'
  }
  readonly priority: number
  readonly response: 'mandatory' | 'optional'
  readonly choice: EquipmentProviderChoiceV1
  readonly privacy: {
    readonly source: 'public' | 'owner-gm'
    readonly outcome: 'public' | 'owner-gm'
  }
  /** A source/provider binding may execute only once within one causal ancestry. */
  readonly oncePerCausalChain: true
  readonly acceptedEffectSurvivesSourceLoss: true
  readonly effect: EquipmentProviderEffectV1
}
export interface EquipmentEventProviderDefinitionV1 {
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  readonly equipmentDefinitionSha256: string
  readonly providers: readonly EquipmentEventProviderV1[]
}
export interface EquipmentEventProviderDocumentV1 {
  readonly schemaVersion: typeof EQUIPMENT_EVENT_PROVIDER_SCHEMA_VERSION
  readonly ticket: 'P8-048'
  readonly catalogSha256: string
  readonly equipmentDefinitionsSha256: string
  readonly definitionCount: number
  readonly providingItemCount: number
  readonly providerCount: number
  readonly classificationPolicy: {
    readonly status: 'reviewed'
    readonly runtimeProseParsing: false
    readonly inactiveOrSuppressedPolicy: 'withdraw-future-subscriptions-immediately'
    readonly acceptedEffectPolicy: 'accepted-durable-effects-survive-source-loss'
    readonly eventAuthority: 'typed-server-events-only'
    readonly replayPolicy: 'receipt-bound-no-reroll'
  }
  readonly definitions: readonly EquipmentEventProviderDefinitionV1[]
}

export class EquipmentEventProviderValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentEventProviderValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const STABLE_ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const EVENT_KINDS = new Set(['action', 'move', 'strike', 'hp', 'condition', 'movement', 'item', 'lifecycle'])
const CHECKPOINTS = new Set(['declaration', 'pre-effect', 'post-effect', 'after-commit', 'lifecycle'])
const MOVE_TIMINGS = new Set(['declared', 'use-started', 'accuracy-resolved', 'effects-resolved', 'completed', 'cancelled'])
const ACTION_TIMINGS = new Set(['declared', 'started', 'completed', 'cancelled'])
const STRIKE_TIMINGS = new Set(['accuracy-resolved', 'damage-resolved'])
const ACCURACY_OUTCOMES = new Set(['hit', 'automatic-hit', 'miss', 'prevented'])
const HP_KINDS = new Set(['damage', 'healing', 'drain', 'recoil', 'cost', 'set', 'temporary-gain', 'temporary-loss', 'injury', 'revive'])
const FAINT_TRANSITIONS = new Set(['none', 'fainted', 'revived'])
const CONDITION_OPERATIONS = new Set(['apply', 'remove', 'save', 'cure', 'reset', 'transfer'])
const ITEM_CHANGES = new Set(['added', 'removed', 'used', 'consumed', 'equipped', 'unequipped', 'transferred', 'dropped', 'picked-up', 'digestion-traded'])
const LIFECYCLE_BOUNDARIES = new Set(['scene', 'round', 'turn', 'presence', 'effective-ability', 'form'])
const LIFECYCLE_TRANSITIONS = new Set(['started', 'ended', 'entered', 'left', 'became-effective', 'became-ineffective', 'changed'])
const MOVE_KEYWORDS = new Set(['aura', 'berry', 'blessing', 'coat', 'dash', 'double-strike', 'exhaust', 'execute', 'field', 'five-strike', 'fling', 'friendly', 'groundsource', 'hazard', 'healing', 'illusion', 'interrupt', 'pass', 'pledge', 'powder', 'priority', 'priority-limited', 'push', 'reaction', 'reckless', 'recoil', 'set-up', 'shield', 'smite', 'social', 'sonic', 'spirit-surge', 'trigger', 'weather'])
const MOVE_DAMAGE_CLASSES = new Set(['physical', 'special', 'status'])
const MOVEMENT_CHECKPOINTS = new Set(['pre-step', 'post-step'])
const POKEMON_TYPES = new Set(['bug', 'dark', 'dragon', 'electric', 'fairy', 'fighting', 'fire', 'flying', 'ghost', 'grass', 'ground', 'ice', 'normal', 'poison', 'psychic', 'rock', 'steel', 'water'])

const fail = (path: string, detail: string): never => { throw new EquipmentEventProviderValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail(path, 'must be bounded trimmed text.')
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const result = text(value, path)
  if (!STABLE_ID.test(result)) fail(path, 'must be a lowercase stable identity.')
  return result
}
const hash = (value: unknown, path: string): string => {
  const result = text(value, path, 64)
  if (!SHA256.test(result)) fail(path, 'must be a lowercase SHA-256 digest.')
  return result
}
const bool = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'must be boolean.')
  return value as boolean
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(path, `must be an integer from ${minimum} through ${maximum}.`)
  return Number(value)
}
const nullableInteger = (value: unknown, path: string, minimum: number, maximum: number): number | null => (
  value === null ? null : integer(value, path, minimum, maximum)
)
const nullableBool = (value: unknown, path: string): boolean | null => value === null ? null : bool(value, path)
const oneOf = <Value extends string>(value: unknown, values: ReadonlySet<string>, path: string): Value => {
  if (typeof value !== 'string' || !values.has(value)) fail(path, 'is unsupported.')
  return value as Value
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array with at most ${maximum} entries.`)
  return value as readonly unknown[]
}
const texts = (value: unknown, path: string, maximum: number): readonly string[] => {
  const result = array(value, path, maximum).map((entry, index) => text(entry, `${path}[${index}]`))
  if (new Set(result).size !== result.length) fail(path, 'must contain unique values.')
  return result
}
const enums = <Value extends string>(value: unknown, values: ReadonlySet<string>, path: string, maximum: number): readonly Value[] => (
  texts(value, path, maximum).map((entry, index) => oneOf<Value>(entry, values, `${path}[${index}]`))
)

const parsePredicate = (value: unknown, eventKind: AbilityEncounterEventKind, path: string): EquipmentEventPredicateV1 => {
  const input = record(value, path)
  if (input.kind !== eventKind) fail(`${path}.kind`, 'must match the provider event kind.')
  if (eventKind === 'action') {
    exact(input, ['kind', 'ownerRole', 'actionIds', 'timings'], path)
    return { kind: 'action', ownerRole: oneOf(input.ownerRole, new Set(['actor', 'target']), `${path}.ownerRole`), actionIds: texts(input.actionIds, `${path}.actionIds`, 32), timings: enums(input.timings, ACTION_TIMINGS, `${path}.timings`, 4) }
  }
  if (eventKind === 'move') {
    exact(input, ['kind', 'ownerRole', 'timings', 'canonicalMoveIds', 'keywordsAny', 'damageClasses', 'configuredType'], path)
    const predicate: EquipmentMoveEventPredicateV1 = { kind: 'move', ownerRole: oneOf(input.ownerRole, new Set(['user', 'target']), `${path}.ownerRole`), timings: enums(input.timings, MOVE_TIMINGS, `${path}.timings`, 6), canonicalMoveIds: texts(input.canonicalMoveIds, `${path}.canonicalMoveIds`, 32), keywordsAny: enums(input.keywordsAny, MOVE_KEYWORDS, `${path}.keywordsAny`, 40), damageClasses: enums(input.damageClasses, MOVE_DAMAGE_CLASSES, `${path}.damageClasses`, 3), configuredType: bool(input.configuredType, `${path}.configuredType`) }
    if (!predicate.timings.length || (!predicate.canonicalMoveIds.length && !predicate.keywordsAny.length && !predicate.damageClasses.length && !predicate.configuredType)) fail(path, 'must constrain timing and at least one move fact.')
    return predicate
  }
  if (eventKind === 'strike') {
    const fields = ['kind', 'ownerRole', 'timings', 'accuracyOutcomes', 'directOnly', 'minimumTotalLoss', 'naturalAccuracyMinimum', 'relationship']
    const hasMoves = Object.hasOwn(input, 'canonicalMoveIds')
    exact(input, hasMoves ? [...fields, 'canonicalMoveIds'] : fields, path)
    const result: EquipmentStrikeEventPredicateV1 = { kind: 'strike', ownerRole: oneOf(input.ownerRole, new Set(['attacker', 'defender']), `${path}.ownerRole`), timings: enums(input.timings, STRIKE_TIMINGS, `${path}.timings`, 2), accuracyOutcomes: enums(input.accuracyOutcomes, ACCURACY_OUTCOMES, `${path}.accuracyOutcomes`, 4), directOnly: bool(input.directOnly, `${path}.directOnly`), minimumTotalLoss: nullableInteger(input.minimumTotalLoss, `${path}.minimumTotalLoss`, 0, 10_000_000), naturalAccuracyMinimum: nullableInteger(input.naturalAccuracyMinimum, `${path}.naturalAccuracyMinimum`, 1, 20), relationship: oneOf(input.relationship, new Set(['any', 'foe']), `${path}.relationship`), ...(hasMoves ? { canonicalMoveIds: texts(input.canonicalMoveIds, `${path}.canonicalMoveIds`, 32) } : {}) }
    if (!result.timings.length) fail(path, 'must constrain strike timing.')
    return result
  }
  if (eventKind === 'hp') {
    exact(input, ['kind', 'ownerRole', 'changeKinds', 'faintTransitions', 'beforeAtMaximum', 'reasonCodes', 'moveSourced'], path)
    return { kind: 'hp', ownerRole: oneOf(input.ownerRole, new Set(['subject', 'actor']), `${path}.ownerRole`), changeKinds: enums(input.changeKinds, HP_KINDS, `${path}.changeKinds`, 10), faintTransitions: enums(input.faintTransitions, FAINT_TRANSITIONS, `${path}.faintTransitions`, 3), beforeAtMaximum: nullableBool(input.beforeAtMaximum, `${path}.beforeAtMaximum`), reasonCodes: texts(input.reasonCodes, `${path}.reasonCodes`, 32).map((entry, index) => stableId(entry, `${path}.reasonCodes[${index}]`)), moveSourced: nullableBool(input.moveSourced, `${path}.moveSourced`) }
  }
  if (eventKind === 'condition') {
    exact(input, ['kind', 'ownerRole', 'conditionIds', 'operations', 'sourceMoveIds'], path)
    if (input.ownerRole !== 'subject') fail(`${path}.ownerRole`, 'must be subject.')
    return { kind: 'condition', ownerRole: 'subject', conditionIds: texts(input.conditionIds, `${path}.conditionIds`, 32), operations: enums(input.operations, CONDITION_OPERATIONS, `${path}.operations`, 6), sourceMoveIds: texts(input.sourceMoveIds, `${path}.sourceMoveIds`, 32) }
  }
  if (eventKind === 'item') {
    exact(input, ['kind', 'ownerRole', 'changes'], path)
    return { kind: 'item', ownerRole: oneOf(input.ownerRole, new Set(['before', 'after', 'either']), `${path}.ownerRole`), changes: enums(input.changes, ITEM_CHANGES, `${path}.changes`, 10) }
  }
  if (eventKind === 'lifecycle') {
    exact(input, ['kind', 'ownerRole', 'boundaries', 'transitions'], path)
    return { kind: 'lifecycle', ownerRole: oneOf(input.ownerRole, new Set(['subject', 'global']), `${path}.ownerRole`), boundaries: enums(input.boundaries, LIFECYCLE_BOUNDARIES, `${path}.boundaries`, 6), transitions: enums(input.transitions, LIFECYCLE_TRANSITIONS, `${path}.transitions`, 7) }
  }
  if (eventKind === 'movement') {
    exact(input, ['kind', 'ownerRole', 'checkpoints'], path)
    if (input.ownerRole !== 'subject') fail(`${path}.ownerRole`, 'must be subject.')
    return { kind: 'movement', ownerRole: 'subject', checkpoints: enums(input.checkpoints, MOVEMENT_CHECKPOINTS, `${path}.checkpoints`, 2) }
  }
  return fail(path, `event kind ${eventKind} is not supported for equipment providers.`)
}

const parseEffect = (value: unknown, path: string): EquipmentProviderEffectV1 => {
  const input = record(value, path)
  const kind = text(input.kind, `${path}.kind`)
  const reasonCode = stableId(input.reasonCode, `${path}.reasonCode`)
  const base = { kind, reasonCode }
  if (kind === 'prevent-move' || kind === 'prevent-hp-change') {
    exact(input, ['kind', 'reasonCode'], path)
    return base as EquipmentProviderEffectV1
  }
  if (kind === 'add-resistance-step') {
    exact(input, ['kind', 'steps', 'reasonCode'], path)
    return { kind, steps: integer(input.steps, `${path}.steps`, 1, 4), reasonCode }
  }
  if (kind === 'prevent-condition') {
    exact(input, ['kind', 'conditionId', 'reasonCode'], path)
    return { kind, conditionId: text(input.conditionId, `${path}.conditionId`), reasonCode }
  }
  if (kind === 'multiply-hp-change') {
    exact(input, ['kind', 'changeKind', 'numerator', 'denominator', 'reasonCode'], path)
    if (input.changeKind !== 'drain') fail(`${path}.changeKind`, 'must be drain.')
    return { kind, changeKind: 'drain', numerator: integer(input.numerator, `${path}.numerator`, 1, 16), denominator: integer(input.denominator, `${path}.denominator`, 1, 16), reasonCode }
  }
  if (kind === 'apply-condition') {
    exact(input, ['kind', 'conditionId', 'duration', 'reasonCode'], path)
    return { kind, conditionId: text(input.conditionId, `${path}.conditionId`), duration: oneOf(input.duration, new Set(['turn', 'encounter', 'persistent']), `${path}.duration`), reasonCode }
  }
  if (kind === 'survive-at-one') {
    exact(input, ['kind', 'roll', 'requiresMoveDamageFromMaximum', 'reasonCode'], path)
    let roll: { sides: 20; minimum: number } | null = null
    if (input.roll !== null) {
      const source = record(input.roll, `${path}.roll`)
      exact(source, ['sides', 'minimum'], `${path}.roll`)
      if (source.sides !== 20) fail(`${path}.roll.sides`, 'must be 20.')
      roll = { sides: 20, minimum: integer(source.minimum, `${path}.roll.minimum`, 1, 20) }
    }
    return { kind, roll, requiresMoveDamageFromMaximum: bool(input.requiresMoveDamageFromMaximum, `${path}.requiresMoveDamageFromMaximum`), reasonCode }
  }
  if (kind === 'remove-type-immunity') {
    exact(input, ['kind', 'typeId', 'reasonCode'], path)
    return { kind, typeId: oneOf(input.typeId, POKEMON_TYPES, `${path}.typeId`), reasonCode }
  }
  if (kind === 'lose-max-hp-fraction') {
    exact(input, ['kind', 'numerator', 'denominator', 'reasonCode'], path)
    const numerator = integer(input.numerator, `${path}.numerator`, 1, 16)
    const denominator = integer(input.denominator, `${path}.denominator`, 1, 64)
    if (numerator >= denominator) fail(path, 'HP-loss fraction must be less than one.')
    return { kind, numerator, denominator, reasonCode }
  }
  if (kind === 'add-injury') {
    exact(input, ['kind', 'amount', 'reasonCode'], path)
    return { kind, amount: integer(input.amount, `${path}.amount`, 1, 10), reasonCode }
  }
  if (kind === 'gain-temporary-hp-ticks') {
    exact(input, ['kind', 'ticks', 'reasonCode'], path)
    return { kind, ticks: integer(input.ticks, `${path}.ticks`, 1, 10), reasonCode }
  }
  if (kind === 'prevent-action') {
    exact(input, ['kind', 'actionId', 'reasonCode'], path)
    return { kind, actionId: stableId(input.actionId, `${path}.actionId`), reasonCode }
  }
  if (kind === 'apply-readied-shield') {
    exact(input, ['kind', 'evasion', 'damageReduction', 'conditionId', 'duration', 'reasonCode'], path)
    if (input.conditionId !== 'Slowed' || input.duration !== 'through-next-turn') fail(path, 'readied shield lifecycle is invalid.')
    return { kind, evasion: integer(input.evasion, `${path}.evasion`, 1, 20), damageReduction: integer(input.damageReduction, `${path}.damageReduction`, 1, 100), conditionId: 'Slowed', duration: 'through-next-turn', reasonCode }
  }
  if (kind === 'consume-source-and-add-damage-base') {
    exact(input, ['kind', 'amount', 'reasonCode'], path)
    return { kind, amount: integer(input.amount, `${path}.amount`, 1, 10), reasonCode }
  }
  return fail(`${path}.kind`, 'is unsupported.')
}

const parseChoice = (value: unknown, response: 'mandatory' | 'optional', path: string): EquipmentProviderChoiceV1 => {
  const input = record(value, path)
  if (input.kind === 'automatic') {
    exact(input, ['kind'], path)
    if (response !== 'mandatory') fail(path, 'automatic providers must be mandatory.')
    return { kind: 'automatic' }
  }
  if (input.kind === 'owner-choice') {
    exact(input, ['kind', 'options'], path)
    if (response !== 'optional') fail(path, 'owner choices must be optional.')
    const options = array(input.options, `${path}.options`, 16).map((entry, index) => {
      const optionPath = `${path}.options[${index}]`
      const option = record(entry, optionPath)
      exact(option, ['optionId', 'label'], optionPath)
      return { optionId: stableId(option.optionId, `${optionPath}.optionId`), label: text(option.label, `${optionPath}.label`) }
    })
    if (options.length < 2 || new Set(options.map(option => option.optionId)).size !== options.length) fail(`${path}.options`, 'must contain at least two unique options.')
    return { kind: 'owner-choice', options }
  }
  return fail(`${path}.kind`, 'is unsupported.')
}

const parseProvider = (value: unknown, path: string): EquipmentEventProviderV1 => {
  const input = record(value, path)
  exact(input, ['providerId', 'label', 'eventKind', 'checkpoint', 'predicate', 'frequency', 'priority', 'response', 'choice', 'privacy', 'oncePerCausalChain', 'acceptedEffectSurvivesSourceLoss', 'effect'], path)
  const eventKind = oneOf<AbilityEncounterEventKind>(input.eventKind, EVENT_KINDS, `${path}.eventKind`)
  const checkpoint = oneOf<AbilityEventCheckpoint>(input.checkpoint, CHECKPOINTS, `${path}.checkpoint`)
  const response = oneOf<'mandatory' | 'optional'>(input.response, new Set(['mandatory', 'optional']), `${path}.response`)
  const frequency = record(input.frequency, `${path}.frequency`)
  exact(frequency, ['kind', 'consume'], `${path}.frequency`)
  const privacy = record(input.privacy, `${path}.privacy`)
  exact(privacy, ['source', 'outcome'], `${path}.privacy`)
  if (input.oncePerCausalChain !== true) fail(`${path}.oncePerCausalChain`, 'must be true.')
  if (input.acceptedEffectSurvivesSourceLoss !== true) fail(`${path}.acceptedEffectSurvivesSourceLoss`, 'must be true.')
  return {
    providerId: stableId(input.providerId, `${path}.providerId`),
    label: text(input.label, `${path}.label`),
    eventKind,
    checkpoint,
    predicate: parsePredicate(input.predicate, eventKind, `${path}.predicate`),
    frequency: { kind: oneOf(frequency.kind, new Set(['at-will', 'scene']), `${path}.frequency.kind`), consume: oneOf(frequency.consume, new Set(['on-applied', 'on-matched']), `${path}.frequency.consume`) },
    priority: integer(input.priority, `${path}.priority`, -1_000, 1_000),
    response,
    choice: parseChoice(input.choice, response, `${path}.choice`),
    privacy: { source: oneOf(privacy.source, new Set(['public', 'owner-gm']), `${path}.privacy.source`), outcome: oneOf(privacy.outcome, new Set(['public', 'owner-gm']), `${path}.privacy.outcome`) },
    oncePerCausalChain: true,
    acceptedEffectSurvivesSourceLoss: true,
    effect: parseEffect(input.effect, `${path}.effect`),
  }
}

export const parseEquipmentEventProviderDocument = (value: unknown): EquipmentEventProviderDocumentV1 => {
  const input = record(cloneStrictJson(value, 'equipmentEventProviders', {
    limits: { depth: 12, nodes: 50_000, objectFields: 32, arrayEntries: 4_096, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'equipment event-provider data', valueLabel: 'equipment event providers',
    failNotJson: (path, detail) => fail(path, detail), failLimit: (path, detail) => fail(path, detail),
  }), 'equipmentEventProviders')
  exact(input, ['schemaVersion', 'ticket', 'catalogSha256', 'equipmentDefinitionsSha256', 'definitionCount', 'providingItemCount', 'providerCount', 'classificationPolicy', 'definitions'], 'equipmentEventProviders')
  if (input.schemaVersion !== 1 || input.ticket !== 'P8-048') fail('equipmentEventProviders.schemaVersion', 'is unsupported.')
  const policy = record(input.classificationPolicy, 'equipmentEventProviders.classificationPolicy')
  exact(policy, ['status', 'runtimeProseParsing', 'inactiveOrSuppressedPolicy', 'acceptedEffectPolicy', 'eventAuthority', 'replayPolicy'], 'equipmentEventProviders.classificationPolicy')
  if (policy.status !== 'reviewed' || policy.runtimeProseParsing !== false
    || policy.inactiveOrSuppressedPolicy !== 'withdraw-future-subscriptions-immediately'
    || policy.acceptedEffectPolicy !== 'accepted-durable-effects-survive-source-loss'
    || policy.eventAuthority !== 'typed-server-events-only'
    || policy.replayPolicy !== 'receipt-bound-no-reroll') fail('equipmentEventProviders.classificationPolicy', 'must retain reviewed authority and replay policy.')
  const definitions = array(input.definitions, 'equipmentEventProviders.definitions', 256).map((entry, index): EquipmentEventProviderDefinitionV1 => {
    const path = `equipmentEventProviders.definitions[${index}]`
    const row = record(entry, path)
    exact(row, ['canonicalItemId', 'canonicalRecordSha256', 'equipmentDefinitionSha256', 'providers'], path)
    const providers = array(row.providers, `${path}.providers`, 16).map((provider, providerIndex) => parseProvider(provider, `${path}.providers[${providerIndex}]`))
    if (new Set(providers.map(provider => provider.providerId)).size !== providers.length) fail(`${path}.providers`, 'must not repeat provider IDs.')
    return { canonicalItemId: text(row.canonicalItemId, `${path}.canonicalItemId`), canonicalRecordSha256: hash(row.canonicalRecordSha256, `${path}.canonicalRecordSha256`), equipmentDefinitionSha256: hash(row.equipmentDefinitionSha256, `${path}.equipmentDefinitionSha256`), providers }
  })
  const definitionCount = integer(input.definitionCount, 'equipmentEventProviders.definitionCount', 0, 256)
  const providingItemCount = integer(input.providingItemCount, 'equipmentEventProviders.providingItemCount', 0, 256)
  const providerCount = integer(input.providerCount, 'equipmentEventProviders.providerCount', 0, 4_096)
  if (definitionCount !== definitions.length || providingItemCount !== definitions.filter(row => row.providers.length).length || providerCount !== definitions.reduce((sum, row) => sum + row.providers.length, 0)) fail('equipmentEventProviders', 'declared counts do not match definitions.')
  if (new Set(definitions.map(row => row.canonicalItemId)).size !== definitions.length || new Set(definitions.flatMap(row => row.providers.map(provider => provider.providerId))).size !== providerCount) fail('equipmentEventProviders.definitions', 'must use globally unique item and provider identities.')
  return deepFreezeStrictJson({ schemaVersion: EQUIPMENT_EVENT_PROVIDER_SCHEMA_VERSION, ticket: 'P8-048', catalogSha256: hash(input.catalogSha256, 'equipmentEventProviders.catalogSha256'), equipmentDefinitionsSha256: hash(input.equipmentDefinitionsSha256, 'equipmentEventProviders.equipmentDefinitionsSha256'), definitionCount, providingItemCount, providerCount, classificationPolicy: { status: 'reviewed', runtimeProseParsing: false, inactiveOrSuppressedPolicy: 'withdraw-future-subscriptions-immediately', acceptedEffectPolicy: 'accepted-durable-effects-survive-source-loss', eventAuthority: 'typed-server-events-only', replayPolicy: 'receipt-bound-no-reroll' }, definitions })
}
