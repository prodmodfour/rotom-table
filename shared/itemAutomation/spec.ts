import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import type { EncounterProjectionAudience } from '../encounterPresentation/catalog'

export const ITEM_SPEC_SCHEMA_VERSION = 1 as const

export const ITEM_IMPLEMENTATION_STATES = [
  'native', 'guided', 'passive', 'reference-only', 'not-applicable', 'blocked',
] as const
export type ItemImplementationState = typeof ITEM_IMPLEMENTATION_STATES[number]

export const ITEM_CONTEXTS = [
  'encounter', 'sheet', 'campaign', 'workshop', 'extended-action', 'passive',
] as const
export type ItemContextKind = typeof ITEM_CONTEXTS[number]

export const ITEM_INTERACTION_ROLES = [
  'usable', 'equippable', 'passive', 'guided', 'reference-only', 'not-applicable',
] as const
export type ItemInteractionRole = typeof ITEM_INTERACTION_ROLES[number]

export const ITEM_TIMINGS = [
  'standard', 'shift', 'swift', 'full', 'free', 'extended', 'priority', 'interrupt', 'reaction', 'passive',
] as const
export type ItemTimingKind = typeof ITEM_TIMINGS[number]

export const ITEM_TARGET_KINDS = [
  'self', 'participant', 'side', 'inventory-row', 'equipment-slot', 'move', 'stat', 'skill', 'type', 'destination', 'gm-adjudication',
] as const
export type ItemTargetKind = typeof ITEM_TARGET_KINDS[number]

export const ITEM_OPERATION_KINDS = [
  'hp', 'temporary-hp', 'injury', 'condition', 'stage', 'resource', 'usage', 'inventory', 'equipment', 'effect', 'form', 'move', 'ability', 'capability', 'evolution', 'campaign-fact', 'attention-item',
] as const
export type ItemOperationKind = typeof ITEM_OPERATION_KINDS[number]

export const ITEM_CONSUMPTION_PHASES = [
  'never', 'declaration', 'accepted-use', 'hit', 'extended-action-completion', 'gm-adjudication',
] as const
export type ItemConsumptionPhase = typeof ITEM_CONSUMPTION_PHASES[number]

export interface ItemActionCostSpec {
  readonly kind: 'action' | 'ap' | 'resource' | 'item' | 'charge'
  readonly resourceId: string | null
  readonly amount: number
  readonly label: string
}

export interface ItemPrerequisiteSpec {
  readonly prerequisiteId: string
  readonly kind: 'actor-kind' | 'target-kind' | 'condition' | 'not-condition' | 'hp-state' | 'skill-rank' | 'feature' | 'capability' | 'species' | 'type' | 'equipped' | 'campaign-fact' | 'gm'
  readonly values: readonly string[]
  readonly unavailableReason: string
}

export interface ItemTargetSpec {
  readonly targetId: string
  readonly kind: ItemTargetKind
  readonly minimum: number
  readonly maximum: number
  readonly relationship: 'any' | 'self' | 'ally' | 'foe' | 'owned' | 'controlled'
  readonly rangeMeters: number | null
  readonly requiresLineOfSight: boolean
}

export interface ItemChoiceSpec {
  readonly choiceId: string
  readonly kind: ItemTargetKind | 'mode' | 'condition'
  readonly minimum: number
  readonly maximum: number
  readonly optionSource: 'spec' | 'authority'
  readonly options: readonly { readonly optionId: string, readonly label: string }[]
  readonly privateTo: 'public' | 'actor-owner' | 'responder-owner' | 'gm'
}

export const ITEM_HEALING_ROUNDING_KINDS = ['down', 'up', 'nearest'] as const
export type ItemHealingRoundingKind = typeof ITEM_HEALING_ROUNDING_KINDS[number]

export const ITEM_SKILL_CHECK_IDS = [
  'acrobatics', 'athletics', 'charm', 'combat', 'command', 'focus', 'guile',
  'intimidate', 'intuition', 'perception', 'stealth', 'survival', 'generalEd',
  'medicineEd', 'occultEd', 'pokeEd', 'techEd',
] as const
export type ItemSkillCheckId = typeof ITEM_SKILL_CHECK_IDS[number]

export type ItemHealingAmountSpec =
  | { readonly kind: 'fixed', readonly amount: number }
  | { readonly kind: 'rolled', readonly diceCount: number, readonly dieSides: number, readonly modifier: number }
  | {
      readonly kind: 'skill-check'
      /** Server-resolved Trainer skill; clients never provide dice or modifiers. */
      readonly skillId: ItemSkillCheckId
      readonly dieSides: 6
    }
  | {
      readonly kind: 'maximum-relative'
      /** Fractional healing always uses the full formula maximum, before Injuries lower the effective cap. */
      readonly basis: 'full-formula-maximum-hp'
      readonly numerator: number
      readonly denominator: number
      readonly rounding: ItemHealingRoundingKind
      readonly minimum: number
    }

export interface ItemHpRestorationSpec {
  readonly amount: ItemHealingAmountSpec
  readonly cap: 'injury-adjusted-effective-maximum-hp'
  /** Ordinary healing can restore HP while never clearing the separate Fainted state. */
  readonly faintedState: 'preserve'
}

export type ItemRevivalAmountSpec =
  | { readonly kind: 'fixed', readonly amount: number }
  | {
      readonly kind: 'maximum-relative'
      readonly basis: 'full-formula-maximum-hp'
      readonly numerator: number
      readonly denominator: number
      readonly rounding: ItemHealingRoundingKind
      readonly minimum: number
    }

export interface ItemRevivalSpec {
  readonly amount: ItemRevivalAmountSpec
  readonly cap: 'injury-adjusted-effective-maximum-hp'
  readonly targetKind: 'pokemon'
  readonly faintedState: 'require-and-clear'
}

export type ItemConditionRemovalMode = 'listed' | 'persistent' | 'volatile' | 'all-status'
export type ItemConditionRemovalSelection = 'all-applicable' | 'choose-one'

export type ItemCombatStageStat = 'atk' | 'def' | 'satk' | 'sdef' | 'spd' | 'acc'
export type ItemPermanentBaseStat = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
export type ItemTemporaryEffectFamily = 'critical-range' | 'move-stage-reduction-immunity'
export type ItemDigestionBuffKind = 'fixed-heal' | 'turn-start-heal'
export type ItemExplorationShardColor = 'Red' | 'Orange' | 'Yellow' | 'Green' | 'Blue' | 'Violet'

export interface ItemRouteLureMechanicsSpec {
  readonly checkIntervalMinutes: 15
  readonly successMinimum: 15
  readonly maximumAttempts: 3
  readonly dieSides: 20
}

export type ItemEffectSpec =
  | { readonly effectId: string, readonly operation: 'heal-hp', readonly restoration: ItemHpRestorationSpec }
  | { readonly effectId: string, readonly operation: 'revive', readonly revival: ItemRevivalSpec }
  | {
      readonly effectId: string
      readonly operation: 'remove-conditions'
      readonly conditionIds: readonly string[]
      readonly mode: ItemConditionRemovalMode
      readonly selection: ItemConditionRemovalSelection
    }
  | { readonly effectId: string, readonly operation: 'modify-stage', readonly stat: ItemCombatStageStat, readonly amount: number }
  | {
      readonly effectId: string
      readonly operation: 'temporary-combat-effect'
      readonly family: ItemTemporaryEffectFamily
      readonly amount: number
      readonly stackPolicy: 'replace' | 'refresh'
      readonly switchPolicy: 'expire'
    }
  | {
      readonly effectId: string
      readonly operation: 'store-digestion-buff'
      readonly buffKind: ItemDigestionBuffKind
      /** Fixed HP for fixed-heal; percentage numerator for turn-start-heal. */
      readonly amount: number
      /** Required only for turn-start-heal. */
      readonly denominator: number | null
      /** Canonical target prerequisite; null for ordinary Snacks. */
      readonly requiredPokemonType: string | null
    }
  | {
      readonly effectId: string
      readonly operation: 'apply-medical-treatment'
      readonly treatmentKind: 'bandages'
      readonly durationMinutes: 360
      readonly tickMinutes: 30
      readonly healingNumerator: 1
      readonly healingDenominator: 8
      readonly injuryAtCompletion: 1
      readonly stopOnHpLoss: true
      readonly obeyDailyInjuryLimit: true
    }
  | {
      readonly effectId: string
      readonly operation: 'modify-base-stat'
      readonly stat: ItemPermanentBaseStat | 'selected'
      readonly amount: -1 | 1
      readonly countsAsVitamin: boolean
      readonly requiresTrainerConsent: boolean
    }
  | {
      readonly effectId: string
      readonly operation: 'grant-tutor-points'
      readonly amount: 2
      readonly countsAsVitamin: true
      readonly lifetimeLimit: 1
    }
  | {
      readonly effectId: string
      readonly operation: 'increase-move-frequency'
      readonly countsAsVitamin: true
      readonly lifetimeLimit: 1
    }
  | {
      readonly effectId: string
      readonly operation: 'gain-next-level-experience'
      readonly lifetimeLimit: 5
      readonly maximumLevel: 100
    }
  | {
      readonly effectId: string
      readonly operation: 'learn-machine-move'
      readonly machineKind: 'TM' | 'HM'
      readonly machineNumber: string
      readonly moveId: string
      readonly tutorPointCost: 1
      readonly learningMinutes: 60
      readonly activeMoveMaximum: 6
      readonly machineTutorMoveMaximum: 3
      readonly dailyUseLimit: 1 | null
    }
  | {
      readonly effectId: string
      readonly operation: 'evolve-pokemon'
      readonly transitionPolicyId: string
      readonly statPolicy: 'unallocate-added-points-then-owner-restat'
      readonly abilityPolicy: 'map-current-canonical-abilities-by-tier-and-slot'
      readonly movePolicy: 'retain-current-moves-and-create-bounded-opportunity-attention'
      readonly equipmentPolicy: 'reconcile-current-equipment-against-destination-species'
    }
  | {
      readonly effectId: string
      readonly operation: 'use-bait'
      readonly lure: ItemRouteLureMechanicsSpec
      readonly focusDc: 12
    }
  | {
      readonly effectId: string
      readonly operation: 'start-route-lure'
      readonly lure: ItemRouteLureMechanicsSpec
      readonly lossPolicy: 'never-automatic-bounded-gm-adjudication'
    }
  | {
      readonly effectId: string
      readonly operation: 'use-snack-or-bait'
      readonly buffKind: 'fixed-heal'
      readonly amount: 5
      readonly denominator: null
      readonly requiredPokemonType: null
      readonly lure: ItemRouteLureMechanicsSpec
      readonly focusDc: 12
    }
  | {
      readonly effectId: string
      readonly operation: 'use-repel'
      readonly durationMinutes: 60 | 120 | 300
      readonly maximumAffectedWildLevel: 15 | 25 | 35
      readonly directBaseAc: 6
      readonly positioningAuthority: 'bounded-gm-prompt-after-server-owned-hit'
    }
  | {
      readonly effectId: string
      readonly operation: 'search-for-shards'
      readonly searchMinutes: 10
      readonly terrainBonusDice: 1
      readonly skillStuntDowsingBonusDice: 1
      readonly crystalResonanceBonusDice: 3
      readonly successMinimum: 4
      readonly rerollOn: 6
      readonly shardColors: readonly ItemExplorationShardColor[]
      readonly areaAuthority: 'bounded-gm-confirmation'
    }
  | { readonly effectId: string, readonly operation: 'guided', readonly outcomeKinds: readonly ItemOperationKind[] }

export interface ItemDurationSpec {
  readonly kind: 'instant' | 'turns' | 'rounds' | 'scene' | 'encounter' | 'daily' | 'campaign-minutes' | 'explicit-dismissal'
  /** Required positive count for turn, round, campaign-day, and campaign-minute durations; null for boundary-only durations. */
  readonly amount: number | null
}

export interface ItemEvidenceSpec {
  readonly canonicalCatalogSha256: string
  readonly canonicalRecordSha256: string
  readonly canonicalEffectSha256: string
  readonly reviewId: string
  readonly status: 'reviewed'
}

export interface ItemSpecV1 {
  readonly schemaVersion: typeof ITEM_SPEC_SCHEMA_VERSION
  readonly canonicalId: string
  readonly aliases: readonly string[]
  readonly implementationState: ItemImplementationState
  readonly contexts: readonly ItemContextKind[]
  readonly roles: readonly ItemInteractionRole[]
  readonly timing: ItemTimingKind
  readonly costs: readonly ItemActionCostSpec[]
  readonly prerequisites: readonly ItemPrerequisiteSpec[]
  readonly targets: readonly ItemTargetSpec[]
  readonly choices: readonly ItemChoiceSpec[]
  readonly consumption: {
    readonly phase: ItemConsumptionPhase
    readonly quantity: number
    readonly reserveWhilePending: boolean
    readonly refundableOnCancel: boolean
    readonly reusable: boolean
  }
  readonly effects: readonly ItemEffectSpec[]
  readonly duration: ItemDurationSpec
  readonly privacy: {
    readonly sourceInventory: EncounterProjectionAudience
    readonly choices: EncounterProjectionAudience
    readonly outcome: EncounterProjectionAudience
  }
  readonly presentation: {
    readonly label: string
    readonly description: string
    readonly unavailableReason: string | null
  }
  readonly evidence: ItemEvidenceSpec
  readonly registeredHandlerId: 'item.native.v1' | 'item.guided.v1' | 'item.passive.v1' | 'item.none.v1'
}

export interface ItemRuntimeDefinition {
  readonly canonicalId: string
  readonly definitionSha256: string
  readonly spec: ItemSpecV1
}

export interface ItemRuntimeRegistry {
  readonly definitions: readonly ItemRuntimeDefinition[]
  readonly aliases: ReadonlyMap<string, string>
  resolve(canonicalIdOrAlias: string): ItemRuntimeDefinition | null
  require(canonicalIdOrAlias: string): ItemRuntimeDefinition
}

export const ITEM_SPEC_LIMITS = Object.freeze({
  identifierLength: 200,
  textLength: 1_000,
  arrayEntries: 256,
  selections: 64,
  jsonDepth: 24,
  jsonNodes: 16_384,
  objectFields: 64,
  objectKeyLength: 200,
})

export type ItemSpecValidationCode =
  | 'invalid-spec'
  | 'unsupported-schema-version'
  | 'not-json'
  | 'limit-exceeded'
  | 'duplicate-id'

export class ItemSpecValidationError extends Error {
  readonly code: ItemSpecValidationCode
  readonly path: string

  constructor(code: ItemSpecValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemSpecValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = [
  'schemaVersion', 'canonicalId', 'aliases', 'implementationState', 'contexts', 'roles',
  'timing', 'costs', 'prerequisites', 'targets', 'choices', 'consumption', 'effects',
  'duration', 'privacy', 'presentation', 'evidence', 'registeredHandlerId',
] as const
const COST_FIELDS = ['kind', 'resourceId', 'amount', 'label'] as const
const PREREQUISITE_FIELDS = ['prerequisiteId', 'kind', 'values', 'unavailableReason'] as const
const TARGET_FIELDS = ['targetId', 'kind', 'minimum', 'maximum', 'relationship', 'rangeMeters', 'requiresLineOfSight'] as const
const CHOICE_FIELDS = ['choiceId', 'kind', 'minimum', 'maximum', 'optionSource', 'options', 'privateTo'] as const
const CHOICE_OPTION_FIELDS = ['optionId', 'label'] as const
const CONSUMPTION_FIELDS = ['phase', 'quantity', 'reserveWhilePending', 'refundableOnCancel', 'reusable'] as const
const DURATION_FIELDS = ['kind', 'amount'] as const
const PRIVACY_FIELDS = ['sourceInventory', 'choices', 'outcome'] as const
const PRESENTATION_FIELDS = ['label', 'description', 'unavailableReason'] as const
const EVIDENCE_FIELDS = ['canonicalCatalogSha256', 'canonicalRecordSha256', 'canonicalEffectSha256', 'reviewId', 'status'] as const
const EFFECT_COMMON_FIELDS = ['effectId', 'operation'] as const
const HEALING_RESTORATION_FIELDS = ['amount', 'cap', 'faintedState'] as const
const REVIVAL_FIELDS = ['amount', 'cap', 'targetKind', 'faintedState'] as const
const HEALING_AMOUNT_FIXED_FIELDS = ['kind', 'amount'] as const
const HEALING_AMOUNT_ROLLED_FIELDS = ['kind', 'diceCount', 'dieSides', 'modifier'] as const
const HEALING_AMOUNT_SKILL_CHECK_FIELDS = ['kind', 'skillId', 'dieSides'] as const
const HEALING_AMOUNT_RELATIVE_FIELDS = ['kind', 'basis', 'numerator', 'denominator', 'rounding', 'minimum'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const IMPLEMENTATION_STATE_SET = new Set<string>(ITEM_IMPLEMENTATION_STATES)
const CONTEXT_SET = new Set<string>(ITEM_CONTEXTS)
const ROLE_SET = new Set<string>(ITEM_INTERACTION_ROLES)
const TIMING_SET = new Set<string>(ITEM_TIMINGS)
const TARGET_SET = new Set<string>(ITEM_TARGET_KINDS)
const OPERATION_KIND_SET = new Set<string>(ITEM_OPERATION_KINDS)
const CONSUMPTION_PHASE_SET = new Set<string>(ITEM_CONSUMPTION_PHASES)
const AUDIENCE_SET = new Set<string>(['public', 'actor-owner', 'responder-owner', 'gm', 'diagnostic'])
const HANDLER_SET = new Set<string>(['item.native.v1', 'item.guided.v1', 'item.passive.v1', 'item.none.v1'])
const COST_KIND_SET = new Set<string>(['action', 'ap', 'resource', 'item', 'charge'])
const PREREQUISITE_KIND_SET = new Set<string>([
  'actor-kind', 'target-kind', 'condition', 'not-condition', 'hp-state', 'skill-rank',
  'feature', 'capability', 'species', 'type', 'equipped', 'campaign-fact', 'gm',
])
const RELATIONSHIP_SET = new Set<string>(['any', 'self', 'ally', 'foe', 'owned', 'controlled'])
const CHOICE_KIND_SET = new Set<string>([...ITEM_TARGET_KINDS, 'mode', 'condition'])
const OPTION_SOURCE_SET = new Set<string>(['spec', 'authority'])
const CHOICE_PRIVACY_SET = new Set<string>(['public', 'actor-owner', 'responder-owner', 'gm'])
const EFFECT_OPERATION_SET = new Set<string>([
  'heal-hp', 'revive', 'remove-conditions', 'modify-stage',
  'temporary-combat-effect', 'store-digestion-buff', 'apply-medical-treatment',
  'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency',
  'gain-next-level-experience', 'learn-machine-move', 'evolve-pokemon',
  'use-bait', 'start-route-lure', 'use-snack-or-bait', 'use-repel',
  'search-for-shards', 'guided',
])
const HEALING_AMOUNT_KIND_SET = new Set<string>(['fixed', 'rolled', 'skill-check', 'maximum-relative'])
const ITEM_SKILL_CHECK_ID_SET = new Set<string>(ITEM_SKILL_CHECK_IDS)
const HEALING_ROUNDING_SET = new Set<string>(ITEM_HEALING_ROUNDING_KINDS)
const CONDITION_MODE_SET = new Set<string>(['listed', 'persistent', 'volatile', 'all-status'])
const CONDITION_SELECTION_SET = new Set<string>(['all-applicable', 'choose-one'])
const STAGE_STAT_SET = new Set<string>(['atk', 'def', 'satk', 'sdef', 'spd', 'acc'])
const PERMANENT_STAT_SET = new Set<string>(['hp', 'atk', 'def', 'satk', 'sdef', 'spd', 'selected'])
const TEMPORARY_EFFECT_FAMILY_SET = new Set<string>(['critical-range', 'move-stage-reduction-immunity'])
const TEMPORARY_EFFECT_STACK_POLICY_SET = new Set<string>(['replace', 'refresh'])
const DIGESTION_BUFF_KIND_SET = new Set<string>(['fixed-heal', 'turn-start-heal'])
const DURATION_KIND_SET = new Set<string>(['instant', 'turns', 'rounds', 'scene', 'encounter', 'daily', 'campaign-minutes', 'explicit-dismissal'])
const EXPLORATION_SHARD_COLORS: readonly ItemExplorationShardColor[] = Object.freeze([
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Violet',
])

const fail = (code: ItemSpecValidationCode, path: string, detail: string): never => {
  throw new ItemSpecValidationError(code, path, detail)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-spec', path, 'must be a plain object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    fail('invalid-spec', path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
  }
}

const boundedText = (value: unknown, path: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)
    || (!allowEmpty && value.length === 0)) {
    return fail('invalid-spec', path, `must be a ${allowEmpty ? 'trimmed' : 'non-empty trimmed'} string without control characters.`)
  }
  if (value.length > ITEM_SPEC_LIMITS.textLength) fail('limit-exceeded', path, `must contain at most ${ITEM_SPEC_LIMITS.textLength} characters.`)
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = boundedText(value, path)
  if (id.length > ITEM_SPEC_LIMITS.identifierLength || !STABLE_ID_PATTERN.test(id)) {
    fail('invalid-spec', path, 'must be a bounded lowercase stable identifier.')
  }
  return id
}

const enumValue = <Value extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): Value => {
  if (typeof value !== 'string' || !allowed.has(value)) fail('invalid-spec', path, 'contains an unsupported value.')
  return value as Value
}

const boundedArray = (value: unknown, path: string, maximum = ITEM_SPEC_LIMITS.arrayEntries): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-spec', path, 'must be an array.')
  if (value.length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return value
}

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must contain unique values.')
}

const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('invalid-spec', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const positiveAmount = (value: unknown, path: string): number => integer(value, path, 1, Number.MAX_SAFE_INTEGER)
const selectionCount = (value: unknown, path: string): number => integer(value, path, 0, ITEM_SPEC_LIMITS.selections)
const booleanValue = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail('invalid-spec', path, 'must be boolean.')
const nullableText = (value: unknown, path: string): string | null => value === null ? null : boundedText(value, path)
const sha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail('invalid-spec', path, 'must be a lowercase SHA-256 digest.')
  return value as string
}

const parseUniqueTextArray = (value: unknown, path: string): readonly string[] => {
  const values = boundedArray(value, path).map((entry, index) => boundedText(entry, `${path}[${index}]`))
  unique(values, path)
  return values
}

const parseEnumArray = <Value extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): readonly Value[] => {
  const values = boundedArray(value, path).map((entry, index) => enumValue<Value>(entry, allowed, `${path}[${index}]`))
  unique(values, path)
  return values
}

const parseCosts = (value: unknown): readonly ItemActionCostSpec[] => boundedArray(value, 'itemSpec.costs')
  .map((entry, index): ItemActionCostSpec => {
    const path = `itemSpec.costs[${index}]`
    const input = record(entry, path)
    exact(input, COST_FIELDS, path)
    const kind = enumValue<ItemActionCostSpec['kind']>(input.kind, COST_KIND_SET, `${path}.kind`)
    const resourceId = nullableText(input.resourceId, `${path}.resourceId`)
    if (kind === 'ap' && resourceId !== 'drain') {
      fail('invalid-spec', `${path}.resourceId`, 'native item AP costs currently require the reviewed drain mode.')
    }
    return {
      kind,
      resourceId,
      amount: positiveAmount(input.amount, `${path}.amount`),
      label: boundedText(input.label, `${path}.label`),
    }
  })

const parsePrerequisites = (value: unknown): readonly ItemPrerequisiteSpec[] => {
  const rows = boundedArray(value, 'itemSpec.prerequisites').map((entry, index): ItemPrerequisiteSpec => {
    const path = `itemSpec.prerequisites[${index}]`
    const input = record(entry, path)
    exact(input, PREREQUISITE_FIELDS, path)
    return {
      prerequisiteId: stableId(input.prerequisiteId, `${path}.prerequisiteId`),
      kind: enumValue(input.kind, PREREQUISITE_KIND_SET, `${path}.kind`),
      values: parseUniqueTextArray(input.values, `${path}.values`),
      unavailableReason: boundedText(input.unavailableReason, `${path}.unavailableReason`),
    }
  })
  unique(rows.map(row => row.prerequisiteId), 'itemSpec.prerequisites.prerequisiteId')
  return rows
}

const parseTargets = (value: unknown): readonly ItemTargetSpec[] => {
  const rows = boundedArray(value, 'itemSpec.targets').map((entry, index): ItemTargetSpec => {
    const path = `itemSpec.targets[${index}]`
    const input = record(entry, path)
    exact(input, TARGET_FIELDS, path)
    const minimum = selectionCount(input.minimum, `${path}.minimum`)
    const maximum = selectionCount(input.maximum, `${path}.maximum`)
    if (minimum > maximum) fail('invalid-spec', path, 'minimum cannot exceed maximum.')
    const rangeMeters = input.rangeMeters === null ? null : integer(input.rangeMeters, `${path}.rangeMeters`, 0, Number.MAX_SAFE_INTEGER)
    return {
      targetId: stableId(input.targetId, `${path}.targetId`),
      kind: enumValue(input.kind, TARGET_SET, `${path}.kind`),
      minimum,
      maximum,
      relationship: enumValue(input.relationship, RELATIONSHIP_SET, `${path}.relationship`),
      rangeMeters,
      requiresLineOfSight: booleanValue(input.requiresLineOfSight, `${path}.requiresLineOfSight`),
    }
  })
  unique(rows.map(row => row.targetId), 'itemSpec.targets.targetId')
  return rows
}

const parseChoices = (value: unknown): readonly ItemChoiceSpec[] => {
  const rows = boundedArray(value, 'itemSpec.choices').map((entry, index): ItemChoiceSpec => {
    const path = `itemSpec.choices[${index}]`
    const input = record(entry, path)
    exact(input, CHOICE_FIELDS, path)
    const minimum = selectionCount(input.minimum, `${path}.minimum`)
    const maximum = selectionCount(input.maximum, `${path}.maximum`)
    if (minimum > maximum) fail('invalid-spec', path, 'minimum cannot exceed maximum.')
    const options = boundedArray(input.options, `${path}.options`).map((entry, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`
      const option = record(entry, optionPath)
      exact(option, CHOICE_OPTION_FIELDS, optionPath)
      return { optionId: stableId(option.optionId, `${optionPath}.optionId`), label: boundedText(option.label, `${optionPath}.label`) }
    })
    unique(options.map(option => option.optionId), `${path}.options.optionId`)
    const optionSource = enumValue<'spec' | 'authority'>(input.optionSource, OPTION_SOURCE_SET, `${path}.optionSource`)
    if (optionSource === 'spec' && maximum > 0 && options.length === 0) fail('invalid-spec', `${path}.options`, 'spec choices require bounded options.')
    if (optionSource === 'authority' && options.length > 0) fail('invalid-spec', `${path}.options`, 'authority choices cannot embed client-selectable options.')
    return {
      choiceId: stableId(input.choiceId, `${path}.choiceId`),
      kind: enumValue(input.kind, CHOICE_KIND_SET, `${path}.kind`),
      minimum,
      maximum,
      optionSource,
      options,
      privateTo: enumValue(input.privateTo, CHOICE_PRIVACY_SET, `${path}.privateTo`),
    }
  })
  unique(rows.map(row => row.choiceId), 'itemSpec.choices.choiceId')
  return rows
}

const parseHealingAmount = (value: unknown, path: string): ItemHealingAmountSpec => {
  const input = record(value, path)
  const kind = enumValue<ItemHealingAmountSpec['kind']>(input.kind, HEALING_AMOUNT_KIND_SET, `${path}.kind`)
  if (kind === 'fixed') {
    exact(input, HEALING_AMOUNT_FIXED_FIELDS, path)
    return { kind, amount: positiveAmount(input.amount, `${path}.amount`) }
  }
  if (kind === 'rolled') {
    exact(input, HEALING_AMOUNT_ROLLED_FIELDS, path)
    const diceCount = integer(input.diceCount, `${path}.diceCount`, 1, 32)
    const dieSides = integer(input.dieSides, `${path}.dieSides`, 2, 1_000)
    const modifier = integer(input.modifier, `${path}.modifier`, -10_000, 10_000)
    if (diceCount + modifier < 1 || diceCount * dieSides + modifier > Number.MAX_SAFE_INTEGER) {
      fail('invalid-spec', path, 'rolled healing must always resolve to a positive safe integer.')
    }
    return { kind, diceCount, dieSides, modifier }
  }
  if (kind === 'skill-check') {
    exact(input, HEALING_AMOUNT_SKILL_CHECK_FIELDS, path)
    if (input.dieSides !== 6) fail('invalid-spec', `${path}.dieSides`, 'item skill checks use reviewed d6 skill dice.')
    return {
      kind,
      skillId: enumValue(input.skillId, ITEM_SKILL_CHECK_ID_SET, `${path}.skillId`),
      dieSides: 6,
    }
  }
  exact(input, HEALING_AMOUNT_RELATIVE_FIELDS, path)
  if (input.basis !== 'full-formula-maximum-hp') {
    fail('invalid-spec', `${path}.basis`, 'maximum-relative healing must use the full formula maximum HP basis.')
  }
  return {
    kind,
    basis: 'full-formula-maximum-hp',
    numerator: positiveAmount(input.numerator, `${path}.numerator`),
    denominator: positiveAmount(input.denominator, `${path}.denominator`),
    rounding: enumValue(input.rounding, HEALING_ROUNDING_SET, `${path}.rounding`),
    minimum: positiveAmount(input.minimum, `${path}.minimum`),
  }
}

const parseHpRestoration = (value: unknown, path: string): ItemHpRestorationSpec => {
  const input = record(value, path)
  exact(input, HEALING_RESTORATION_FIELDS, path)
  if (input.cap !== 'injury-adjusted-effective-maximum-hp') {
    fail('invalid-spec', `${path}.cap`, 'HP restoration must use the injury-adjusted effective maximum HP cap.')
  }
  if (input.faintedState !== 'preserve') {
    fail('invalid-spec', `${path}.faintedState`, 'ordinary HP restoration must preserve the separate Fainted state.')
  }
  return {
    amount: parseHealingAmount(input.amount, `${path}.amount`),
    cap: 'injury-adjusted-effective-maximum-hp',
    faintedState: 'preserve',
  }
}

const parseRevival = (value: unknown, path: string): ItemRevivalSpec => {
  const input = record(value, path)
  exact(input, REVIVAL_FIELDS, path)
  const amountInput = record(input.amount, `${path}.amount`)
  const kind = enumValue<ItemRevivalAmountSpec['kind']>(
    amountInput.kind,
    new Set(['fixed', 'maximum-relative']),
    `${path}.amount.kind`,
  )
  const amount: ItemRevivalAmountSpec = kind === 'fixed'
    ? (() => {
        exact(amountInput, HEALING_AMOUNT_FIXED_FIELDS, `${path}.amount`)
        return { kind, amount: positiveAmount(amountInput.amount, `${path}.amount.amount`) }
      })()
    : (() => {
        exact(amountInput, HEALING_AMOUNT_RELATIVE_FIELDS, `${path}.amount`)
        if (amountInput.basis !== 'full-formula-maximum-hp') {
          fail('invalid-spec', `${path}.amount.basis`, 'maximum-relative revival must use the full formula maximum HP basis.')
        }
        return {
          kind,
          basis: 'full-formula-maximum-hp' as const,
          numerator: positiveAmount(amountInput.numerator, `${path}.amount.numerator`),
          denominator: positiveAmount(amountInput.denominator, `${path}.amount.denominator`),
          rounding: enumValue<ItemHealingRoundingKind>(amountInput.rounding, HEALING_ROUNDING_SET, `${path}.amount.rounding`),
          minimum: positiveAmount(amountInput.minimum, `${path}.amount.minimum`),
        }
      })()
  if (input.cap !== 'injury-adjusted-effective-maximum-hp') {
    fail('invalid-spec', `${path}.cap`, 'revival must use the injury-adjusted effective maximum HP cap.')
  }
  if (input.targetKind !== 'pokemon') fail('invalid-spec', `${path}.targetKind`, 'revival items target Pokémon only.')
  if (input.faintedState !== 'require-and-clear') {
    fail('invalid-spec', `${path}.faintedState`, 'revival must require and clear authoritative Fainted state.')
  }
  return {
    amount,
    cap: 'injury-adjusted-effective-maximum-hp',
    targetKind: 'pokemon',
    faintedState: 'require-and-clear',
  }
}

const parseRouteLureMechanics = (value: unknown, path: string): ItemRouteLureMechanicsSpec => {
  const input = record(value, path)
  exact(input, ['checkIntervalMinutes', 'successMinimum', 'maximumAttempts', 'dieSides'], path)
  if (input.checkIntervalMinutes !== 15 || input.successMinimum !== 15
    || input.maximumAttempts !== 3 || input.dieSides !== 20) {
    fail('invalid-spec', path, 'route lure mechanics must retain the reviewed 15-minute, d20, 15+, three-attempt policy.')
  }
  return { checkIntervalMinutes: 15, successMinimum: 15, maximumAttempts: 3, dieSides: 20 }
}

const parseEffects = (value: unknown): readonly ItemEffectSpec[] => {
  const rows = boundedArray(value, 'itemSpec.effects').map((entry, index): ItemEffectSpec => {
    const path = `itemSpec.effects[${index}]`
    const input = record(entry, path)
    const operation = enumValue<ItemEffectSpec['operation']>(input.operation, EFFECT_OPERATION_SET, `${path}.operation`)
    const fields = operation === 'heal-hp'
      ? [...EFFECT_COMMON_FIELDS, 'restoration']
      : operation === 'revive'
        ? [...EFFECT_COMMON_FIELDS, 'revival']
        : operation === 'remove-conditions'
          ? [...EFFECT_COMMON_FIELDS, 'conditionIds', 'mode', 'selection']
          : operation === 'modify-stage'
            ? [...EFFECT_COMMON_FIELDS, 'stat', 'amount']
            : operation === 'temporary-combat-effect'
              ? [...EFFECT_COMMON_FIELDS, 'family', 'amount', 'stackPolicy', 'switchPolicy']
              : operation === 'store-digestion-buff'
                ? [...EFFECT_COMMON_FIELDS, 'buffKind', 'amount', 'denominator', 'requiredPokemonType']
                : operation === 'apply-medical-treatment'
                  ? [
                      ...EFFECT_COMMON_FIELDS, 'treatmentKind', 'durationMinutes', 'tickMinutes',
                      'healingNumerator', 'healingDenominator', 'injuryAtCompletion',
                      'stopOnHpLoss', 'obeyDailyInjuryLimit',
                    ]
                  : operation === 'modify-base-stat'
                    ? [...EFFECT_COMMON_FIELDS, 'stat', 'amount', 'countsAsVitamin', 'requiresTrainerConsent']
                    : operation === 'grant-tutor-points'
                      ? [...EFFECT_COMMON_FIELDS, 'amount', 'countsAsVitamin', 'lifetimeLimit']
                      : operation === 'increase-move-frequency'
                        ? [...EFFECT_COMMON_FIELDS, 'countsAsVitamin', 'lifetimeLimit']
                        : operation === 'gain-next-level-experience'
                          ? [...EFFECT_COMMON_FIELDS, 'lifetimeLimit', 'maximumLevel']
                          : operation === 'learn-machine-move'
                            ? [
                                ...EFFECT_COMMON_FIELDS, 'machineKind', 'machineNumber', 'moveId',
                                'tutorPointCost', 'learningMinutes', 'activeMoveMaximum',
                                'machineTutorMoveMaximum', 'dailyUseLimit',
                              ]
                            : operation === 'evolve-pokemon'
                              ? [
                                  ...EFFECT_COMMON_FIELDS, 'transitionPolicyId', 'statPolicy',
                                  'abilityPolicy', 'movePolicy', 'equipmentPolicy',
                                ]
                              : operation === 'use-bait'
                                ? [...EFFECT_COMMON_FIELDS, 'lure', 'focusDc']
                                : operation === 'start-route-lure'
                                  ? [...EFFECT_COMMON_FIELDS, 'lure', 'lossPolicy']
                                  : operation === 'use-snack-or-bait'
                                    ? [
                                        ...EFFECT_COMMON_FIELDS, 'buffKind', 'amount', 'denominator',
                                        'requiredPokemonType', 'lure', 'focusDc',
                                      ]
                                    : operation === 'use-repel'
                                      ? [
                                          ...EFFECT_COMMON_FIELDS, 'durationMinutes',
                                          'maximumAffectedWildLevel', 'directBaseAc',
                                          'positioningAuthority',
                                        ]
                                      : operation === 'search-for-shards'
                                        ? [
                                            ...EFFECT_COMMON_FIELDS, 'searchMinutes',
                                            'terrainBonusDice', 'skillStuntDowsingBonusDice',
                                            'crystalResonanceBonusDice', 'successMinimum',
                                            'rerollOn', 'shardColors', 'areaAuthority',
                                          ]
                                        : [...EFFECT_COMMON_FIELDS, 'outcomeKinds']
    exact(input, fields, path)
    const effectId = stableId(input.effectId, `${path}.effectId`)
    if (operation === 'heal-hp') return { effectId, operation, restoration: parseHpRestoration(input.restoration, `${path}.restoration`) }
    if (operation === 'revive') return { effectId, operation, revival: parseRevival(input.revival, `${path}.revival`) }
    if (operation === 'remove-conditions') {
      const conditionIds = parseUniqueTextArray(input.conditionIds, `${path}.conditionIds`)
      const mode = enumValue<ItemConditionRemovalMode>(input.mode, CONDITION_MODE_SET, `${path}.mode`)
      const selection = enumValue<ItemConditionRemovalSelection>(input.selection, CONDITION_SELECTION_SET, `${path}.selection`)
      if (mode === 'listed' && conditionIds.length === 0) {
        fail('invalid-spec', `${path}.conditionIds`, 'listed condition removal requires canonical condition identities.')
      }
      if (mode !== 'listed' && conditionIds.length > 0) {
        fail('invalid-spec', `${path}.conditionIds`, 'category condition removal cannot also list condition identities.')
      }
      return { effectId, operation, conditionIds, mode, selection }
    }
    if (operation === 'modify-stage') {
      const amount = integer(input.amount, `${path}.amount`, -6, 6)
      if (amount === 0) fail('invalid-spec', `${path}.amount`, 'combat-stage modifications must be non-zero.')
      return {
        effectId,
        operation,
        stat: enumValue(input.stat, STAGE_STAT_SET, `${path}.stat`),
        amount,
      }
    }
    if (operation === 'temporary-combat-effect') {
      const family = enumValue<ItemTemporaryEffectFamily>(input.family, TEMPORARY_EFFECT_FAMILY_SET, `${path}.family`)
      const amount = positiveAmount(input.amount, `${path}.amount`)
      const stackPolicy = enumValue<'replace' | 'refresh'>(input.stackPolicy, TEMPORARY_EFFECT_STACK_POLICY_SET, `${path}.stackPolicy`)
      if (family === 'critical-range' && (amount !== 2 || stackPolicy !== 'replace')) {
        fail('invalid-spec', path, 'critical-range items require the reviewed +2 replace policy.')
      }
      if (family === 'move-stage-reduction-immunity' && (amount !== 5 || stackPolicy !== 'refresh')) {
        fail('invalid-spec', path, 'move stage-reduction immunity requires the reviewed five-turn refresh policy.')
      }
      return {
        effectId,
        operation,
        family,
        amount,
        stackPolicy,
        switchPolicy: input.switchPolicy === 'expire'
          ? 'expire'
          : fail('invalid-spec', `${path}.switchPolicy`, 'temporary combat effects must expire on switch or recall.'),
      }
    }
    if (operation === 'store-digestion-buff') {
      const buffKind = enumValue<ItemDigestionBuffKind>(input.buffKind, DIGESTION_BUFF_KIND_SET, `${path}.buffKind`)
      const amount = positiveAmount(input.amount, `${path}.amount`)
      const denominator = input.denominator === null
        ? null
        : positiveAmount(input.denominator, `${path}.denominator`)
      const requiredPokemonType = input.requiredPokemonType === null
        ? null
        : boundedText(input.requiredPokemonType, `${path}.requiredPokemonType`)
      if ((buffKind === 'fixed-heal' && denominator !== null)
        || (buffKind === 'turn-start-heal' && denominator === null)) {
        fail('invalid-spec', path, 'digestion-buff amount and denominator do not match the reviewed buff kind.')
      }
      if (buffKind === 'turn-start-heal' && denominator !== null && amount >= denominator) {
        fail('invalid-spec', path, 'turn-start Digestion Buff healing must be a proper positive fraction.')
      }
      if (requiredPokemonType !== null && buffKind !== 'turn-start-heal') {
        fail('invalid-spec', path, 'a Pokémon type prerequisite requires reviewed turn-start Digestion Buff mechanics.')
      }
      return { effectId, operation, buffKind, amount, denominator, requiredPokemonType }
    }
    if (operation === 'apply-medical-treatment') {
      if (input.treatmentKind !== 'bandages' || input.durationMinutes !== 360
        || input.tickMinutes !== 30 || input.healingNumerator !== 1
        || input.healingDenominator !== 8 || input.injuryAtCompletion !== 1
        || input.stopOnHpLoss !== true || input.obeyDailyInjuryLimit !== true) {
        fail('invalid-spec', path, 'medical treatment must retain reviewed Bandages timing, healing, Injury, and interruption semantics.')
      }
      return {
        effectId, operation, treatmentKind: 'bandages', durationMinutes: 360,
        tickMinutes: 30, healingNumerator: 1, healingDenominator: 8,
        injuryAtCompletion: 1, stopOnHpLoss: true, obeyDailyInjuryLimit: true,
      }
    }
    if (operation === 'modify-base-stat') {
      const stat = enumValue<ItemPermanentBaseStat | 'selected'>(input.stat, PERMANENT_STAT_SET, `${path}.stat`)
      const amount = integer(input.amount, `${path}.amount`, -1, 1)
      const countsAsVitamin = booleanValue(input.countsAsVitamin, `${path}.countsAsVitamin`)
      const requiresTrainerConsent = booleanValue(input.requiresTrainerConsent, `${path}.requiresTrainerConsent`)
      if (amount === 0
        || (amount === 1 && (stat === 'selected' || !countsAsVitamin || requiresTrainerConsent))
        || (amount === -1 && (stat !== 'selected' || countsAsVitamin || !requiresTrainerConsent))) {
        fail('invalid-spec', path, 'Base Stat advancement must be a fixed +1 Vitamin or a selected consenting -1 Suppressant.')
      }
      return { effectId, operation, stat, amount: amount as -1 | 1, countsAsVitamin, requiresTrainerConsent }
    }
    if (operation === 'grant-tutor-points') {
      if (input.amount !== 2 || input.countsAsVitamin !== true || input.lifetimeLimit !== 1) {
        fail('invalid-spec', path, 'Heart Booster must grant 2 Tutor Points once and count as one Vitamin.')
      }
      return { effectId, operation, amount: 2, countsAsVitamin: true, lifetimeLimit: 1 }
    }
    if (operation === 'increase-move-frequency') {
      if (input.countsAsVitamin !== true || input.lifetimeLimit !== 1) {
        fail('invalid-spec', path, 'PP Up must apply once and count as one Vitamin.')
      }
      return { effectId, operation, countsAsVitamin: true, lifetimeLimit: 1 }
    }
    if (operation === 'gain-next-level-experience') {
      if (input.lifetimeLimit !== 5 || input.maximumLevel !== 100) {
        fail('invalid-spec', path, 'Rare Candy must retain its five-use and Level 100 limits.')
      }
      return { effectId, operation, lifetimeLimit: 5, maximumLevel: 100 }
    }
    if (operation === 'learn-machine-move') {
      const machineKind = input.machineKind === 'TM' || input.machineKind === 'HM'
        ? input.machineKind
        : fail('invalid-spec', `${path}.machineKind`, 'machine Move learning requires TM or HM identity.')
      const machineNumber = boundedText(input.machineNumber, `${path}.machineNumber`)
      if (!/^[0-9]{2,3}$/u.test(machineNumber)
        || input.tutorPointCost !== 1 || input.learningMinutes !== 60
        || input.activeMoveMaximum !== 6 || input.machineTutorMoveMaximum !== 3
        || (machineKind === 'TM' ? input.dailyUseLimit !== null : input.dailyUseLimit !== 1)) {
        fail('invalid-spec', path, 'machine Move learning must retain reviewed number, Tutor Point, timing, Move-limit, and daily-use mechanics.')
      }
      return {
        effectId,
        operation,
        machineKind,
        machineNumber,
        moveId: boundedText(input.moveId, `${path}.moveId`),
        tutorPointCost: 1,
        learningMinutes: 60,
        activeMoveMaximum: 6,
        machineTutorMoveMaximum: 3,
        dailyUseLimit: machineKind === 'HM' ? 1 : null,
      }
    }
    if (operation === 'evolve-pokemon') {
      if (input.statPolicy !== 'unallocate-added-points-then-owner-restat'
        || input.abilityPolicy !== 'map-current-canonical-abilities-by-tier-and-slot'
        || input.movePolicy !== 'retain-current-moves-and-create-bounded-opportunity-attention'
        || input.equipmentPolicy !== 'reconcile-current-equipment-against-destination-species') {
        fail('invalid-spec', path, 'item evolution must retain reviewed restat, Ability, Move-attention, and equipment-reconciliation policies.')
      }
      return {
        effectId,
        operation,
        transitionPolicyId: boundedText(input.transitionPolicyId, `${path}.transitionPolicyId`),
        statPolicy: 'unallocate-added-points-then-owner-restat',
        abilityPolicy: 'map-current-canonical-abilities-by-tier-and-slot',
        movePolicy: 'retain-current-moves-and-create-bounded-opportunity-attention',
        equipmentPolicy: 'reconcile-current-equipment-against-destination-species',
      }
    }
    if (operation === 'use-bait') {
      if (input.focusDc !== 12) fail('invalid-spec', `${path}.focusDc`, 'Bait distraction requires the reviewed Focus DC 12.')
      return { effectId, operation, lure: parseRouteLureMechanics(input.lure, `${path}.lure`), focusDc: 12 }
    }
    if (operation === 'start-route-lure') {
      if (input.lossPolicy !== 'never-automatic-bounded-gm-adjudication') {
        fail('invalid-spec', `${path}.lossPolicy`, 'Fishing Lure loss must remain bounded GM adjudication.')
      }
      return {
        effectId, operation, lure: parseRouteLureMechanics(input.lure, `${path}.lure`),
        lossPolicy: 'never-automatic-bounded-gm-adjudication',
      }
    }
    if (operation === 'use-snack-or-bait') {
      if (input.buffKind !== 'fixed-heal' || input.amount !== 5 || input.denominator !== null
        || input.requiredPokemonType !== null || input.focusDc !== 12) {
        fail('invalid-spec', path, 'Honey must retain its reviewed 5 HP Snack and Focus DC 12 Bait modes.')
      }
      return {
        effectId, operation, buffKind: 'fixed-heal', amount: 5, denominator: null,
        requiredPokemonType: null, lure: parseRouteLureMechanics(input.lure, `${path}.lure`),
        focusDc: 12,
      }
    }
    if (operation === 'use-repel') {
      const variants = new Map<number, number>([[60, 15], [120, 25], [300, 35]])
      if (!Number.isSafeInteger(input.durationMinutes)
        || variants.get(Number(input.durationMinutes)) !== input.maximumAffectedWildLevel
        || input.directBaseAc !== 6
        || input.positioningAuthority !== 'bounded-gm-prompt-after-server-owned-hit') {
        fail('invalid-spec', path, 'Repel mechanics must retain one reviewed duration, level threshold, AC 6, and bounded positioning policy.')
      }
      return {
        effectId, operation,
        durationMinutes: Number(input.durationMinutes) as 60 | 120 | 300,
        maximumAffectedWildLevel: Number(input.maximumAffectedWildLevel) as 15 | 25 | 35,
        directBaseAc: 6,
        positioningAuthority: 'bounded-gm-prompt-after-server-owned-hit',
      }
    }
    if (operation === 'search-for-shards') {
      const shardColors = parseUniqueTextArray(input.shardColors, `${path}.shardColors`)
      if (input.searchMinutes !== 10 || input.terrainBonusDice !== 1
        || input.skillStuntDowsingBonusDice !== 1 || input.crystalResonanceBonusDice !== 3
        || input.successMinimum !== 4 || input.rerollOn !== 6
        || input.areaAuthority !== 'bounded-gm-confirmation'
        || shardColors.join(',') !== EXPLORATION_SHARD_COLORS.join(',')) {
        fail('invalid-spec', path, 'Dowsing must retain reviewed timing, bonus dice, success, reroll, color, and GM-area authority.')
      }
      return {
        effectId, operation, searchMinutes: 10, terrainBonusDice: 1,
        skillStuntDowsingBonusDice: 1, crystalResonanceBonusDice: 3,
        successMinimum: 4, rerollOn: 6,
        shardColors: EXPLORATION_SHARD_COLORS,
        areaAuthority: 'bounded-gm-confirmation',
      }
    }
    return {
      effectId,
      operation,
      outcomeKinds: parseEnumArray(input.outcomeKinds, OPERATION_KIND_SET, `${path}.outcomeKinds`),
    }
  })
  unique(rows.map(row => row.effectId), 'itemSpec.effects.effectId')
  return rows
}

const parseConsumption = (value: unknown): ItemSpecV1['consumption'] => {
  const path = 'itemSpec.consumption'
  const input = record(value, path)
  exact(input, CONSUMPTION_FIELDS, path)
  const reusable = booleanValue(input.reusable, `${path}.reusable`)
  const quantity = integer(input.quantity, `${path}.quantity`, 0, Number.MAX_SAFE_INTEGER)
  const phase = enumValue<ItemConsumptionPhase>(input.phase, CONSUMPTION_PHASE_SET, `${path}.phase`)
  if ((reusable && (phase !== 'never' || quantity !== 0))
    || (!reusable && (phase === 'never' || quantity < 1))) {
    fail('invalid-spec', path, 'reusable items require never/0 consumption and consumable items require a positive quantity and commit phase.')
  }
  return {
    phase,
    quantity,
    reserveWhilePending: booleanValue(input.reserveWhilePending, `${path}.reserveWhilePending`),
    refundableOnCancel: booleanValue(input.refundableOnCancel, `${path}.refundableOnCancel`),
    reusable,
  }
}

const parseDuration = (value: unknown): ItemDurationSpec => {
  const path = 'itemSpec.duration'
  const input = record(value, path)
  exact(input, DURATION_FIELDS, path)
  const kind = enumValue<ItemDurationSpec['kind']>(input.kind, DURATION_KIND_SET, `${path}.kind`)
  const amount = input.amount === null ? null : positiveAmount(input.amount, `${path}.amount`)
  if ((kind === 'turns' || kind === 'rounds' || kind === 'daily' || kind === 'campaign-minutes') !== (amount !== null)) {
    fail('invalid-spec', path, 'turn, round, daily, and campaign-minute durations require an amount; other durations require null.')
  }
  return { kind, amount }
}

const parsePrivacy = (value: unknown): ItemSpecV1['privacy'] => {
  const path = 'itemSpec.privacy'
  const input = record(value, path)
  exact(input, PRIVACY_FIELDS, path)
  return {
    sourceInventory: enumValue(input.sourceInventory, AUDIENCE_SET, `${path}.sourceInventory`),
    choices: enumValue(input.choices, AUDIENCE_SET, `${path}.choices`),
    outcome: enumValue(input.outcome, AUDIENCE_SET, `${path}.outcome`),
  }
}

const parsePresentation = (value: unknown): ItemSpecV1['presentation'] => {
  const path = 'itemSpec.presentation'
  const input = record(value, path)
  exact(input, PRESENTATION_FIELDS, path)
  return {
    label: boundedText(input.label, `${path}.label`),
    description: boundedText(input.description, `${path}.description`, true),
    unavailableReason: nullableText(input.unavailableReason, `${path}.unavailableReason`),
  }
}

const parseEvidence = (value: unknown): ItemEvidenceSpec => {
  const path = 'itemSpec.evidence'
  const input = record(value, path)
  exact(input, EVIDENCE_FIELDS, path)
  if (input.status !== 'reviewed') fail('invalid-spec', `${path}.status`, 'must be reviewed.')
  return {
    canonicalCatalogSha256: sha256(input.canonicalCatalogSha256, `${path}.canonicalCatalogSha256`),
    canonicalRecordSha256: sha256(input.canonicalRecordSha256, `${path}.canonicalRecordSha256`),
    canonicalEffectSha256: sha256(input.canonicalEffectSha256, `${path}.canonicalEffectSha256`),
    reviewId: boundedText(input.reviewId, `${path}.reviewId`),
    status: 'reviewed',
  }
}

/** Strictly parse, detach, and freeze one versioned item runtime definition. */
export const parseItemSpec = (value: unknown): ItemSpecV1 => {
  const detached = cloneStrictJson(value, 'itemSpec', {
    limits: {
      depth: ITEM_SPEC_LIMITS.jsonDepth,
      nodes: ITEM_SPEC_LIMITS.jsonNodes,
      objectFields: ITEM_SPEC_LIMITS.objectFields,
      arrayEntries: ITEM_SPEC_LIMITS.arrayEntries,
      stringLength: ITEM_SPEC_LIMITS.textLength,
      objectKeyLength: ITEM_SPEC_LIMITS.objectKeyLength,
    },
    rootLabel: 'item spec data',
    valueLabel: 'ItemSpecs',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  const root = record(detached, 'itemSpec')
  exact(root, ROOT_FIELDS, 'itemSpec')
  if (root.schemaVersion !== ITEM_SPEC_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'itemSpec.schemaVersion', `must be ${ITEM_SPEC_SCHEMA_VERSION}.`)
  }
  const contexts = parseEnumArray<ItemContextKind>(root.contexts, CONTEXT_SET, 'itemSpec.contexts')
  const roles = parseEnumArray<ItemInteractionRole>(root.roles, ROLE_SET, 'itemSpec.roles')
  if (contexts.length === 0) fail('invalid-spec', 'itemSpec.contexts', 'must contain at least one context.')
  if (roles.length === 0) fail('invalid-spec', 'itemSpec.roles', 'must contain at least one role.')
  const spec: ItemSpecV1 = {
    schemaVersion: ITEM_SPEC_SCHEMA_VERSION,
    canonicalId: boundedText(root.canonicalId, 'itemSpec.canonicalId'),
    aliases: parseUniqueTextArray(root.aliases, 'itemSpec.aliases'),
    implementationState: enumValue(root.implementationState, IMPLEMENTATION_STATE_SET, 'itemSpec.implementationState'),
    contexts,
    roles,
    timing: enumValue(root.timing, TIMING_SET, 'itemSpec.timing'),
    costs: parseCosts(root.costs),
    prerequisites: parsePrerequisites(root.prerequisites),
    targets: parseTargets(root.targets),
    choices: parseChoices(root.choices),
    consumption: parseConsumption(root.consumption),
    effects: parseEffects(root.effects),
    duration: parseDuration(root.duration),
    privacy: parsePrivacy(root.privacy),
    presentation: parsePresentation(root.presentation),
    evidence: parseEvidence(root.evidence),
    registeredHandlerId: enumValue(root.registeredHandlerId, HANDLER_SET, 'itemSpec.registeredHandlerId'),
  }
  if (spec.implementationState === 'native' && spec.registeredHandlerId !== 'item.native.v1') fail('invalid-spec', 'itemSpec.registeredHandlerId', 'native specs require item.native.v1.')
  if (spec.implementationState === 'guided' && spec.registeredHandlerId !== 'item.guided.v1') fail('invalid-spec', 'itemSpec.registeredHandlerId', 'guided specs require item.guided.v1.')
  if (spec.implementationState === 'passive' && spec.registeredHandlerId !== 'item.passive.v1') fail('invalid-spec', 'itemSpec.registeredHandlerId', 'passive specs require item.passive.v1.')
  if ((spec.implementationState === 'reference-only' || spec.implementationState === 'not-applicable' || spec.implementationState === 'blocked')
    && spec.registeredHandlerId !== 'item.none.v1') fail('invalid-spec', 'itemSpec.registeredHandlerId', 'non-actionable specs require item.none.v1.')
  const actionable = spec.implementationState === 'native' || spec.implementationState === 'guided'
  if (actionable && !spec.roles.some(role => role === 'usable' || role === 'guided')) {
    fail('invalid-spec', 'itemSpec.roles', 'native and guided specs require a usable or guided role.')
  }
  if (actionable && spec.effects.length === 0) fail('invalid-spec', 'itemSpec.effects', 'native and guided specs require at least one effect.')
  if (spec.implementationState === 'guided' && !spec.effects.some(effect => effect.operation === 'guided')) {
    fail('invalid-spec', 'itemSpec.effects', 'guided specs require a guided effect.')
  }
  if (spec.implementationState === 'passive' && (!spec.roles.includes('passive') || !spec.contexts.includes('passive') || spec.timing !== 'passive')) {
    fail('invalid-spec', 'itemSpec', 'passive specs require the passive role, context, and timing.')
  }
  if (spec.implementationState === 'reference-only' && !spec.roles.includes('reference-only')) fail('invalid-spec', 'itemSpec.roles', 'reference-only specs require the reference-only role.')
  if (spec.implementationState === 'not-applicable' && !spec.roles.includes('not-applicable')) fail('invalid-spec', 'itemSpec.roles', 'not-applicable specs require the not-applicable role.')
  if (!actionable && spec.effects.length > 0) fail('invalid-spec', 'itemSpec.effects', 'non-actionable specs cannot declare executable effects.')
  if ((spec.implementationState === 'reference-only' || spec.implementationState === 'not-applicable' || spec.implementationState === 'blocked')
    && spec.presentation.unavailableReason === null) fail('invalid-spec', 'itemSpec.presentation.unavailableReason', 'non-actionable specs require an explicit unavailable reason.')
  if ((spec.timing === 'passive') !== spec.contexts.includes('passive')) fail('invalid-spec', 'itemSpec.timing', 'passive timing and context must be declared together.')
  if (spec.duration.kind === 'instant' && spec.timing === 'passive') fail('invalid-spec', 'itemSpec.duration', 'passive effects cannot have instant duration.')
  const skillCheckHealing = spec.effects.filter(effect => effect.operation === 'heal-hp'
    && effect.restoration.amount.kind === 'skill-check')
  if (skillCheckHealing.length > 0) {
    if (spec.timing !== 'extended' || !spec.contexts.includes('extended-action')) {
      fail('invalid-spec', 'itemSpec.timing', 'item-driven skill-check healing requires reviewed Extended Action timing.')
    }
    if (!spec.prerequisites.some(prerequisite => prerequisite.kind === 'actor-kind'
      && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === 'trainer'))) {
      fail('invalid-spec', 'itemSpec.prerequisites', 'item-driven skill checks require an explicit Trainer actor gate.')
    }
    const apCosts = spec.costs.filter(cost => cost.kind === 'ap')
    if (apCosts.length !== 1 || apCosts[0]?.resourceId !== 'drain' || apCosts[0].amount < 1) {
      fail('invalid-spec', 'itemSpec.costs', 'item-driven skill-check healing requires exactly one reviewed AP drain.')
    }
    if (!spec.targets.some(target => target.kind === 'participant' && target.minimum > 0)) {
      fail('invalid-spec', 'itemSpec.targets', 'item-driven skill-check healing requires a participant target.')
    }
  }
  const temporaryEffects = spec.effects.filter(effect => effect.operation === 'temporary-combat-effect')
  if (temporaryEffects.length > 0) {
    if (!spec.contexts.includes('encounter')) {
      fail('invalid-spec', 'itemSpec.contexts', 'temporary combat effects require the encounter context.')
    }
    if (spec.duration.kind === 'instant') {
      fail('invalid-spec', 'itemSpec.duration', 'temporary combat effects require a durable lifecycle or campaign-clock duration.')
    }
    for (const effect of temporaryEffects) {
      if (effect.family === 'critical-range' && spec.duration.kind !== 'encounter') {
        fail('invalid-spec', 'itemSpec.duration', 'critical-range item effects last for the encounter.')
      }
      if (effect.family === 'move-stage-reduction-immunity'
        && (spec.duration.kind !== 'turns' || spec.duration.amount !== 5)) {
        fail('invalid-spec', 'itemSpec.duration', 'move stage-reduction immunity must use its reviewed five-turn duration.')
      }
    }
  }
  const digestionEffects = spec.effects.filter(effect => effect.operation === 'store-digestion-buff')
  for (const effect of digestionEffects) {
    if (spec.duration.kind !== 'instant' || !spec.contexts.includes('encounter')) {
      fail('invalid-spec', 'itemSpec.duration', 'storing a Digestion Buff is instant; the stored canonical item owns its later trade duration.')
    }
    if (!spec.targets.some(target => target.kind === 'participant' && target.minimum > 0)) {
      fail('invalid-spec', 'itemSpec.targets', `digestion effect ${effect.effectId} requires a participant target.`)
    }
    if (effect.requiredPokemonType !== null && !spec.prerequisites.some(prerequisite => (
      prerequisite.kind === 'type'
      && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === effect.requiredPokemonType!.toLocaleLowerCase('en-US'))
    ))) {
      fail('invalid-spec', 'itemSpec.prerequisites', `digestion effect ${effect.effectId} requires its explicit Pokémon type gate.`)
    }
  }
  const explorationEffects = spec.effects.filter(effect => [
    'use-bait', 'start-route-lure', 'use-snack-or-bait', 'use-repel', 'search-for-shards',
  ].includes(effect.operation))
  if (explorationEffects.length > 0) {
    const effect = explorationEffects[0]!
    const target = spec.targets[0]
    if (explorationEffects.length !== 1 || spec.effects.length !== 1
      || !target || spec.targets.length !== 1 || target.kind !== 'participant'
      || target.minimum !== 1 || target.maximum !== 1
      || !spec.prerequisites.some(prerequisite => prerequisite.kind === 'actor-kind'
        && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === 'trainer'))) {
      fail('invalid-spec', 'itemSpec', 'exploration items require one reviewed effect, one participant target, and a Trainer actor gate.')
    }
    if (effect.operation === 'search-for-shards') {
      const terrain = spec.choices.find(choice => choice.choiceId === 'dowsing-terrain')
      const skillStunt = spec.choices.find(choice => choice.choiceId === 'dowsing-skill-stunt')
      if (spec.timing !== 'extended' || !spec.contexts.includes('sheet')
        || !spec.contexts.includes('campaign') || !spec.contexts.includes('extended-action')
        || spec.duration.kind !== 'campaign-minutes' || spec.duration.amount !== 10
        || !spec.consumption.reusable || spec.consumption.phase !== 'never'
        || !spec.prerequisites.some(prerequisite => prerequisite.kind === 'gm')
        || !terrain || terrain.kind !== 'mode' || terrain.minimum !== 1 || terrain.maximum !== 1
        || terrain.optionSource !== 'authority' || terrain.options.length !== 0
        || terrain.privateTo !== 'gm'
        || !skillStunt || skillStunt.kind !== 'mode' || skillStunt.minimum !== 0
        || skillStunt.maximum !== 1 || skillStunt.optionSource !== 'authority'
        || skillStunt.options.length !== 0 || skillStunt.privateTo !== 'actor-owner'
        || spec.choices.length !== 2
        || spec.privacy.choices !== 'gm' || spec.privacy.outcome !== 'actor-owner') {
        fail('invalid-spec', 'itemSpec', 'Dowsing requires a GM-confirmed ten-minute reusable Extended Action and exact authority terrain and Skill Stunt choices.')
      }
    }
    else {
      if (spec.timing !== 'standard' || spec.duration.kind !== 'instant') {
        fail('invalid-spec', 'itemSpec', 'Bait, Fishing Lure, Honey, and Repels use reviewed immediate activation timing.')
      }
      const shouldReuse = effect.operation === 'start-route-lure'
      if (spec.consumption.reusable !== shouldReuse
        || (shouldReuse
          ? spec.consumption.phase !== 'never' || spec.consumption.quantity !== 0
          : spec.consumption.phase !== 'accepted-use' || spec.consumption.quantity !== 1)) {
        fail('invalid-spec', 'itemSpec.consumption', 'exploration-item consumption does not match its reviewed reusable or accepted-use policy.')
      }
      const mode = spec.choices.find(choice => choice.choiceId === 'exploration-use-mode')
      if (effect.operation === 'use-bait' || effect.operation === 'use-snack-or-bait'
        || effect.operation === 'use-repel') {
        if (!mode || mode.kind !== 'mode' || mode.minimum !== 1 || mode.maximum !== 1
          || mode.optionSource !== 'authority' || mode.options.length !== 0
          || mode.privateTo !== 'actor-owner' || spec.choices.length !== 1) {
          fail('invalid-spec', 'itemSpec.choices', 'Bait, Honey, and Repels require one authority-scoped use-mode choice.')
        }
      }
      else if (spec.choices.length !== 0) {
        fail('invalid-spec', 'itemSpec.choices', 'Fishing Lure does not accept an additional mode choice.')
      }
    }
  }
  const permanentAdvancements = spec.effects.filter(effect => [
    'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency', 'gain-next-level-experience',
  ].includes(effect.operation))
  if (permanentAdvancements.length > 0) {
    if (permanentAdvancements.length !== 1
      || spec.timing !== 'extended' || !spec.contexts.includes('sheet')
      || !spec.contexts.includes('extended-action') || spec.duration.kind !== 'instant'
      || spec.consumption.phase !== 'extended-action-completion'
      || spec.consumption.quantity !== 1 || spec.consumption.reusable
      || !spec.prerequisites.some(prerequisite => prerequisite.kind === 'actor-kind'
        && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === 'trainer'))
      || !spec.prerequisites.some(prerequisite => prerequisite.kind === 'target-kind'
        && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === 'pokemon'))
      || !spec.targets.some(target => target.kind === 'participant'
        && target.minimum === 1 && target.maximum === 1 && target.relationship === 'owned')
      || spec.privacy.choices !== 'actor-owner' || spec.privacy.outcome !== 'actor-owner') {
      fail('invalid-spec', 'itemSpec', 'permanent advancement requires one owned Pokémon target, private choices/outcome, Trainer Extended Action, and exact completion consumption.')
    }
    const advancement = permanentAdvancements[0]!
    const moveChoice = spec.choices.find(choice => choice.choiceId === 'permanent-move')
    const statChoice = spec.choices.find(choice => choice.choiceId === 'permanent-stat')
    const consentChoice = spec.choices.find(choice => choice.choiceId === 'trainer-consent')
    if (advancement.operation === 'increase-move-frequency') {
      if (!moveChoice || moveChoice.kind !== 'move' || moveChoice.minimum !== 1
        || moveChoice.maximum !== 1 || moveChoice.optionSource !== 'authority'
        || moveChoice.options.length !== 0 || statChoice || consentChoice) {
        fail('invalid-spec', 'itemSpec.choices', 'PP Up requires one authority-sourced Move choice.')
      }
    }
    else if (advancement.operation === 'modify-base-stat' && advancement.stat === 'selected') {
      if (!statChoice || statChoice.kind !== 'stat' || statChoice.minimum !== 1
        || statChoice.maximum !== 1 || statChoice.optionSource !== 'authority'
        || statChoice.options.length !== 0
        || !consentChoice || consentChoice.kind !== 'mode'
        || consentChoice.minimum !== 1 || consentChoice.maximum !== 1
        || consentChoice.optionSource !== 'spec' || consentChoice.options.length !== 1
        || consentChoice.options[0]?.optionId !== 'confirmed' || moveChoice) {
        fail('invalid-spec', 'itemSpec.choices', 'Stat Suppressant requires one authority Base Stat choice and one exact Trainer-consent confirmation.')
      }
    }
    else if (moveChoice || statChoice || consentChoice) {
      fail('invalid-spec', 'itemSpec.choices', 'This fixed permanent advancement does not accept Move, Base Stat, or consent choices.')
    }
  }
  const machineMoveLearning = spec.effects.filter(effect => effect.operation === 'learn-machine-move')
  if (machineMoveLearning.length > 0) {
    const effect = machineMoveLearning[0]!
    const replacementChoice = spec.choices.find(choice => choice.choiceId === 'machine-replacement')
    const confirmationChoice = spec.choices.find(choice => choice.choiceId === 'machine-confirmation')
    const expectedReusable = effect.machineKind === 'HM'
    if (machineMoveLearning.length !== 1 || spec.effects.length !== 1
      || spec.timing !== 'extended' || !spec.contexts.includes('sheet')
      || !spec.contexts.includes('campaign') || !spec.contexts.includes('extended-action')
      || spec.duration.kind !== 'campaign-minutes' || spec.duration.amount !== effect.learningMinutes
      || !spec.prerequisites.some(prerequisite => prerequisite.kind === 'actor-kind'
        && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === 'trainer'))
      || !spec.prerequisites.some(prerequisite => prerequisite.kind === 'target-kind'
        && prerequisite.values.some(value => value.toLocaleLowerCase('en-US') === 'pokemon'))
      || !spec.targets.some(target => target.kind === 'participant'
        && target.minimum === 1 && target.maximum === 1 && target.relationship === 'owned')
      || spec.privacy.choices !== 'actor-owner' || spec.privacy.outcome !== 'actor-owner'
      || spec.consumption.reusable !== expectedReusable
      || (expectedReusable
        ? spec.consumption.phase !== 'never' || spec.consumption.quantity !== 0
        : spec.consumption.phase !== 'extended-action-completion' || spec.consumption.quantity !== 1)
      || !replacementChoice || replacementChoice.kind !== 'move'
      || replacementChoice.minimum !== 1 || replacementChoice.maximum !== 1
      || replacementChoice.optionSource !== 'authority' || replacementChoice.options.length !== 0
      || !confirmationChoice || confirmationChoice.kind !== 'mode'
      || confirmationChoice.minimum !== 1 || confirmationChoice.maximum !== 1
      || confirmationChoice.optionSource !== 'spec' || confirmationChoice.options.length !== 1
      || confirmationChoice.options[0]?.optionId !== 'confirmed'
      || spec.choices.length !== 2) {
      fail('invalid-spec', 'itemSpec', 'machine Move learning requires one owned Pokémon, one authority replacement choice, exact confirmation, private Trainer Extended Action timing, and TM/HM-specific settlement.')
    }
  }
  const medicalTreatments = spec.effects.filter(effect => effect.operation === 'apply-medical-treatment')
  for (const effect of medicalTreatments) {
    if (spec.timing !== 'extended' || !spec.contexts.includes('extended-action')
      || spec.duration.kind !== 'campaign-minutes' || spec.duration.amount !== effect.durationMinutes) {
      fail('invalid-spec', 'itemSpec', `medical treatment ${effect.effectId} requires reviewed Extended Action and 360-minute campaign duration authority.`)
    }
    const guidedAdjudication = spec.implementationState === 'guided'
      && spec.consumption.phase === 'gm-adjudication'
      && spec.consumption.reserveWhilePending
    if ((!guidedAdjudication && spec.consumption.phase !== 'extended-action-completion')
      || spec.consumption.quantity !== 1 || spec.consumption.reusable) {
      fail('invalid-spec', 'itemSpec.consumption', `medical treatment ${effect.effectId} must consume one item at Extended Action completion or reviewed guided GM acceptance.`)
    }
    if (!spec.targets.some(target => target.kind === 'participant' && target.minimum === 1 && target.maximum === 1)) {
      fail('invalid-spec', 'itemSpec.targets', `medical treatment ${effect.effectId} requires one participant target.`)
    }
  }
  for (const effect of spec.effects.filter(effect => effect.operation === 'revive')) {
    if (!spec.prerequisites.some(prerequisite => prerequisite.kind === 'condition'
      && prerequisite.values.some(value => value.trim().toLocaleLowerCase('en-US') === 'fainted'))) {
      fail('invalid-spec', 'itemSpec.prerequisites', `revival effect ${effect.effectId} requires an explicit Fainted target prerequisite.`)
    }
    if (!spec.targets.some(target => target.kind === 'participant' && target.minimum > 0)) {
      fail('invalid-spec', 'itemSpec.targets', `revival effect ${effect.effectId} requires a participant target.`)
    }
  }
  const conditionEffects = spec.effects.filter(effect => effect.operation === 'remove-conditions')
  for (const effect of conditionEffects) {
    const choiceId = `condition:${effect.effectId}`
    const choice = spec.choices.find(candidate => candidate.choiceId === choiceId)
    if (effect.selection === 'choose-one') {
      if (!choice || choice.kind !== 'condition' || choice.minimum !== 1 || choice.maximum !== 1
        || choice.optionSource !== 'authority' || choice.options.length !== 0) {
        fail('invalid-spec', 'itemSpec.choices', `${choiceId} must be a required, authority-sourced single condition choice.`)
      }
    }
    else if (choice) {
      fail('invalid-spec', 'itemSpec.choices', `${choiceId} is only valid for choose-one condition removal.`)
    }
  }
  for (const choice of spec.choices.filter(candidate => candidate.kind === 'condition')) {
    if (!conditionEffects.some(effect => effect.selection === 'choose-one'
      && choice.choiceId === `condition:${effect.effectId}`)) {
      fail('invalid-spec', 'itemSpec.choices', `condition choice ${choice.choiceId} has no matching choose-one effect.`)
    }
  }
  return deepFreezeStrictJson(spec)
}
