import { normalizeRevision } from '#shared/sessionRevisions'
import {
  beginAbilitySceneUsagePeriod,
  createEmptyAbilitySceneUsageLedger,
  parseAbilitySceneUsageLedger,
} from '#shared/abilityAutomation/resources'
import {
  ABILITY_TIMING_LIMITS,
  AbilityTimingValidationError,
  abilityTimingResourceKey,
  advanceAbilityTimingWindows,
  beginAbilityTimingScene,
  createEmptyAbilityTimingLedger,
  parseAbilityTimingLedger,
  type AbilityCooldown,
  type AbilityCooldownUnit,
  type AbilityTimingCursor,
  type AbilityTimingIdentity,
  type AbilityTimingLedger,
  type AbilityTimingReceipt,
  type AbilityTimingUse,
  type AbilityTimingWindowKind,
} from '#shared/abilityAutomation/timingResources'
import { createEmptyEncounterState, parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from './context'
import { reduceAbilityEffectLifecycleEncounter } from './effectLifecycle'
import { reduceAbilityOwnedStateLifecycle } from './ownedState'
import { createEmptyAbilityOwnedState } from '#shared/abilityAutomation/ownedState'
import { createEmptyAbilityEntityState } from '#shared/abilityAutomation/entities'
import { createEmptyAbilityTransformationState } from '#shared/abilityAutomation/transformations'
import { reduceAbilityEntityLifecycle } from './entities'
import { reduceAbilityTransformationLifecycle } from './transformations'
import { createEmptyAbilityEventReceiptState } from '#shared/abilityAutomation/eventReceipts'
import {
  advanceAbilityReactionAvailabilityRound,
  beginAbilityReactionAvailabilityScene,
  createEmptyAbilityReactionAvailabilityLedger,
} from '#shared/abilityAutomation/reactionResources'

export type AbilityTimingConstraint =
  | {
      readonly id: string
      readonly kind: AbilityTimingWindowKind
      readonly limit: number
    }
  | {
      readonly id: string
      readonly kind: 'cooldown'
      readonly unit: AbilityCooldownUnit
      readonly delay: number
    }

export interface AbilityTimingPaymentResult {
  readonly status: 'paid' | 'duplicate'
  readonly constraintKind: AbilityTimingConstraint['kind']
  readonly spent: number | null
  readonly limit: number | null
  readonly readySequence: number | null
  readonly plan: MoveStateChangePlan
}

export type AbilityTimingPaymentErrorCode =
  | 'ability-instance-missing'
  | 'scene-mismatch'
  | 'window-unavailable'
  | 'constraint-conflict'
  | 'operation-id-conflict'
  | 'limit-exhausted'
  | 'cooldown-active'
  | 'limit-exceeded'
  | 'invalid-timing-state'

export class AbilityTimingPaymentError extends Error {
  readonly code: AbilityTimingPaymentErrorCode

  constructor(code: AbilityTimingPaymentErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityTimingPaymentError'
    this.code = code
  }
}

const fail = (code: AbilityTimingPaymentErrorCode, detail: string): never => {
  throw new AbilityTimingPaymentError(code, detail)
}

const identityFor = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly abilityInstanceId: string
  readonly constraintId: string
}): AbilityTimingIdentity => ({
  ownerId: input.context.actor.placement.id,
  abilityInstanceId: input.abilityInstanceId,
  canonicalId: input.context.runtime.canonicalId,
  constraintId: input.constraintId,
})

const timingError = (callback: () => AbilityTimingLedger): AbilityTimingLedger => {
  try {
    return callback()
  }
  catch (error) {
    if (error instanceof AbilityTimingValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-timing-state',
        error.message,
      )
    }
    throw error
  }
}

const currentSequence = (
  ledger: AbilityTimingLedger,
  unit: AbilityTimingWindowKind,
): number => ledger[unit].sequence
  ?? fail('window-unavailable', `${unit} cursor is not active.`)

const receiptFor = (
  identity: AbilityTimingIdentity,
  operationId: string,
  kind: AbilityTimingReceipt['kind'],
  spentAtSequence: number,
  outcome: Pick<AbilityTimingReceipt, 'spent' | 'limit' | 'readySequence'>,
): AbilityTimingReceipt => ({ ...identity, operationId, kind, spentAtSequence, ...outcome })

const result = (input: {
  readonly status: 'paid' | 'duplicate'
  readonly constraint: AbilityTimingConstraint
  readonly use?: AbilityTimingUse
  readonly spent?: number | null
  readonly limit?: number | null
  readonly readySequence?: number | null
  readonly plan?: MoveStateChangePlan
}): AbilityTimingPaymentResult => Object.freeze({
  status: input.status,
  constraintKind: input.constraint.kind,
  spent: input.use?.spent ?? input.spent ?? null,
  limit: input.use?.limit ?? input.limit ?? null,
  readySequence: input.readySequence ?? null,
  plan: input.plan ?? createMoveStateChangePlan([]),
})

/** Plan one once-per-window or delayed-reavailability payment in encounter state. */
export const planAbilityTimingPayment = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly cursor: AbilityTimingCursor
  readonly abilityInstanceId: string
  readonly operationId: string
  readonly constraint: AbilityTimingConstraint
}): AbilityTimingPaymentResult => {
  const { context, constraint } = input
  if (!context.actor.effectiveAbilities.some(ability => (
    ability.instanceId === input.abilityInstanceId
    && ability.canonicalId === context.runtime.canonicalId
  ))) fail('ability-instance-missing', 'Timing ability instance is not effective for the actor.')

  const previousEncounter = parseEncounterState(
    context.map.encounterState ?? createEmptyEncounterState(),
  )
  const persisted = timingError(() => parseAbilityTimingLedger(
    previousEncounter.abilityTiming ?? createEmptyAbilityTimingLedger(),
  ))
  if (persisted.sceneId !== null && persisted.sceneId !== input.cursor.sceneId) {
    fail('scene-mismatch', 'Timing state requires an explicit scene transition.')
  }
  const sceneLedger = persisted.sceneId === null
    ? timingError(() => beginAbilityTimingScene(persisted, input.cursor.sceneId))
    : persisted
  const ledger = timingError(() => advanceAbilityTimingWindows(sceneLedger, input.cursor))
  const identity = identityFor({
    context,
    abilityInstanceId: input.abilityInstanceId,
    constraintId: constraint.id,
  })
  const resourceKey = abilityTimingResourceKey(identity)
  const operationReceipts = ledger.receipts.filter(receipt => receipt.operationId === input.operationId)
  const matchingReceipt = operationReceipts.find(receipt => (
    abilityTimingResourceKey(receipt) === resourceKey && receipt.kind === constraint.kind
  ))
  if (matchingReceipt) {
    return result({
      status: 'duplicate',
      constraint,
      spent: matchingReceipt.spent,
      limit: matchingReceipt.limit,
      readySequence: matchingReceipt.readySequence,
    })
  }
  if (operationReceipts.length > 0) {
    fail('operation-id-conflict', 'Timing operation ID already belongs to another resource.')
  }
  if (ledger.receipts.length >= ABILITY_TIMING_LIMITS.receipts) {
    fail('limit-exceeded', 'Timing receipt budget is exhausted for this scene.')
  }

  let nextLedger: AbilityTimingLedger
  let use: AbilityTimingUse | undefined
  let readySequence: number | undefined
  if (constraint.kind === 'round' || constraint.kind === 'turn') {
    if (!Number.isSafeInteger(constraint.limit) || constraint.limit < 1
      || constraint.limit > ABILITY_TIMING_LIMITS.usesPerConstraint) {
      fail('constraint-conflict', 'Window limit must be 1 through 10.')
    }
    const window = ledger[constraint.kind]
    const spentAtSequence = currentSequence(ledger, constraint.kind)
    const existing = window.uses.find(entry => abilityTimingResourceKey(entry) === resourceKey)
    if (existing && existing.limit !== constraint.limit) {
      fail('constraint-conflict', 'Window use limit changed within one window.')
    }
    if ((existing?.spent ?? 0) >= constraint.limit) {
      fail('limit-exhausted', `${constraint.kind} use limit is exhausted.`)
    }
    use = {
      ...identity,
      limit: constraint.limit,
      spent: (existing?.spent ?? 0) + 1,
    }
    const uses = existing
      ? window.uses.map(entry => entry === existing ? use! : entry)
      : [...window.uses, use]
    nextLedger = {
      ...ledger,
      [constraint.kind]: { ...window, uses },
      receipts: [...ledger.receipts, receiptFor(
        identity,
        input.operationId,
        constraint.kind,
        spentAtSequence,
        { spent: use.spent, limit: use.limit, readySequence: null },
      )],
    }
  }
  else {
    const cooldownConstraint = constraint as Extract<AbilityTimingConstraint, { kind: 'cooldown' }>
    if (!Number.isSafeInteger(cooldownConstraint.delay) || cooldownConstraint.delay < 1
      || cooldownConstraint.delay > ABILITY_TIMING_LIMITS.cooldownDelay) {
      fail('constraint-conflict', 'Cooldown delay is outside the supported bound.')
    }
    const spentAtSequence = currentSequence(ledger, cooldownConstraint.unit)
    const existing = ledger.cooldowns.find(entry => (
      abilityTimingResourceKey(entry) === resourceKey && entry.unit === cooldownConstraint.unit
    ))
    if (existing && spentAtSequence < existing.readySequence) {
      fail(
        'cooldown-active',
        `Cooldown remains active until ${cooldownConstraint.unit} ${existing.readySequence}.`,
      )
    }
    const nextReadySequence = spentAtSequence + cooldownConstraint.delay
    if (nextReadySequence > ABILITY_TIMING_LIMITS.sequence) {
      fail('limit-exceeded', 'Cooldown ready sequence exceeds the supported bound.')
    }
    readySequence = nextReadySequence
    const cooldown: AbilityCooldown = {
      ...identity,
      unit: cooldownConstraint.unit,
      readySequence: nextReadySequence,
    }
    nextLedger = {
      ...ledger,
      cooldowns: existing
        ? ledger.cooldowns.map(entry => entry === existing ? cooldown : entry)
        : [...ledger.cooldowns, cooldown],
      receipts: [...ledger.receipts, receiptFor(
        identity,
        input.operationId,
        'cooldown',
        spentAtSequence,
        { spent: null, limit: null, readySequence: nextReadySequence },
      )],
    }
  }

  const abilityTiming = timingError(() => parseAbilityTimingLedger(nextLedger))
  const currentEncounter = parseEncounterState({ ...previousEncounter, abilityTiming })
  const plan = createMoveStateChangePlan([{
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: context.map.slug },
    expectedRevision: normalizeRevision(context.map.revision),
    sourceOperationId: input.operationId,
    reasonCode: `ability-timing.${constraint.kind}-spent`,
    previous: previousEncounter,
    current: currentEncounter,
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }])
  return result({
    status: 'paid',
    constraint,
    ...(use ? { use } : {}),
    ...(readySequence === undefined ? {} : { readySequence }),
    plan,
  })
}

/** Reset all temporary ability resources only at an authoritative scene transition. */
export const planAbilitySceneResourceTransition = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly sceneId: string
  readonly operationId: string
}): MoveStateChangePlan => {
  const previous = parseEncounterState(
    input.context.map.encounterState ?? createEmptyEncounterState(),
  )
  if (
    previous.abilityUsage?.sceneId === input.sceneId
    && previous.abilityTiming?.sceneId === input.sceneId
  ) return createMoveStateChangePlan([])
  const durationEnded = reduceAbilityEffectLifecycleEncounter(previous, { kind: 'scene-end' }).encounter
  const ended = parseEncounterState({
    ...durationEnded,
    abilityOwnedState: reduceAbilityOwnedStateLifecycle(
      durationEnded.abilityOwnedState ?? createEmptyAbilityOwnedState(),
      { kind: 'scene-end' },
    ),
    abilityEntities: reduceAbilityEntityLifecycle(
      durationEnded.abilityEntities ?? createEmptyAbilityEntityState(),
      { kind: 'scene-end' },
    ),
    abilityTransformations: reduceAbilityTransformationLifecycle(
      durationEnded.abilityTransformations ?? createEmptyAbilityTransformationState(),
      { kind: 'scene-end' },
    ),
  })
  const abilityUsage = beginAbilitySceneUsagePeriod(
    parseAbilitySceneUsageLedger(ended.abilityUsage ?? createEmptyAbilitySceneUsageLedger()),
    input.sceneId,
  )
  const abilityTiming = timingError(() => beginAbilityTimingScene(
    parseAbilityTimingLedger(ended.abilityTiming ?? createEmptyAbilityTimingLedger()),
    input.sceneId,
  ))
  const current = parseEncounterState({
    ...ended,
    abilityUsage,
    abilityTiming,
    abilityEventReceipts: createEmptyAbilityEventReceiptState(),
    abilityReactionAvailability: beginAbilityReactionAvailabilityScene(
      ended.abilityReactionAvailability ?? createEmptyAbilityReactionAvailabilityLedger(),
      input.sceneId,
    ),
  })
  return createMoveStateChangePlan([{
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: input.operationId,
    reasonCode: 'ability-resources.scene-transition',
    previous,
    current,
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }])
}

/** Strict process-restart/reconnect recovery with monotonic timing reconciliation. */
export const recoverAbilityEncounterResources = (
  value: unknown,
  cursor: AbilityTimingCursor,
): EncounterState => {
  const encounter = parseEncounterState(value)
  const timing = parseAbilityTimingLedger(
    encounter.abilityTiming ?? createEmptyAbilityTimingLedger(),
  )
  const sceneTiming = timing.sceneId === null
    ? beginAbilityTimingScene(timing, cursor.sceneId)
    : timing
  const usage = parseAbilitySceneUsageLedger(
    encounter.abilityUsage ?? createEmptyAbilitySceneUsageLedger(),
  )
  if (sceneTiming.sceneId !== cursor.sceneId || (
    usage.sceneId !== null && usage.sceneId !== cursor.sceneId
  )) fail('scene-mismatch', 'Persisted ability resources belong to a different scene.')
  return parseEncounterState({
    ...encounter,
    abilityUsage: usage.sceneId === null
      ? beginAbilitySceneUsagePeriod(usage, cursor.sceneId)
      : usage,
    abilityTiming: advanceAbilityTimingWindows(sceneTiming, cursor),
    abilityReactionAvailability: advanceAbilityReactionAvailabilityRound(
      encounter.abilityReactionAvailability ?? createEmptyAbilityReactionAvailabilityLedger(),
      {
        sceneId: cursor.sceneId,
        roundId: cursor.roundId,
        roundSequence: cursor.roundSequence,
      },
    ),
  })
}
