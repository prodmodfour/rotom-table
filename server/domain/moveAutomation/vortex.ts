import { createHash } from 'node:crypto'
import {
  EncounterEffectValidationError,
  parseEncounterEffect,
  parseEncounterEffectDefinition,
  type EncounterEffect,
  type EncounterVortexEffect,
  type EncounterVortexEffectDefinition,
} from '#shared/moveAutomation/encounterEffects'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEffectRemovedEvent,
  type EncounterEvent,
} from '#shared/moveAutomation/events'
import {
  parseMoveEffectOperation,
  type MoveDirectHpEffectOperation,
} from '#shared/moveAutomation/effects'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import {
  computeSheetAbilityAwareMultiplier,
  getPassiveTypeEffectivenessSource,
} from '~/utils/sheetPassiveAbilityEffects'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { deepCloneJson } from '~/utils/serialization'
import { computeMultiplier } from '~/utils/typeChart'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'
import type {
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
  MoveDirectHpImmunityQueryInput,
} from './reducers/coreTokenEffectTypes'
import type {
  EncounterLifecycleTriggerContext,
  EncounterLifecycleTriggerHandler,
} from './reduceLifecycle'

export const VORTEX_EFFECT_BASE_ID = 'vortex.target' as const
export const VORTEX_LIFECYCLE_HANDLER_ID = 'handler.vortex-end-turn' as const
export const VORTEX_TICK_PERCENT = 10 as const
export const VORTEX_ESCAPE_DCS = Object.freeze([20, 14, 8, 2] as const)
export const VORTEX_CONDITIONS = Object.freeze(['Slowed', 'Trapped'] as const)

export const VORTEX_REASON_CODES = Object.freeze({
  applied: 'vortex.applied',
  targetImmune: 'vortex.target-immune',
  tick: 'vortex.end-turn-hp-loss',
  tickImmune: 'vortex.hp-loss-immune',
  escapeSucceeded: 'vortex.escape-succeeded',
  escapeFailed: 'vortex.escape-failed',
  attemptsExhausted: 'vortex.escape-attempts-exhausted',
  targetKnockedOut: 'vortex.cleanup.target-knocked-out',
  targetRecalled: 'vortex.cleanup.target-recalled',
  targetSwitched: 'vortex.cleanup.target-switched',
} as const)

export const SAND_TOMB_MOVE_SOURCE_ID = 'move.sand-tomb' as const
export const SAND_TOMB_VORTEX_OPERATION_ID = 'sand-tomb.vortex' as const

export const SAND_TOMB_VORTEX_DEFINITION = Object.freeze({
  kind: 'vortex',
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: VORTEX_ESCAPE_DCS.length,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
  tags: ['condition', 'vortex'],
  payload: {
    sourceType: 'ground',
    tickPercent: VORTEX_TICK_PERCENT,
    escapeDcs: VORTEX_ESCAPE_DCS,
  },
  dispel: { policy: 'matching-tags', tags: ['vortex'] },
  transferPolicy: 'retain',
} as const satisfies EncounterVortexEffectDefinition)

export type VortexEffectErrorCode =
  | 'invalid-vortex-effect'
  | 'invalid-vortex-definition'
  | 'vortex-attempt-state-invalid'

export class VortexEffectError extends Error {
  readonly code: VortexEffectErrorCode

  constructor(code: VortexEffectErrorCode, message: string) {
    super(message)
    this.name = 'VortexEffectError'
    this.code = code
  }
}

const fail = (code: VortexEffectErrorCode, message: string): never => {
  throw new VortexEffectError(code, message)
}

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000'))
  .digest('hex')
  .slice(0, 32)

/** One stable identity per target makes every Vortex move share replacement semantics. */
export const vortexEffectId = (targetPlacementId: string): string => (
  `${VORTEX_EFFECT_BASE_ID}.${digest(targetPlacementId)}`
)

export const isVortexEffect = (
  effect: EncounterEffect,
): effect is EncounterVortexEffect => effect.kind === 'vortex'

export const isSandTombVortexEffect = (
  effect: EncounterEffect,
): effect is EncounterVortexEffect => isVortexEffect(effect)
  && effect.source.moveId === SAND_TOMB_MOVE_SOURCE_ID
  && effect.source.operationId === SAND_TOMB_VORTEX_OPERATION_ID
  && effect.payload.sourceType === 'ground'
  && effect.payload.tickPercent === VORTEX_TICK_PERCENT
  && effect.payload.escapeDcs.length === VORTEX_ESCAPE_DCS.length
  && effect.payload.escapeDcs.every((dc, index) => dc === VORTEX_ESCAPE_DCS[index])

export const parseVortexEffectDefinition = (
  value: unknown,
  path = 'vortexEffectDefinition',
): EncounterVortexEffectDefinition => {
  try {
    const definition = parseEncounterEffectDefinition(value, path)
    if (definition.kind !== 'vortex') {
      return fail('invalid-vortex-definition', `${path} must be a vortex definition.`)
    }
    return definition
  }
  catch (error) {
    if (error instanceof EncounterEffectValidationError) {
      return fail('invalid-vortex-definition', error.message)
    }
    throw error
  }
}

export const parseVortexEffect = (
  value: unknown,
  path = 'vortexEffect',
): EncounterVortexEffect => {
  try {
    const effect = parseEncounterEffect(value, path)
    if (!isVortexEffect(effect)) {
      return fail('invalid-vortex-effect', `${path} must be a vortex effect.`)
    }
    return effect
  }
  catch (error) {
    if (error instanceof EncounterEffectValidationError) {
      return fail('invalid-vortex-effect', error.message)
    }
    throw error
  }
}

export interface VortexApplicationDecision {
  readonly applies: boolean
  readonly reasonCode: typeof VORTEX_REASON_CODES.applied | typeof VORTEX_REASON_CODES.targetImmune
  readonly blockedBy: string | null
}

/** Check only rules that prevent entering a Vortex; residual-damage immunity is separate. */
export const resolveVortexApplication = (input: {
  readonly target: SpawnedPokemon
  readonly definition: EncounterVortexEffectDefinition
}): VortexApplicationDecision => {
  const trappedImmunity = moveAutomationConditionImmunitySource(
    'Trapped',
    input.target,
    input.definition.payload.sourceType,
  )
  if (trappedImmunity) {
    return {
      applies: false,
      reasonCode: VORTEX_REASON_CODES.targetImmune,
      blockedBy: trappedImmunity,
    }
  }

  const sourceType = input.definition.payload.sourceType
  const baseMultiplier = computeMultiplier(sourceType, input.target.defenderTypes)
  const multiplier = computeSheetAbilityAwareMultiplier(
    sourceType,
    input.target.defenderTypes,
    input.target.abilityNames,
    input.target.defenderCapabilities,
    { baseMultiplier },
  )
  if (multiplier !== 0) {
    return { applies: true, reasonCode: VORTEX_REASON_CODES.applied, blockedBy: null }
  }
  return {
    applies: false,
    reasonCode: VORTEX_REASON_CODES.targetImmune,
    blockedBy: baseMultiplier === 0
      ? `${sourceType} type`
      : getPassiveTypeEffectivenessSource(
          sourceType,
          input.target.abilityNames,
          input.target.defenderCapabilities,
          { baseMultiplier },
        ) ?? `${sourceType} immunity`,
  }
}

/** Materialize one target-local instance from server-owned operation context. */
export const createVortexEffect = (input: {
  readonly definition: EncounterVortexEffectDefinition
  readonly operationId: string
  readonly moveId: string
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly createdRound: number
  readonly createdTurn: number
}): EncounterVortexEffect => parseVortexEffect({
  id: vortexEffectId(input.targetPlacementId),
  kind: input.definition.kind,
  source: {
    operationId: input.operationId,
    moveId: input.moveId,
    placementId: input.sourcePlacementId,
  },
  affected: {
    placementIds: [input.targetPlacementId],
    sideIds: [],
    cells: [],
  },
  createdRound: input.createdRound,
  createdTurn: input.createdTurn,
  duration: input.definition.duration,
  stacks: input.definition.stacks,
  charges: input.definition.charges,
  stackPolicy: input.definition.stackPolicy,
  chargePolicy: input.definition.chargePolicy,
  tags: input.definition.tags,
  payload: input.definition.payload,
  dispel: input.definition.dispel,
  transferPolicy: input.definition.transferPolicy,
  suppression: { sources: [] },
})

const vortexAttemptIndex = (effect: EncounterVortexEffect): number => {
  const charges = effect.charges
  if (charges === null || charges < 1 || charges > effect.payload.escapeDcs.length) {
    return fail(
      'vortex-attempt-state-invalid',
      `Vortex ${effect.id} has invalid remaining escape attempts ${String(charges)}.`,
    )
  }
  return effect.payload.escapeDcs.length - charges
}

export const vortexCurrentEscapeDc = (effect: EncounterVortexEffect): number => (
  effect.payload.escapeDcs[vortexAttemptIndex(effect)]
  ?? fail('vortex-attempt-state-invalid', `Vortex ${effect.id} has no current escape DC.`)
)

const tickOperation = (input: {
  readonly eventId: string
  readonly effect: EncounterVortexEffect
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: `vortex.tick.${digest(input.eventId, input.effect.id)}`,
  kind: 'direct-hp',
  source: { kind: 'encounter-effect', id: input.effect.id },
  recipients: { kind: 'selected-targets' },
  phase: 'cleanup',
  reasonCode: VORTEX_REASON_CODES.tick,
  payload: {
    mode: 'lose',
    pool: 'hit-points',
    calculation: {
      kind: 'percent-max',
      percent: input.effect.payload.tickPercent,
    },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: true,
    cost: null,
    injury: {
      hitPointMarkers: 'apply-after-operation',
      massiveDamage: 'never',
    },
  },
}, `vortex.tick.${input.effect.id}`) as MoveDirectHpEffectOperation

const removalEvent = (input: {
  readonly event: EncounterEvent
  readonly effect: EncounterVortexEffect
  readonly reasonCode: string
}): EncounterEffectRemovedEvent => parseEncounterEvents([{
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `event.vortex.remove.${digest(input.event.eventId, input.effect.id, input.reasonCode)}`,
  kind: 'effect-removed',
  sourceOperationId: input.event.sourceOperationId,
  causalParentEventId: input.event.eventId,
  reasonCode: input.reasonCode,
  effectId: input.effect.id,
}], 'vortex.removalEvent')[0] as EncounterEffectRemovedEvent

const targetCleanup = (event: EncounterEvent): {
  readonly placementId: string
  readonly reasonCode: string
} | null => {
  if (event.kind === 'move-ko') {
    return { placementId: event.targetPlacementId, reasonCode: VORTEX_REASON_CODES.targetKnockedOut }
  }
  if (event.kind === 'recall') {
    return { placementId: event.placementId, reasonCode: VORTEX_REASON_CODES.targetRecalled }
  }
  if (event.kind === 'switch') {
    return { placementId: event.recalledPlacementId, reasonCode: VORTEX_REASON_CODES.targetSwitched }
  }
  return null
}

const activeTargetVortexes = (
  context: EncounterLifecycleTriggerContext,
): readonly EncounterVortexEffect[] => context.state.effects.filter((effect): effect is EncounterVortexEffect => (
  isVortexEffect(effect)
  && effect.suppression.sources.length === 0
  && effect.charges !== 0
  && context.event.kind === 'turn-end'
  && effect.affected.placementIds[0] === context.event.placementId
))

/**
 * At each affected target turn end, enqueue one Tick, record a server-owned
 * d20 escape check, consume one attempt, and remove the Vortex on success.
 * The fourth failed attempt depletes its final charge and wears off naturally.
 */
export const createVortexLifecycleHandler = (): EncounterLifecycleTriggerHandler => Object.freeze({
  id: VORTEX_LIFECYCLE_HANDLER_ID,
  resolve: (context: EncounterLifecycleTriggerContext) => {
    if (context.event.kind === 'turn-end') {
      return activeTargetVortexes(context).map((effect) => {
        const dc = vortexCurrentEscapeDc(effect)
        const roll = context.random.roll({
          rollId: `vortex.escape.${digest(context.event.eventId, effect.id)}`,
          parentEffectId: effect.id,
          reason: `Vortex escape check DC ${dc}`,
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          modifiers: [],
        })
        const escaped = roll.finalValue >= dc
        const finalAttempt = effect.charges === 1
        return {
          effectId: effect.id,
          reasonCode: escaped
            ? VORTEX_REASON_CODES.escapeSucceeded
            : finalAttempt
              ? VORTEX_REASON_CODES.attemptsExhausted
              : VORTEX_REASON_CODES.escapeFailed,
          operations: [tickOperation({ eventId: context.event.eventId, effect })],
          emittedEvents: escaped && !finalAttempt
            ? [removalEvent({
                event: context.event,
                effect,
                reasonCode: VORTEX_REASON_CODES.escapeSucceeded,
              })]
            : [],
        }
      })
    }

    const cleanup = targetCleanup(context.event)
    if (!cleanup) return []
    const emittedEvents = context.state.effects
      .filter((effect): effect is EncounterVortexEffect => (
        isVortexEffect(effect)
        && effect.affected.placementIds[0] === cleanup.placementId
      ))
      .map(effect => removalEvent({ event: context.event, effect, reasonCode: cleanup.reasonCode }))
    return emittedEvents.length === 0
      ? []
      : [{
          effectId: null,
          reasonCode: cleanup.reasonCode,
          operations: [],
          emittedEvents,
        }]
  },
})

const VORTEX_HP_IMMUNITY_ABILITIES = Object.freeze(['Magic Guard', 'Permafrost'] as const)

export const vortexEffectForTickOperation = (input: {
  readonly operation: MoveDirectHpEffectOperation
  readonly effects: readonly EncounterEffect[]
}): EncounterVortexEffect | null => {
  if (
    input.operation.reasonCode !== VORTEX_REASON_CODES.tick
    || input.operation.source.kind !== 'encounter-effect'
    || !input.operation.id.startsWith('vortex.tick.')
  ) return null
  const effect = input.effects.find(candidate => candidate.id === input.operation.source.id)
  return effect && isVortexEffect(effect) ? effect : null
}

export const resolveVortexTickImmunity = (
  recipient: MoveCoreTokenEffectRecipient,
  hasEffectiveAbility?: (placementId: string, canonicalId: string) => boolean,
): MoveCoreTokenEffectImmunityDecision => {
  const ability = VORTEX_HP_IMMUNITY_ABILITIES.find(candidate => candidate === 'Magic Guard'
    ? hasEffectiveAbility?.(recipient.placement.id, candidate)
      ?? sheetHasCanonicalAbility(recipient.token.abilityNames, candidate)
    : sheetHasCanonicalAbility(recipient.token.abilityNames, candidate)) ?? null
  return { blockedBy: ability, consultedPlacementIds: [] }
}

/** Decorate only Vortex residual HP loss and delegate every unrelated query. */
export const createVortexLifecycleImmunityQueries = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly fallback: MoveCoreTokenEffectImmunityQueries
  readonly hasEffectiveAbility?: (placementId: string, canonicalId: string) => boolean
}): MoveCoreTokenEffectImmunityQueries => Object.freeze({
  directHp: (query: MoveDirectHpImmunityQueryInput) => vortexEffectForTickOperation({
    operation: query.operation,
    effects: input.effects,
  })
    ? resolveVortexTickImmunity(query.recipient, input.hasEffectiveAbility)
    : input.fallback.directHp(query),
  condition: input.fallback.condition,
  combatStage: input.fallback.combatStage,
})

export interface VortexKnockoutCleanupResult {
  readonly map: TabletopMap
  readonly changed: boolean
  readonly removedEffectIds: readonly string[]
}

/** Remove target-local Vortex state when immediate move planning already owns a KO fact. */
export const cleanupVortexEffectsForKnockouts = (input: {
  readonly map: TabletopMap
  readonly placementIds: readonly string[]
}): VortexKnockoutCleanupResult => {
  const map = deepCloneJson(input.map)
  const placementIds = new Set(input.placementIds)
  let state = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const removedEffectIds = state.effects.flatMap(effect => (
    isVortexEffect(effect) && placementIds.has(effect.affected.placementIds[0]!)
      ? [effect.id]
      : []
  ))
  for (const effectId of removedEffectIds) {
    const result = applyEncounterEffectLifecycleEvent(
      { effects: state.effects },
      { kind: 'effect-removed', effectId },
    )
    state = parseEncounterState({ ...state, effects: result.effects })
  }
  if (removedEffectIds.length > 0) map.encounterState = state
  return Object.freeze({
    map,
    changed: removedEffectIds.length > 0,
    removedEffectIds: Object.freeze(removedEffectIds),
  })
}
