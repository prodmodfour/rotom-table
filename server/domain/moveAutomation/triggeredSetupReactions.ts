import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveConditionEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  parseEncounterEvent,
  type EncounterEvent,
  type EncounterMoveHitEvent,
  type EncounterSwitchEvent,
} from '#shared/moveAutomation/events'
import { moveReactionTimingDefinition } from '#shared/moveAutomation/reactions'
import {
  assertMovePlanPlacement,
  assertMovePlanStableId,
  canonicalMovePlanPlacementIds,
  createMovePlanUsageSpend,
  deepFreezeInterruptibleMovePlan,
  type InterruptibleMovePlanAuthority,
  type MovePlanSourceReplacement,
  type MovePlanTargetReplacement,
  type MovePlanUsageSpend,
} from './interruptibleMovePlan'
import {
  moveSetupReactionDefinition,
  type MoveHitTriggeredReactionDefinition,
  type MoveSwitchInterruptReactionDefinition,
} from './setupReactionDefinitions'
import type {
  EncounterLifecycleTriggerHandler,
} from './reduceLifecycle'
import { stableJsonStringify } from './stableJson'

export type MoveTriggerRange = 'melee' | 'ranged' | 'other'
export type MoveTriggeredChildCanonicalId = 'Shell Trap' | 'Pursuit'

export const MOVE_TRIGGERED_REACTION_LIMITS = Object.freeze({
  applications: 32,
})

export interface MoveTriggeredReactionChildApplication {
  readonly reactionOperationId: string
  readonly canonicalMoveId: MoveTriggeredChildCanonicalId
  readonly reactorPlacementId: string
  readonly triggeringEventId: string
  readonly triggeringEventFingerprint: string
  readonly parentResolutionId: string | null
  readonly childResolutionId: string
  readonly sourcePlacementId: string
  readonly targetPlacementIds: readonly string[]
  readonly sourceReplacement: MovePlanSourceReplacement
  readonly targetReplacement: MovePlanTargetReplacement
  readonly actionTiming: 'interrupt'
  readonly damageBaseOverride: number | null
  readonly movementSpeedBonus: number
  readonly usageSpend: MovePlanUsageSpend
  readonly reasonCode: string
}

export interface MoveTriggeredReactionLedger {
  readonly applications: readonly MoveTriggeredReactionChildApplication[]
  readonly usageSpends: readonly MovePlanUsageSpend[]
}

export type ApplyMoveTriggeredChildReactionResult =
  | {
      readonly status: 'applied' | 'duplicate'
      readonly reasonCode: string
      readonly ledger: MoveTriggeredReactionLedger
      readonly application: MoveTriggeredReactionChildApplication
    }
  | {
      readonly status: 'ineligible'
      readonly reasonCode:
        | 'shell-trap-not-hit-target'
        | 'shell-trap-not-melee'
        | 'pursuit-target-not-enemy'
        | 'pursuit-target-unreachable'
      readonly ledger: MoveTriggeredReactionLedger
      readonly application: null
    }

export type MoveTriggeredReactionErrorCode =
  | 'invalid-trigger-event'
  | 'reaction-identity-conflict'
  | 'application-limit-exceeded'

export class MoveTriggeredReactionError extends Error {
  readonly code: MoveTriggeredReactionErrorCode

  constructor(code: MoveTriggeredReactionErrorCode, message: string) {
    super(message)
    this.name = 'MoveTriggeredReactionError'
    this.code = code
  }
}

const fail = (code: MoveTriggeredReactionErrorCode, message: string): never => {
  throw new MoveTriggeredReactionError(code, message)
}

const fingerprintEvent = (event: EncounterEvent): string => createHash('sha256')
  .update(stableJsonStringify(event))
  .digest('hex')

const derivedOperationId = (prefix: string, ...parts: readonly string[]): string => {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)
  return `${prefix}.${digest}`
}

export const createMoveTriggeredReactionLedger = (): MoveTriggeredReactionLedger => (
  deepFreezeInterruptibleMovePlan({ applications: [], usageSpends: [] })
)

const triggeredDefinition = (
  canonicalMoveId: MoveTriggeredChildCanonicalId,
): MoveHitTriggeredReactionDefinition | MoveSwitchInterruptReactionDefinition => {
  const definition = moveSetupReactionDefinition(canonicalMoveId)
  if (
    definition.family !== 'hit-triggered-child'
    && definition.family !== 'switch-interrupt'
  ) {
    return fail('invalid-trigger-event', `${canonicalMoveId} is not a triggered child definition.`)
  }
  return definition
}

/** Build a durable response request rooted in one authoritative lifecycle event. */
export const buildMoveTriggeredReactionRequestOperation = (input: {
  readonly canonicalMoveId: MoveTriggeredChildCanonicalId
  readonly operationId: string
  readonly triggeringEventId: string
  readonly recipients: MoveEffectRecipientSelectorKind
}): MoveReactionRequestEffectOperation => {
  const definition = triggeredDefinition(input.canonicalMoveId)
  const operation: MoveReactionRequestEffectOperation = {
    id: assertMovePlanStableId(input.operationId, 'Triggered request operation ID'),
    kind: 'reaction-request',
    source: {
      kind: 'lifecycle-event',
      id: assertMovePlanStableId(input.triggeringEventId, 'Triggering event ID'),
    },
    recipients: { kind: input.recipients },
    phase: moveReactionTimingDefinition(definition.timing).phase,
    reasonCode: `${definition.definitionId}.reaction-window`,
    payload: {
      requestId: `${definition.definitionId}.reaction-request`,
      promptKey: definition.promptKey,
      options: [{ id: definition.optionId, labelKey: definition.optionLabelKey }],
      allowPass: true,
      timing: definition.timing,
      priority: definition.priority,
    },
  }
  return parseMoveEffectOperation(
    operation,
    'setupReaction.triggeredRequest',
  ) as MoveReactionRequestEffectOperation
}

const burnAttackerOperation = (
  event: EncounterMoveHitEvent,
): MoveConditionEffectOperation => parseMoveEffectOperation({
  id: derivedOperationId('beak-burn', event.eventId),
  kind: 'condition',
  source: { kind: 'lifecycle-event', id: event.eventId },
  recipients: { kind: 'source-placement' },
  phase: 'hit',
  reasonCode: 'beak-blast.melee-attacker-burned',
  payload: {
    action: 'apply',
    conditionId: 'burned',
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
}, 'setupReaction.beakBlastBurn') as MoveConditionEffectOperation

/**
 * Register pure lifecycle work for active Beak Blast setups and eligible Shell
 * Trap users. Attack range is a server-derived event lookup, never event/client data.
 */
export const createMoveSetupLifecycleTriggerHandler = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly shellTrapUserPlacementIds: readonly string[]
  readonly attackRangesByEventId: Readonly<Record<string, MoveTriggerRange>>
}): EncounterLifecycleTriggerHandler => {
  const shellTrapUsers = new Set(canonicalMovePlanPlacementIds(
    input.authority,
    input.shellTrapUserPlacementIds,
    'Shell Trap eligible users',
  ))
  for (const range of Object.values(input.attackRangesByEventId)) {
    if (!['melee', 'ranged', 'other'].includes(range)) {
      return fail('invalid-trigger-event', 'Damage-range lookup contains an invalid range.')
    }
  }

  return Object.freeze({
    id: 'handler.move-setup-reactions',
    resolve: ({ event, state }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
      if (
        event.kind !== 'move-hit'
        || input.attackRangesByEventId[event.eventId] !== 'melee'
      ) return []
      const operations = []
      const activeSetup = state.turnResources[event.targetPlacementId]?.setupExecute
      if (
        activeSetup?.canonicalMoveId === 'Beak Blast'
        && activeSetup.status === 'setting-up'
      ) {
        operations.push(burnAttackerOperation(event))
      }
      if (shellTrapUsers.has(event.targetPlacementId)) {
        operations.push(buildMoveTriggeredReactionRequestOperation({
          canonicalMoveId: 'Shell Trap',
          operationId: derivedOperationId('shell-trap-window', event.eventId),
          triggeringEventId: event.eventId,
          recipients: 'hit-targets',
        }))
      }
      if (operations.length === 0) return []
      return [deepFreezeInterruptibleMovePlan({
        effectId: null,
        reasonCode: 'setup-reactions.melee-hit-triggers',
        operations,
        emittedEvents: [],
      })]
    },
  })
}

const ineligible = (
  ledger: MoveTriggeredReactionLedger,
  reasonCode: Extract<ApplyMoveTriggeredChildReactionResult, {
    status: 'ineligible'
  }>['reasonCode'],
): ApplyMoveTriggeredChildReactionResult => Object.freeze({
  status: 'ineligible',
  reasonCode,
  ledger,
  application: null,
})

const existingApplication = (input: {
  readonly ledger: MoveTriggeredReactionLedger
  readonly reactionOperationId: string
  readonly canonicalMoveId: MoveTriggeredChildCanonicalId
  readonly reactorPlacementId: string
  readonly childResolutionId: string
  readonly event: EncounterEvent
}): MoveTriggeredReactionChildApplication | null => {
  const existing = input.ledger.applications.find(
    application => application.reactionOperationId === input.reactionOperationId,
  )
  if (!existing) return null
  if (
    existing.canonicalMoveId !== input.canonicalMoveId
    || existing.reactorPlacementId !== input.reactorPlacementId
    || existing.childResolutionId !== input.childResolutionId
    || existing.triggeringEventId !== input.event.eventId
    || existing.triggeringEventFingerprint !== fingerprintEvent(input.event)
  ) {
    return fail(
      'reaction-identity-conflict',
      `Triggered reaction ${input.reactionOperationId} changed on replay.`,
    )
  }
  return existing
}

const appendApplication = (
  ledger: MoveTriggeredReactionLedger,
  application: MoveTriggeredReactionChildApplication,
): MoveTriggeredReactionLedger => {
  if (ledger.applications.length >= MOVE_TRIGGERED_REACTION_LIMITS.applications) {
    return fail('application-limit-exceeded', 'Triggered reaction application bound was exceeded.')
  }
  if (ledger.usageSpends.some(usage => usage.operationId === application.usageSpend.operationId)) {
    return fail('reaction-identity-conflict', 'Triggered reaction usage identity is duplicated.')
  }
  return deepFreezeInterruptibleMovePlan({
    applications: [...ledger.applications, application],
    usageSpends: [...ledger.usageSpends, application.usageSpend],
  })
}

export const applyShellTrapReaction = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly ledger: MoveTriggeredReactionLedger
  readonly triggeringEvent: EncounterMoveHitEvent
  readonly triggeringRange: MoveTriggerRange
  readonly reactorPlacementId: string
  readonly reactionOperationId: string
  readonly childResolutionId: string
}): ApplyMoveTriggeredChildReactionResult => {
  const event = parseEncounterEvent(input.triggeringEvent, 'shellTrap.triggeringEvent')
  if (event.kind !== 'move-hit') {
    return fail('invalid-trigger-event', 'Shell Trap requires a move-hit event.')
  }
  const definition = triggeredDefinition('Shell Trap')
  if (definition.family !== 'hit-triggered-child') {
    return fail('invalid-trigger-event', 'Shell Trap definition family changed unexpectedly.')
  }
  const reactorPlacementId = assertMovePlanPlacement(
    input.authority,
    input.reactorPlacementId,
    'Shell Trap reactor',
  )
  assertMovePlanPlacement(input.authority, event.move.actorPlacementId, 'Shell Trap attacker')
  const reactionOperationId = assertMovePlanStableId(
    input.reactionOperationId,
    'Shell Trap reaction operation ID',
  )
  const childResolutionId = assertMovePlanStableId(
    input.childResolutionId,
    'Shell Trap child resolution ID',
  )
  const existing = existingApplication({
    ledger: input.ledger,
    reactionOperationId,
    canonicalMoveId: 'Shell Trap',
    reactorPlacementId,
    childResolutionId,
    event,
  })
  if (existing) {
    return Object.freeze({
      status: 'duplicate',
      reasonCode: existing.reasonCode,
      ledger: input.ledger,
      application: existing,
    })
  }
  if (event.targetPlacementId !== reactorPlacementId) {
    return ineligible(input.ledger, 'shell-trap-not-hit-target')
  }
  if (input.triggeringRange !== 'melee') {
    return ineligible(input.ledger, 'shell-trap-not-melee')
  }
  const usageSpend = createMovePlanUsageSpend(input.authority, {
    operationId: `${reactionOperationId}.usage`,
    ownerPlacementId: reactorPlacementId,
    resourceId: definition.usageResourceId,
    disposition: 'reaction',
  })
  const application: MoveTriggeredReactionChildApplication = deepFreezeInterruptibleMovePlan({
    reactionOperationId,
    canonicalMoveId: definition.canonicalId,
    reactorPlacementId,
    triggeringEventId: event.eventId,
    triggeringEventFingerprint: fingerprintEvent(event),
    parentResolutionId: event.move.resolutionId,
    childResolutionId,
    sourcePlacementId: reactorPlacementId,
    targetPlacementIds: [event.move.actorPlacementId],
    sourceReplacement: {
      fromPlacementId: event.move.actorPlacementId,
      toPlacementId: reactorPlacementId,
    },
    targetReplacement: {
      fromPlacementId: reactorPlacementId,
      toPlacementId: event.move.actorPlacementId,
    },
    actionTiming: 'interrupt' as const,
    damageBaseOverride: null,
    movementSpeedBonus: 0,
    usageSpend,
    reasonCode: 'shell-trap.melee-hit-interrupt',
  })
  return Object.freeze({
    status: 'applied',
    reasonCode: application.reasonCode,
    ledger: appendApplication(input.ledger, application),
    application,
  })
}

export const applyPursuitReaction = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly ledger: MoveTriggeredReactionLedger
  readonly triggeringEvent: EncounterSwitchEvent
  readonly reactorPlacementId: string
  readonly reactionOperationId: string
  readonly childResolutionId: string
  readonly recalledTargetReachable: boolean
}): ApplyMoveTriggeredChildReactionResult => {
  const event = parseEncounterEvent(input.triggeringEvent, 'pursuit.triggeringEvent')
  if (event.kind !== 'switch') {
    return fail('invalid-trigger-event', 'Pursuit requires a switch event.')
  }
  const definition = triggeredDefinition('Pursuit')
  if (definition.family !== 'switch-interrupt') {
    return fail('invalid-trigger-event', 'Pursuit definition family changed unexpectedly.')
  }
  const reactorPlacementId = assertMovePlanPlacement(
    input.authority,
    input.reactorPlacementId,
    'Pursuit reactor',
  )
  assertMovePlanPlacement(input.authority, event.recalledPlacementId, 'Pursuit recalled target')
  assertMovePlanPlacement(input.authority, event.sentOutPlacementId, 'Pursuit sent-out placement')
  const reactionOperationId = assertMovePlanStableId(
    input.reactionOperationId,
    'Pursuit reaction operation ID',
  )
  const childResolutionId = assertMovePlanStableId(
    input.childResolutionId,
    'Pursuit child resolution ID',
  )
  const existing = existingApplication({
    ledger: input.ledger,
    reactionOperationId,
    canonicalMoveId: 'Pursuit',
    reactorPlacementId,
    childResolutionId,
    event,
  })
  if (existing) {
    return Object.freeze({
      status: 'duplicate',
      reasonCode: existing.reasonCode,
      ledger: input.ledger,
      application: existing,
    })
  }
  if (
    input.authority.relationships.resolve(
      reactorPlacementId,
      event.recalledPlacementId,
    ).relationship !== 'enemy'
  ) {
    return ineligible(input.ledger, 'pursuit-target-not-enemy')
  }
  if (!input.recalledTargetReachable) {
    return ineligible(input.ledger, 'pursuit-target-unreachable')
  }
  const usageSpend = createMovePlanUsageSpend(input.authority, {
    operationId: `${reactionOperationId}.usage`,
    ownerPlacementId: reactorPlacementId,
    resourceId: definition.usageResourceId,
    disposition: 'reaction',
  })
  const application: MoveTriggeredReactionChildApplication = deepFreezeInterruptibleMovePlan({
    reactionOperationId,
    canonicalMoveId: definition.canonicalId,
    reactorPlacementId,
    triggeringEventId: event.eventId,
    triggeringEventFingerprint: fingerprintEvent(event),
    parentResolutionId: null,
    childResolutionId,
    sourcePlacementId: reactorPlacementId,
    targetPlacementIds: [event.recalledPlacementId],
    sourceReplacement: {
      fromPlacementId: event.recalledPlacementId,
      toPlacementId: reactorPlacementId,
    },
    targetReplacement: {
      fromPlacementId: event.sentOutPlacementId,
      toPlacementId: event.recalledPlacementId,
    },
    actionTiming: 'interrupt' as const,
    damageBaseOverride: definition.damageBaseOverride,
    movementSpeedBonus: definition.movementSpeedBonus,
    usageSpend,
    reasonCode: 'pursuit.recalled-enemy-interrupted',
  })
  return Object.freeze({
    status: 'applied',
    reasonCode: application.reasonCode,
    ledger: appendApplication(input.ledger, application),
    application,
  })
}
