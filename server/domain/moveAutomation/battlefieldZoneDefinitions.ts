import {
  ENCOUNTER_SMOKESCREEN_ACCURACY_PENALTY,
  type EncounterZoneHook,
  type EncounterZoneHooks,
  type EncounterZoneKind,
  type EncounterZoneModifiers,
} from '#shared/moveAutomation/encounterZones'
import {
  parseEncounterEffectDuration,
  type EncounterEffectDuration,
} from '#shared/moveAutomation/encounterEffects'
import type { MoveEffectCombatStage } from '#shared/moveAutomation/effects'

/**
 * Server-owned mechanics referenced by durable zone hook IDs.
 *
 * Zones store only stable references. The executable interpretation remains in
 * this audited registry and can emit only the existing bounded effect union.
 */
export type BattlefieldZoneEntryTargetPolicy = 'any' | 'enemy'
export type BattlefieldZoneEntryGroundingPolicy = 'any' | 'grounded'

interface BattlefieldZoneLayerRange {
  readonly minimumLayer: number
  readonly maximumLayer: number | null
}

export interface BattlefieldZoneDirectHpEntryEffect extends BattlefieldZoneLayerRange {
  readonly kind: 'direct-hp'
  readonly amount:
    | { readonly kind: 'tick' }
    | { readonly kind: 'fixed'; readonly value: number }
  readonly reasonCode: string
}

export interface BattlefieldZoneConditionEntryEffect extends BattlefieldZoneLayerRange {
  readonly kind: 'condition'
  readonly conditionId: string
  readonly duration: EncounterEffectDuration | null
  readonly reasonCode: string
}

export interface BattlefieldZoneCombatStageEntryEffect extends BattlefieldZoneLayerRange {
  readonly kind: 'combat-stage'
  readonly stage: MoveEffectCombatStage
  readonly value: number
  readonly reasonCode: string
}

export type BattlefieldZoneEntryEffect =
  | BattlefieldZoneDirectHpEntryEffect
  | BattlefieldZoneConditionEntryEffect
  | BattlefieldZoneCombatStageEntryEffect

export interface BattlefieldZoneEntryHandlerDefinition {
  readonly handlerId: string
  /** Enemy rules fail closed unless both the zone and placement have explicit sides. */
  readonly targetPolicy: BattlefieldZoneEntryTargetPolicy
  readonly grounding: BattlefieldZoneEntryGroundingPolicy
  /** Matching types ignore the hook without consuming the zone. */
  readonly immuneTypeIds: readonly string[]
  /** Matching types ignore the hook and remove the exact zone. */
  readonly absorbingTypeIds: readonly string[]
  readonly removeOnAbsorb: boolean
  readonly removeOnTrigger: boolean
  readonly effects: readonly BattlefieldZoneEntryEffect[]
}

export interface BattlefieldZoneEntryDefinitionRegistry {
  get(handlerId: string): BattlefieldZoneEntryHandlerDefinition | null
  entries(): readonly BattlefieldZoneEntryHandlerDefinition[]
}

export interface BattlefieldZoneCanonicalComponents {
  readonly hooks: EncounterZoneHooks
  readonly modifiers: EncounterZoneModifiers
}

export type BattlefieldZoneDefinitionErrorCode =
  | 'invalid-definition'
  | 'duplicate-handler-id'

export class BattlefieldZoneDefinitionError extends Error {
  readonly code: BattlefieldZoneDefinitionErrorCode

  constructor(code: BattlefieldZoneDefinitionErrorCode, message: string) {
    super(message)
    this.name = 'BattlefieldZoneDefinitionError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const TYPE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_IDENTIFIER_CHARS = 160
const MAX_EFFECTS = 16
const MAX_TYPES = 18
const MAX_NUMERIC_MAGNITUDE = 1_000_000

const fail = (
  code: BattlefieldZoneDefinitionErrorCode,
  message: string,
): never => {
  throw new BattlefieldZoneDefinitionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const validStableId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_IDENTIFIER_CHARS
  && STABLE_ID_PATTERN.test(value)
)

const assertTypeIds = (
  values: readonly string[],
  handlerId: string,
  field: string,
): void => {
  if (!Array.isArray(values) || values.length > MAX_TYPES) {
    fail('invalid-definition', `${handlerId}.${field} must be a bounded type-ID array.`)
  }
  if (
    values.some(value => typeof value !== 'string' || !TYPE_ID_PATTERN.test(value))
    || new Set(values).size !== values.length
  ) {
    fail('invalid-definition', `${handlerId}.${field} contains an invalid or duplicate type ID.`)
  }
}

const assertLayerRange = (
  effect: BattlefieldZoneEntryEffect,
  handlerId: string,
): void => {
  if (!Number.isSafeInteger(effect.minimumLayer) || effect.minimumLayer < 1 || effect.minimumLayer > 64) {
    fail('invalid-definition', `${handlerId} has an invalid minimum layer.`)
  }
  if (
    effect.maximumLayer !== null
    && (
      !Number.isSafeInteger(effect.maximumLayer)
      || effect.maximumLayer < effect.minimumLayer
      || effect.maximumLayer > 64
    )
  ) {
    fail('invalid-definition', `${handlerId} has an invalid maximum layer.`)
  }
}

const assertEffect = (
  effect: BattlefieldZoneEntryEffect,
  handlerId: string,
): void => {
  if (!effect || typeof effect !== 'object' || !validStableId(effect.reasonCode)) {
    fail('invalid-definition', `${handlerId} has an invalid typed entry effect.`)
  }
  assertLayerRange(effect, handlerId)
  if (effect.kind === 'direct-hp') {
    if (!effect.amount || typeof effect.amount !== 'object') {
      fail('invalid-definition', `${handlerId} has no HP amount definition.`)
    }
    if (
      effect.amount.kind === 'fixed'
      && (
        !Number.isSafeInteger(effect.amount.value)
        || effect.amount.value < 0
        || effect.amount.value > MAX_NUMERIC_MAGNITUDE
      )
    ) {
      fail('invalid-definition', `${handlerId} has an invalid fixed HP amount.`)
    }
    if (effect.amount.kind !== 'tick' && effect.amount.kind !== 'fixed') {
      fail('invalid-definition', `${handlerId} has an unsupported HP amount kind.`)
    }
    return
  }
  if (effect.kind === 'condition') {
    if (!validStableId(effect.conditionId)) {
      fail('invalid-definition', `${handlerId} has an invalid condition ID.`)
    }
    if (effect.duration !== null) {
      try {
        parseEncounterEffectDuration(effect.duration, `${handlerId}.duration`)
      }
      catch (error) {
        fail(
          'invalid-definition',
          `${handlerId} has an invalid condition duration: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return
  }
  if (
    effect.kind !== 'combat-stage'
    || !Number.isSafeInteger(effect.value)
    || Math.abs(effect.value) > 6
    || effect.value === 0
  ) {
    fail('invalid-definition', `${handlerId} has an invalid combat-stage effect.`)
  }
}

const parseDefinition = (
  value: BattlefieldZoneEntryHandlerDefinition,
): BattlefieldZoneEntryHandlerDefinition => {
  if (!value || typeof value !== 'object' || !validStableId(value.handlerId)) {
    return fail('invalid-definition', 'Zone entry handler IDs must be bounded stable identifiers.')
  }
  if (value.targetPolicy !== 'any' && value.targetPolicy !== 'enemy') {
    fail('invalid-definition', `${value.handlerId} has an unsupported target policy.`)
  }
  if (value.grounding !== 'any' && value.grounding !== 'grounded') {
    fail('invalid-definition', `${value.handlerId} has an unsupported grounding policy.`)
  }
  assertTypeIds(value.immuneTypeIds, value.handlerId, 'immuneTypeIds')
  assertTypeIds(value.absorbingTypeIds, value.handlerId, 'absorbingTypeIds')
  if (value.immuneTypeIds.some(typeId => value.absorbingTypeIds.includes(typeId))) {
    fail('invalid-definition', `${value.handlerId} cannot both ignore and absorb for one type.`)
  }
  if (typeof value.removeOnAbsorb !== 'boolean' || typeof value.removeOnTrigger !== 'boolean') {
    fail('invalid-definition', `${value.handlerId} removal policies must be booleans.`)
  }
  if (value.absorbingTypeIds.length > 0 && !value.removeOnAbsorb) {
    fail('invalid-definition', `${value.handlerId} absorbing types must remove the zone.`)
  }
  if (!Array.isArray(value.effects) || value.effects.length === 0 || value.effects.length > MAX_EFFECTS) {
    fail('invalid-definition', `${value.handlerId} must contain a bounded non-empty effect list.`)
  }
  value.effects.forEach(effect => assertEffect(effect, value.handlerId))
  return deepFreeze(structuredClone(value))
}

/** Build an immutable audited handler lookup; duplicate or malformed definitions fail closed. */
export const createBattlefieldZoneEntryDefinitionRegistry = (
  definitions: readonly BattlefieldZoneEntryHandlerDefinition[],
): BattlefieldZoneEntryDefinitionRegistry => {
  if (!Array.isArray(definitions) || definitions.length > 64) {
    return fail('invalid-definition', 'Zone entry definitions must be a bounded array.')
  }
  const parsed = definitions.map(parseDefinition)
  const byId = new Map<string, BattlefieldZoneEntryHandlerDefinition>()
  for (const definition of parsed) {
    if (byId.has(definition.handlerId)) {
      fail('duplicate-handler-id', `Zone entry handler ${definition.handlerId} is duplicated.`)
    }
    byId.set(definition.handlerId, definition)
  }
  const entries = deepFreeze([...parsed])
  return Object.freeze({
    get: (handlerId: string) => byId.get(handlerId) ?? null,
    entries: () => entries,
  })
}

const ALL_LAYERS = Object.freeze({ minimumLayer: 1, maximumLayer: null })
const SLOWED_UNTIL_TARGET_TURN_END = Object.freeze({
  kind: 'turns' as const,
  subject: 'target' as const,
  boundary: 'end' as const,
  remaining: 1,
})

export const DEFAULT_BATTLEFIELD_ZONE_ENTRY_DEFINITIONS = deepFreeze([
  {
    handlerId: 'zone.hazard.spikes.entry',
    targetPolicy: 'enemy',
    grounding: 'grounded',
    immuneTypeIds: [],
    absorbingTypeIds: [],
    removeOnAbsorb: false,
    removeOnTrigger: false,
    effects: [
      {
        ...ALL_LAYERS,
        kind: 'direct-hp',
        amount: { kind: 'tick' },
        reasonCode: 'zone.hazard.spikes.tick',
      },
      {
        ...ALL_LAYERS,
        kind: 'condition',
        conditionId: 'slowed',
        duration: SLOWED_UNTIL_TARGET_TURN_END,
        reasonCode: 'zone.hazard.spikes.slowed',
      },
    ],
  },
  {
    handlerId: 'zone.hazard.toxic-spikes.entry',
    targetPolicy: 'enemy',
    grounding: 'grounded',
    immuneTypeIds: [],
    absorbingTypeIds: ['poison'],
    removeOnAbsorb: true,
    removeOnTrigger: false,
    effects: [
      {
        minimumLayer: 1,
        maximumLayer: 1,
        kind: 'condition',
        conditionId: 'poisoned',
        duration: null,
        reasonCode: 'zone.hazard.toxic-spikes.poisoned',
      },
      {
        minimumLayer: 2,
        maximumLayer: null,
        kind: 'condition',
        conditionId: 'badly-poisoned',
        duration: null,
        reasonCode: 'zone.hazard.toxic-spikes.badly-poisoned',
      },
      {
        ...ALL_LAYERS,
        kind: 'condition',
        conditionId: 'slowed',
        duration: SLOWED_UNTIL_TARGET_TURN_END,
        reasonCode: 'zone.hazard.toxic-spikes.slowed',
      },
    ],
  },
  {
    handlerId: 'zone.hazard.sticky-web.entry',
    targetPolicy: 'enemy',
    grounding: 'grounded',
    immuneTypeIds: [],
    absorbingTypeIds: ['bug'],
    removeOnAbsorb: true,
    removeOnTrigger: false,
    effects: [
      {
        ...ALL_LAYERS,
        kind: 'combat-stage',
        stage: 'spd',
        value: -1,
        reasonCode: 'zone.hazard.sticky-web.speed',
      },
      {
        ...ALL_LAYERS,
        kind: 'condition',
        conditionId: 'slowed',
        duration: SLOWED_UNTIL_TARGET_TURN_END,
        reasonCode: 'zone.hazard.sticky-web.slowed',
      },
    ],
  },
  {
    handlerId: 'zone.hazard.stealth-rock.entry',
    targetPolicy: 'enemy',
    grounding: 'any',
    immuneTypeIds: [],
    absorbingTypeIds: [],
    removeOnAbsorb: false,
    removeOnTrigger: false,
    effects: [{
      ...ALL_LAYERS,
      kind: 'direct-hp',
      amount: { kind: 'tick' },
      reasonCode: 'zone.hazard.stealth-rock.tick',
    }],
  },
  {
    handlerId: 'zone.hazard.fire.entry',
    targetPolicy: 'any',
    grounding: 'any',
    immuneTypeIds: [],
    absorbingTypeIds: [],
    removeOnAbsorb: false,
    removeOnTrigger: false,
    effects: [{
      ...ALL_LAYERS,
      kind: 'direct-hp',
      amount: { kind: 'tick' },
      reasonCode: 'zone.hazard.fire.tick',
    }],
  },
  {
    handlerId: 'zone.pledge.fire-grass.entry',
    targetPolicy: 'any',
    grounding: 'any',
    immuneTypeIds: [],
    absorbingTypeIds: [],
    removeOnAbsorb: false,
    removeOnTrigger: false,
    effects: [{
      ...ALL_LAYERS,
      kind: 'direct-hp',
      amount: { kind: 'tick' },
      reasonCode: 'zone.pledge.fire-grass.tick',
    }],
  },
] satisfies readonly BattlefieldZoneEntryHandlerDefinition[])

export const DEFAULT_BATTLEFIELD_ZONE_ENTRY_REGISTRY =
  createBattlefieldZoneEntryDefinitionRegistry(DEFAULT_BATTLEFIELD_ZONE_ENTRY_DEFINITIONS)

const emptyComponents = (): BattlefieldZoneCanonicalComponents => ({
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
})

const entryHook = (handlerId: string): EncounterZoneHook => ({
  id: handlerId,
  handlerId,
  oncePerMovement: true,
})

const slowTerrainComponents = (
  handlerId: string,
  reasonCode: string,
): BattlefieldZoneCanonicalComponents => ({
  hooks: { entry: [entryHook(handlerId)], exit: [] },
  modifiers: {
    targeting: [],
    damage: [],
    movement: [{
      id: `${handlerId}.slow-terrain`,
      attribute: 'cost',
      operation: 'multiply',
      value: 2,
      reasonCode,
    }],
  },
})

/** Canonical mechanics attached to move-created and legacy compatibility zones. */
export const canonicalBattlefieldZoneComponents = (input: {
  readonly kind: EncounterZoneKind
  readonly effectId: string
}): BattlefieldZoneCanonicalComponents => {
  const key = `${input.kind}:${input.effectId}`
  if (input.kind === 'barrier') {
    return deepFreeze({
      hooks: { entry: [], exit: [] },
      modifiers: {
        targeting: [{
          id: 'zone.barrier.line-of-sight',
          attribute: 'line-of-sight',
          operation: 'block',
          value: null,
          reasonCode: 'zone.barrier.line-of-sight-blocked',
        }],
        damage: [],
        movement: [{
          id: 'zone.barrier.traversal',
          attribute: 'traversal',
          operation: 'block',
          value: null,
          reasonCode: 'zone.barrier.traversal-blocked',
        }],
      },
    })
  }
  if (key === 'smoke:smokescreen') {
    return deepFreeze({
      hooks: { entry: [], exit: [] },
      modifiers: {
        targeting: [{
          id: 'zone.smokescreen.accuracy',
          attribute: 'accuracy',
          operation: 'add',
          value: ENCOUNTER_SMOKESCREEN_ACCURACY_PENALTY,
          reasonCode: 'zone.smokescreen.accuracy-penalty',
        }],
        damage: [],
        movement: [],
      },
    })
  }
  if (key === 'hazard:spikes') {
    return deepFreeze(slowTerrainComponents(
      'zone.hazard.spikes.entry',
      'zone.hazard.spikes.slow-terrain',
    ))
  }
  if (key === 'hazard:toxic-spikes') {
    return deepFreeze(slowTerrainComponents(
      'zone.hazard.toxic-spikes.entry',
      'zone.hazard.toxic-spikes.slow-terrain',
    ))
  }
  if (key === 'hazard:sticky-web') {
    return deepFreeze(slowTerrainComponents(
      'zone.hazard.sticky-web.entry',
      'zone.hazard.sticky-web.slow-terrain',
    ))
  }
  if (key === 'hazard:stealth-rock') {
    return deepFreeze({
      ...emptyComponents(),
      hooks: { entry: [entryHook('zone.hazard.stealth-rock.entry')], exit: [] },
    })
  }
  if (key === 'hazard:fire') {
    return deepFreeze({
      ...emptyComponents(),
      hooks: { entry: [entryHook('zone.hazard.fire.entry')], exit: [] },
    })
  }
  if (key === 'pledge:fire-grass' || key === 'pledge:sea-of-fire') {
    return deepFreeze({
      ...emptyComponents(),
      hooks: { entry: [entryHook('zone.pledge.fire-grass.entry')], exit: [] },
    })
  }
  return deepFreeze(emptyComponents())
}
