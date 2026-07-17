import type {
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterMoveDamagedEvent,
  type EncounterMoveHitEvent,
  type EncounterRoundEvent,
  type EncounterSwitchEvent,
} from '#shared/moveAutomation/events'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  applyMoveTargetRedirection,
  applyPursuitReaction,
  applyReviewedMovePlanCancellation,
  applyShellTrapReaction,
  createInterruptibleMovePlan,
  createMovePlanUsageSpend,
  createMoveRoundSetupState,
  createMoveSetupLifecycleTriggerHandler,
  createMoveTargetRedirectionState,
  createMoveTriggeredReactionLedger,
  reduceMoveRoundSetupEvent,
  synchronizeMoveRoundSetupResources,
  type InterruptibleMovePlan,
  type InterruptibleMovePlanAuthority,
  type MoveResolvedOperationPlan,
} from '~~/server/domain/moveAutomation/setupAndRedirectionReactions'
import {
  createMoveAutomationRelationshipResolver,
  type MoveAutomationRelationshipPlacement,
} from '~~/server/domain/moveAutomation/relationships'
import { reduceEncounterLifecycle } from '~~/server/domain/moveAutomation/reduceLifecycle'

const PLACEMENTS = Object.freeze([
  { id: 'attacker', sideId: 'red' },
  { id: 'other-red', sideId: 'red' },
  { id: 'setup-user', sideId: 'blue' },
  { id: 'redirector', sideId: 'blue' },
  { id: 'original-target', sideId: 'blue' },
  { id: 'sent-out', sideId: 'blue' },
  { id: 'unknown-side' },
] satisfies readonly MoveAutomationRelationshipPlacement[])

export const createSetupReactionCanaryAuthority = (): InterruptibleMovePlanAuthority => Object.freeze({
  placementIds: Object.freeze(PLACEMENTS.map(placement => placement.id)),
  relationships: createMoveAutomationRelationshipResolver({
    placements: PLACEMENTS,
    sides: {
      blue: { id: 'blue', label: 'Blue', status: 'active' },
      red: { id: 'red', label: 'Red', status: 'active' },
    },
  }),
})

export const setupDamageOperation = (
  id: string,
  canonicalId: string,
  damageBase = 7,
  moveType = 'normal',
  damageClass: 'physical' | 'special' = 'physical',
): MoveDamageEffectOperation => ({
  id,
  kind: 'damage',
  source: { kind: 'move', id: `move.${canonicalId.toLowerCase().replaceAll(' ', '-')}` },
  recipients: { kind: 'selected-targets' },
  phase: 'damage',
  reasonCode: `${id}.damage`,
  payload: {
    damageClass,
    damageBase,
    moveType,
    accuracyRollId: null,
    criticalRollId: null,
  },
})

const chatterConditionOperation = (): MoveConditionEffectOperation => ({
  id: 'chatter.confusion',
  kind: 'condition',
  source: { kind: 'move', id: 'move.chatter' },
  recipients: { kind: 'selected-targets' },
  phase: 'hit',
  reasonCode: 'chatter.confusion-threshold',
  payload: {
    action: 'apply',
    conditionId: 'confused',
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const shieldOperation = (): MoveTemporaryEffectOperation => ({
  id: 'protect.shield-effect',
  kind: 'temporary-effect',
  source: { kind: 'move', id: 'move.protect' },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: 'protect.shield-effect',
  payload: {
    action: 'add',
    effectId: 'protect.shield',
    definition: {
      kind: 'capability',
      duration: { kind: 'until-triggered', remaining: null },
      stacks: 1,
      charges: 1,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['shield'],
      payload: { capabilityId: 'shield.protect', action: 'grant' },
      dispel: { policy: 'none', tags: [] },
    },
  },
})

const resolvedOperation = (
  operation: MoveResolvedOperationPlan['operation'],
  sourcePlacementId: string,
  recipientIds: readonly string[],
): MoveResolvedOperationPlan => ({ operation, sourcePlacementId, recipientIds })

export const setupReactionPlan = (input: {
  readonly authority?: InterruptibleMovePlanAuthority
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly actorPlacementId: string
  readonly targetPlacementIds: readonly string[]
  readonly operations: readonly MoveResolvedOperationPlan[]
  readonly keywords?: readonly string[]
  readonly targetClass?: InterruptibleMovePlan['targetClass']
  readonly targetRedirectionAllowed?: boolean
  readonly triggeringActionSourcePlacementId?: string | null
}): InterruptibleMovePlan => {
  const authority = input.authority ?? createSetupReactionCanaryAuthority()
  return createInterruptibleMovePlan(authority, {
    resolutionId: input.resolutionId,
    canonicalMoveId: input.canonicalMoveId,
    actorPlacementId: input.actorPlacementId,
    triggeringActionSourcePlacementId: input.triggeringActionSourcePlacementId ?? null,
    keywords: input.keywords ?? [],
    targetClass: input.targetClass ?? 'opponents',
    targetRedirectionAllowed: input.targetRedirectionAllowed ?? true,
    targetPlacementIds: input.targetPlacementIds,
    operations: input.operations,
    usageSpends: [createMovePlanUsageSpend(authority, {
      operationId: `${input.resolutionId}.usage`,
      ownerPlacementId: input.actorPlacementId,
      resourceId: `${input.canonicalMoveId.toLowerCase().replaceAll(' ', '-')}.frequency-use`,
      disposition: 'triggering-move',
    })],
  })
}

export const setupDamageEvent = (input: {
  readonly eventId: string
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly sourcePlacementId?: string
  readonly targetPlacementId?: string
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss?: number
  readonly damageClass?: 'physical' | 'special' | 'direct'
  readonly moveType?: string | null
}): EncounterMoveDamagedEvent => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: input.eventId,
  kind: 'move-damaged',
  sourceOperationId: `${input.eventId}.operation`,
  causalParentEventId: null,
  reasonCode: 'setup-canary.damage',
  move: {
    resolutionId: input.resolutionId,
    canonicalId: input.canonicalMoveId,
    specVersion: 2,
    actorPlacementId: input.sourcePlacementId ?? 'attacker',
    actionType: 'standard',
    origin: { kind: 'direct' },
    moveListSource: {
      kind: 'placement',
      placementId: input.sourcePlacementId ?? 'attacker',
    },
  },
  targetPlacementId: input.targetPlacementId ?? 'setup-user',
  hitIndex: 1,
  damage: {
    hitPointLoss: input.hitPointLoss,
    temporaryHitPointLoss: input.temporaryHitPointLoss ?? 0,
    damageClass: input.damageClass ?? 'physical',
    moveType: input.moveType === undefined ? 'normal' : input.moveType,
  },
}) as EncounterMoveDamagedEvent

export const setupHitEvent = (input: {
  readonly eventId: string
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly sourcePlacementId?: string
  readonly targetPlacementId?: string
}): EncounterMoveHitEvent => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: input.eventId,
  kind: 'move-hit',
  sourceOperationId: `${input.eventId}.operation`,
  causalParentEventId: null,
  reasonCode: 'setup-canary.hit',
  move: {
    resolutionId: input.resolutionId,
    canonicalId: input.canonicalMoveId,
    specVersion: 2,
    actorPlacementId: input.sourcePlacementId ?? 'attacker',
    actionType: 'standard',
    origin: { kind: 'direct' },
    moveListSource: {
      kind: 'placement',
      placementId: input.sourcePlacementId ?? 'attacker',
    },
  },
  targetPlacementId: input.targetPlacementId ?? 'setup-user',
  hitIndex: 1,
}) as EncounterMoveHitEvent

export const setupRoundEndEvent = (round: number): EncounterRoundEvent => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `event.round.${round}.end`,
  kind: 'round-end',
  sourceOperationId: `initiative.round.${round}.end`,
  causalParentEventId: null,
  reasonCode: 'initiative.round-end',
  round,
}) as EncounterRoundEvent

export const setupSwitchEvent = (): EncounterSwitchEvent => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: 'event.switch.original-target',
  kind: 'switch',
  sourceOperationId: 'switch.original-target',
  causalParentEventId: null,
  reasonCode: 'switch.recall-and-send-out',
  recalledPlacementId: 'original-target',
  sentOutPlacementId: 'sent-out',
}) as EncounterSwitchEvent

const roundSetupPlan = (
  authority: InterruptibleMovePlanAuthority,
  canonicalMoveId: 'Focus Punch' | 'Beak Blast',
): InterruptibleMovePlan => setupReactionPlan({
  authority,
  resolutionId: `resolution.${canonicalMoveId.toLowerCase().replaceAll(' ', '-')}.1`,
  canonicalMoveId,
  actorPlacementId: 'setup-user',
  targetPlacementIds: ['attacker'],
  operations: [resolvedOperation(
    setupDamageOperation(
      `${canonicalMoveId.toLowerCase().replaceAll(' ', '-')}.damage`,
      canonicalMoveId,
      canonicalMoveId === 'Focus Punch' ? 15 : 10,
      canonicalMoveId === 'Focus Punch' ? 'fighting' : 'flying',
    ),
    'setup-user',
    ['attacker'],
  )],
})

export const SETUP_REACTION_CANARY_SCENARIO_IDS = Object.freeze([
  'setup.focus-punch-cancel-before-commit',
  'setup.beak-blast-melee-burn-and-execute',
  'setup.shell-trap-melee-child',
  'redirection.follow-me-before-accuracy',
  'redirection.rage-powder-shift-and-target',
  'cancellation.feint-breaks-shield-plan',
  'interrupt.pursuit-recalled-foe',
  'cancellation.chatter-drown-out',
])

export const runFocusPunchCancellationCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const state = createMoveRoundSetupState({
    setupId: 'setup.focus-punch.1',
    canonicalMoveId: 'Focus Punch',
    actorPlacementId: 'setup-user',
    actorMaximumHitPoints: 40,
    declaredRound: 2,
    declaredTurn: 4,
    pendingPlan: roundSetupPlan(authority, 'Focus Punch'),
  })
  const event = setupDamageEvent({
    eventId: 'event.focus-punch.cancel-hit',
    resolutionId: 'resolution.provoking-hit',
    canonicalMoveId: 'Body Slam',
    hitPointLoss: 8,
    temporaryHitPointLoss: 2,
  })
  return { authority, state, event, result: reduceMoveRoundSetupEvent({ authority, state, event }) }
}

export const runBeakBlastCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const state = createMoveRoundSetupState({
    setupId: 'setup.beak-blast.1',
    canonicalMoveId: 'Beak Blast',
    actorPlacementId: 'setup-user',
    actorMaximumHitPoints: 40,
    declaredRound: 2,
    declaredTurn: 4,
    pendingPlan: roundSetupPlan(authority, 'Beak Blast'),
  })
  const event = setupHitEvent({
    eventId: 'event.beak-blast.melee-hit',
    resolutionId: 'resolution.melee-hit',
    canonicalMoveId: 'Scratch',
  })
  const handler = createMoveSetupLifecycleTriggerHandler({
    authority,
    shellTrapUserPlacementIds: [],
    attackRangesByEventId: { [event.eventId]: 'melee' },
  })
  const lifecycle = reduceEncounterLifecycle({
    ...createEmptyEncounterState(),
    turnResources: synchronizeMoveRoundSetupResources({}, state),
  }, [event], [handler])
  const observed = reduceMoveRoundSetupEvent({ authority, state, event })
  const ready = reduceMoveRoundSetupEvent({
    authority,
    state: observed.state,
    event: setupRoundEndEvent(2),
  })
  return { state, event, lifecycle, observed, ready }
}

export const runShellTrapCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const event = setupHitEvent({
    eventId: 'event.shell-trap.melee-hit',
    resolutionId: 'resolution.shell-trap-trigger',
    canonicalMoveId: 'Scratch',
  })
  return applyShellTrapReaction({
    authority,
    ledger: createMoveTriggeredReactionLedger(),
    triggeringEvent: event,
    triggeringRange: 'melee',
    reactorPlacementId: 'setup-user',
    reactionOperationId: 'reaction.shell-trap.1',
    childResolutionId: 'resolution.shell-trap.1',
  })
}

const redirectableAttackPlan = (
  authority: InterruptibleMovePlanAuthority,
): InterruptibleMovePlan => setupReactionPlan({
  authority,
  resolutionId: 'resolution.redirectable-attack.1',
  canonicalMoveId: 'Scratch',
  actorPlacementId: 'attacker',
  targetPlacementIds: ['original-target'],
  operations: [resolvedOperation(
    setupDamageOperation('redirectable-attack.damage', 'Scratch'),
    'attacker',
    ['original-target'],
  )],
})

export const runFollowMeCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const state = createMoveTargetRedirectionState({
    authority,
    canonicalMoveId: 'Follow Me',
    effectId: 'follow-me.effect.1',
    sourcePlacementId: 'redirector',
    authoritativeAreaRecipientIds: ['attacker', 'other-red', 'unknown-side'],
    createdTurn: 4,
    expiresAtSourceTurn: 6,
  })
  return {
    state,
    result: applyMoveTargetRedirection({
      authority,
      state,
      plan: redirectableAttackPlan(authority),
      applicationId: 'redirection.follow-me.1',
      redirectorWithinReach: true,
    }),
  }
}

export const runRagePowderCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const state = createMoveTargetRedirectionState({
    authority,
    canonicalMoveId: 'Rage Powder',
    effectId: 'rage-powder.effect.1',
    sourcePlacementId: 'redirector',
    authoritativeAreaRecipientIds: ['attacker', 'unknown-side'],
    createdTurn: 4,
    expiresAtSourceTurn: null,
  })
  return {
    state,
    result: applyMoveTargetRedirection({
      authority,
      state,
      plan: redirectableAttackPlan(authority),
      applicationId: 'redirection.rage-powder.1',
      redirectorWithinReach: true,
    }),
  }
}

export const runFeintCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const plan = setupReactionPlan({
    authority,
    resolutionId: 'resolution.protect.1',
    canonicalMoveId: 'Protect',
    actorPlacementId: 'redirector',
    targetPlacementIds: ['redirector'],
    targetClass: 'self',
    keywords: ['shield'],
    triggeringActionSourcePlacementId: 'attacker',
    operations: [resolvedOperation(shieldOperation(), 'redirector', ['redirector'])],
  })
  return applyReviewedMovePlanCancellation({
    authority,
    plan,
    canonicalReactionId: 'Feint',
    reactorPlacementId: 'attacker',
    reactionOperationId: 'reaction.feint.1',
  })
}

export const runPursuitCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  return applyPursuitReaction({
    authority,
    ledger: createMoveTriggeredReactionLedger(),
    triggeringEvent: setupSwitchEvent(),
    reactorPlacementId: 'attacker',
    reactionOperationId: 'reaction.pursuit.1',
    childResolutionId: 'resolution.pursuit.1',
    recalledTargetReachable: true,
  })
}

export const runDrownOutCanary = () => {
  const authority = createSetupReactionCanaryAuthority()
  const plan = setupReactionPlan({
    authority,
    resolutionId: 'resolution.chatter.1',
    canonicalMoveId: 'Chatter',
    actorPlacementId: 'attacker',
    targetPlacementIds: ['original-target'],
    keywords: ['sonic'],
    operations: [
      resolvedOperation(
        setupDamageOperation('chatter.damage', 'Chatter', 7, 'flying', 'special'),
        'attacker',
        ['original-target'],
      ),
      resolvedOperation(chatterConditionOperation(), 'attacker', ['original-target']),
    ],
  })
  return applyReviewedMovePlanCancellation({
    authority,
    plan,
    canonicalReactionId: 'Drown Out',
    reactorPlacementId: 'redirector',
    reactionOperationId: 'reaction.drown-out.1',
  })
}
