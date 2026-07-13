import {
  ENCOUNTER_EVENT_LIMITS,
  parseEncounterEvent,
  type EncounterEvent,
} from '#shared/moveAutomation/events'
import {
  assertMovePlanPlacement,
  assertMovePlanStableId,
  canonicalMovePlanPlacementIds,
  deepFreezeInterruptibleMovePlan,
  replaceInterruptibleMovePlanParticipants,
  type InterruptibleMovePlan,
  type InterruptibleMovePlanAuthority,
  type MovePlanParticipantReplacementApplication,
} from './interruptibleMovePlan'
import {
  moveSetupReactionDefinition,
  type MoveTargetRedirectionReactionDefinition,
} from './setupReactionDefinitions'

export interface MoveTargetRedirectionState {
  readonly effectId: string
  readonly canonicalMoveId: MoveTargetRedirectionReactionDefinition['canonicalId']
  readonly definitionId: string
  readonly sourcePlacementId: string
  /** Geometry-first, relationship-filtered actors compelled by this effect. */
  readonly affectedActorPlacementIds: readonly string[]
  readonly createdTurn: number
  /** Required for Follow Me; Rage Powder ends only through source/scene cleanup. */
  readonly expiresAtSourceTurn: number | null
  readonly status: 'active' | 'expired'
  readonly expiryReasonCode: string | null
}

export interface MoveRedirectionRequiredShift {
  readonly placementId: string
  readonly towardPlacementId: string
  readonly reasonCode: 'rage-powder.shift-to-source'
}

export interface MoveTargetRedirectionApplication {
  readonly effectId: string
  readonly canonicalMoveId: MoveTargetRedirectionReactionDefinition['canonicalId']
  readonly actorPlacementId: string
  readonly redirectorPlacementId: string
  readonly participantReplacement: MovePlanParticipantReplacementApplication
  readonly requiredShift: MoveRedirectionRequiredShift | null
  readonly reasonCode: string
}

export type ApplyMoveTargetRedirectionResult =
  | {
      readonly status: 'applied' | 'duplicate'
      readonly reasonCode: string
      readonly plan: InterruptibleMovePlan
      readonly application: MoveTargetRedirectionApplication
    }
  | {
      readonly status: 'ineligible'
      readonly reasonCode:
        | 'redirection-effect-inactive'
        | 'redirection-actor-unaffected'
        | 'redirection-actor-not-enemy'
        | 'redirection-target-class-mismatch'
        | 'redirection-target-change-blocked'
        | 'redirection-out-of-reach'
        | 'redirection-no-opponent-target'
        | 'redirection-already-targeted'
      readonly plan: InterruptibleMovePlan
      readonly application: null
    }

export type MoveTargetRedirectionErrorCode =
  | 'invalid-redirection'
  | 'invalid-expiry'

export class MoveTargetRedirectionError extends Error {
  readonly code: MoveTargetRedirectionErrorCode

  constructor(code: MoveTargetRedirectionErrorCode, message: string) {
    super(message)
    this.name = 'MoveTargetRedirectionError'
    this.code = code
  }
}

const fail = (code: MoveTargetRedirectionErrorCode, message: string): never => {
  throw new MoveTargetRedirectionError(code, message)
}

/**
 * Materialize one redirection effect from server-produced area recipients.
 * The geometry seam has already run; this function can only remove candidates
 * whose explicit relationship is not enemy.
 */
export const createMoveTargetRedirectionState = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly canonicalMoveId: MoveTargetRedirectionReactionDefinition['canonicalId']
  readonly effectId: string
  readonly sourcePlacementId: string
  readonly authoritativeAreaRecipientIds: readonly string[]
  readonly createdTurn: number
  readonly expiresAtSourceTurn: number | null
}): MoveTargetRedirectionState => {
  const definition = moveSetupReactionDefinition(input.canonicalMoveId)
  if (definition.family !== 'target-redirection') {
    return fail('invalid-redirection', `${input.canonicalMoveId} is not a redirection definition.`)
  }
  const sourcePlacementId = assertMovePlanPlacement(
    input.authority,
    input.sourcePlacementId,
    'Redirection source',
  )
  if (
    !Number.isSafeInteger(input.createdTurn)
    || input.createdTurn < 0
    || input.createdTurn > ENCOUNTER_EVENT_LIMITS.turn
  ) {
    return fail('invalid-expiry', 'Redirection created turn must be a bounded integer.')
  }
  if (definition.expiry === 'source-next-turn-or-leaves') {
    if (
      !Number.isSafeInteger(input.expiresAtSourceTurn)
      || Number(input.expiresAtSourceTurn) <= input.createdTurn
      || Number(input.expiresAtSourceTurn) > ENCOUNTER_EVENT_LIMITS.turn
    ) {
      return fail(
        'invalid-expiry',
        'Follow Me requires a bounded future source-turn expiry.',
      )
    }
  }
  else if (input.expiresAtSourceTurn !== null) {
    return fail('invalid-expiry', 'Rage Powder cannot declare a turn expiry.')
  }
  const areaRecipients = canonicalMovePlanPlacementIds(
    input.authority,
    input.authoritativeAreaRecipientIds,
    'Authoritative redirection area recipients',
  )
  const affectedActorPlacementIds = areaRecipients.filter(placementId => (
    input.authority.relationships.resolve(sourcePlacementId, placementId).relationship
    === definition.affectedActorRelation
  ))
  return deepFreezeInterruptibleMovePlan({
    effectId: assertMovePlanStableId(input.effectId, 'Redirection effect ID'),
    canonicalMoveId: definition.canonicalId,
    definitionId: definition.definitionId,
    sourcePlacementId,
    affectedActorPlacementIds,
    createdTurn: input.createdTurn,
    expiresAtSourceTurn: input.expiresAtSourceTurn,
    status: 'active' as const,
    expiryReasonCode: null,
  })
}

const ineligible = (
  plan: InterruptibleMovePlan,
  reasonCode: Extract<ApplyMoveTargetRedirectionResult, { status: 'ineligible' }>['reasonCode'],
): ApplyMoveTargetRedirectionResult => Object.freeze({
  status: 'ineligible',
  reasonCode,
  plan,
  application: null,
})

/** Redirect opponent targets before accuracy and update every resolved recipient projection. */
export const applyMoveTargetRedirection = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly state: MoveTargetRedirectionState
  readonly plan: InterruptibleMovePlan
  readonly applicationId: string
  /** Server movement/range query; Rage Powder fails closed when false. */
  readonly redirectorWithinReach: boolean
}): ApplyMoveTargetRedirectionResult => {
  const definition = moveSetupReactionDefinition(input.state.canonicalMoveId)
  if (definition.family !== 'target-redirection') {
    return fail('invalid-redirection', 'Redirection state references the wrong definition family.')
  }
  if (input.state.status !== 'active') {
    return ineligible(input.plan, 'redirection-effect-inactive')
  }
  const existingReplacement = input.plan.participantReplacements.find(
    application => application.applicationId === input.applicationId,
  )
  if (existingReplacement) {
    const expectedReason = `${definition.definitionId}.target-redirected-before-accuracy`
    if (
      existingReplacement.reasonCode !== expectedReason
      || existingReplacement.targetReplacements.some(
        replacement => replacement.toPlacementId !== input.state.sourcePlacementId,
      )
    ) {
      return fail(
        'invalid-redirection',
        `Redirection application ${input.applicationId} changed on replay.`,
      )
    }
    const requiredShift: MoveRedirectionRequiredShift | null = definition.requiresShiftTowardRedirector
      ? Object.freeze({
          placementId: input.plan.actorPlacementId,
          towardPlacementId: input.state.sourcePlacementId,
          reasonCode: 'rage-powder.shift-to-source' as const,
        })
      : null
    const application: MoveTargetRedirectionApplication = deepFreezeInterruptibleMovePlan({
      effectId: input.state.effectId,
      canonicalMoveId: definition.canonicalId,
      actorPlacementId: input.plan.actorPlacementId,
      redirectorPlacementId: input.state.sourcePlacementId,
      participantReplacement: existingReplacement,
      requiredShift,
      reasonCode: expectedReason,
    })
    return Object.freeze({
      status: 'duplicate',
      reasonCode: expectedReason,
      plan: input.plan,
      application,
    })
  }
  if (!input.state.affectedActorPlacementIds.includes(input.plan.actorPlacementId)) {
    return ineligible(input.plan, 'redirection-actor-unaffected')
  }
  if (
    input.authority.relationships.resolve(
      input.state.sourcePlacementId,
      input.plan.actorPlacementId,
    ).relationship !== 'enemy'
  ) {
    return ineligible(input.plan, 'redirection-actor-not-enemy')
  }
  if (input.plan.targetClass !== definition.moveTargetClass) {
    return ineligible(input.plan, 'redirection-target-class-mismatch')
  }
  if (!input.plan.targetRedirectionAllowed) {
    return ineligible(input.plan, 'redirection-target-change-blocked')
  }
  if (definition.requiresRedirectorInReach && !input.redirectorWithinReach) {
    return ineligible(input.plan, 'redirection-out-of-reach')
  }
  const opponentTargets = input.plan.targetPlacementIds.filter(targetPlacementId => (
    input.authority.relationships.resolve(
      input.plan.actorPlacementId,
      targetPlacementId,
    ).relationship === 'enemy'
  ))
  if (opponentTargets.length === 0) {
    return ineligible(input.plan, 'redirection-no-opponent-target')
  }
  if (
    opponentTargets.length === 1
    && opponentTargets[0] === input.state.sourcePlacementId
    && input.plan.targetPlacementIds.length === 1
  ) {
    return ineligible(input.plan, 'redirection-already-targeted')
  }
  const replacement = replaceInterruptibleMovePlanParticipants({
    authority: input.authority,
    plan: input.plan,
    applicationId: input.applicationId,
    reasonCode: `${definition.definitionId}.target-redirected-before-accuracy`,
    targetReplacements: opponentTargets
      .filter(targetPlacementId => targetPlacementId !== input.state.sourcePlacementId)
      .map(targetPlacementId => ({
        fromPlacementId: targetPlacementId,
        toPlacementId: input.state.sourcePlacementId,
      })),
  })
  if (replacement.status === 'unchanged') {
    return ineligible(input.plan, 'redirection-already-targeted')
  }
  const requiredShift: MoveRedirectionRequiredShift | null = definition.requiresShiftTowardRedirector
    ? Object.freeze({
        placementId: input.plan.actorPlacementId,
        towardPlacementId: input.state.sourcePlacementId,
        reasonCode: 'rage-powder.shift-to-source' as const,
      })
    : null
  const application: MoveTargetRedirectionApplication = deepFreezeInterruptibleMovePlan({
    effectId: input.state.effectId,
    canonicalMoveId: definition.canonicalId,
    actorPlacementId: input.plan.actorPlacementId,
    redirectorPlacementId: input.state.sourcePlacementId,
    participantReplacement: replacement.application,
    requiredShift,
    reasonCode: `${definition.definitionId}.target-redirected-before-accuracy`,
  })
  return Object.freeze({
    status: replacement.status,
    reasonCode: application.reasonCode,
    plan: replacement.plan,
    application,
  })
}

const sourceLeaves = (
  state: MoveTargetRedirectionState,
  event: EncounterEvent,
): boolean => (
  event.kind === 'scene-end'
  || (event.kind === 'move-ko' && event.targetPlacementId === state.sourcePlacementId)
  || (event.kind === 'recall' && event.placementId === state.sourcePlacementId)
  || (event.kind === 'switch' && event.recalledPlacementId === state.sourcePlacementId)
)

const affectedActorLeaves = (
  placementId: string,
  event: EncounterEvent,
): boolean => (
  (event.kind === 'move-ko' && event.targetPlacementId === placementId)
  || (event.kind === 'recall' && event.placementId === placementId)
  || (event.kind === 'switch' && event.recalledPlacementId === placementId)
)

/** Expire/cure redirection state from authoritative turn, KO, recall, switch, or scene facts. */
export const reduceMoveTargetRedirectionEvent = (
  state: MoveTargetRedirectionState,
  eventValue: EncounterEvent,
): MoveTargetRedirectionState => {
  if (state.status === 'expired') return state
  const event = parseEncounterEvent(eventValue, 'targetRedirection.event')
  const definition = moveSetupReactionDefinition(state.canonicalMoveId)
  if (sourceLeaves(state, event)) {
    return deepFreezeInterruptibleMovePlan({
      ...state,
      status: 'expired' as const,
      affectedActorPlacementIds: [],
      expiryReasonCode: `${definition.definitionId}.source-left`,
    })
  }
  if (
    definition.expiry === 'source-next-turn-or-leaves'
    && event.kind === 'turn-end'
    && event.placementId === state.sourcePlacementId
    && state.expiresAtSourceTurn !== null
    && event.turn >= state.expiresAtSourceTurn
  ) {
    return deepFreezeInterruptibleMovePlan({
      ...state,
      status: 'expired' as const,
      affectedActorPlacementIds: [],
      expiryReasonCode: 'follow-me.source-next-turn-ended',
    })
  }
  const remaining = state.affectedActorPlacementIds.filter(
    placementId => !affectedActorLeaves(placementId, event),
  )
  if (remaining.length === state.affectedActorPlacementIds.length) return state
  return deepFreezeInterruptibleMovePlan({
    ...state,
    affectedActorPlacementIds: remaining,
    status: remaining.length === 0 ? 'expired' as const : 'active' as const,
    expiryReasonCode: remaining.length === 0
      ? `${definition.definitionId}.no-affected-actors`
      : null,
  })
}
