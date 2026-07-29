import {
  parseEncounterEffects,
  type EncounterCapabilityEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { MovementSemiInvulnerableState } from '~/types/movement'
import type {
  MoveSemiInvulnerableEffectRole,
  MoveSemiInvulnerableFamilyId,
  MoveSemiInvulnerableTargetingException,
  MoveSemiInvulnerableTargetingTiming,
} from './semiInvulnerableDefinitions'
import {
  activeMoveSemiInvulnerableEffectsForPlacement,
  moveSemiInvulnerableEffectRole,
  moveSemiInvulnerableStateForEffect,
  tryMoveSemiInvulnerableSetupGroup,
  type MoveSemiInvulnerableSetupGroup,
} from './semiInvulnerableEffects'
import {
  assertMoveSemiInvulnerableCanonicalText,
  deepFreezeMoveSemiInvulnerable,
  failMoveSemiInvulnerableSetup,
} from './semiInvulnerableSupport'

export interface MoveSemiInvulnerableTargetabilityInput {
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly attackingMoveId: string
  readonly timing?: MoveSemiInvulnerableTargetingTiming
  /** Present only while resuming this exact server-owned setup continuation. */
  readonly originatingSetupOperationId?: string | null
}

export type MoveSemiInvulnerableTargetabilityReasonCode =
  | 'targetable-normal-state'
  | 'target-excluded-capability-mode'
  | 'targetable-originating-resolution'
  | 'targetable-reviewed-exception'
  | 'target-excluded-semi-invulnerable'
  | 'target-excluded-malformed-semi-invulnerable-state'

export interface MoveSemiInvulnerableTargetabilityResult {
  readonly targetable: boolean
  readonly reasonCode: MoveSemiInvulnerableTargetabilityReasonCode
  readonly targetPlacementId: string
  readonly state: MovementSemiInvulnerableState
  readonly setupOperationId: string | null
  readonly familyId: MoveSemiInvulnerableFamilyId | null
  readonly role: MoveSemiInvulnerableEffectRole | null
  readonly exception: MoveSemiInvulnerableTargetingException | null
}

export type MoveSemiInvulnerableActionReasonCode =
  | 'action-available-normal-state'
  | 'action-blocked-capability-mode'
  | 'action-available-setup-resolution'
  | 'action-blocked-awaiting-setup-resolution'
  | 'action-blocked-carried-target'
  | 'action-blocked-malformed-semi-invulnerable-state'

export interface MoveSemiInvulnerableActionResult {
  readonly available: boolean
  readonly reasonCode: MoveSemiInvulnerableActionReasonCode
  readonly state: MovementSemiInvulnerableState
  readonly setupOperationId: string | null
  readonly familyId: MoveSemiInvulnerableFamilyId | null
}

export interface MoveSemiInvulnerableTargetabilityResolver {
  resolve(input: MoveSemiInvulnerableTargetabilityInput): MoveSemiInvulnerableTargetabilityResult
  resolveAction(input: {
    readonly actorPlacementId: string
    readonly moveCanonicalId: string
    readonly originatingSetupOperationId?: string | null
  }): MoveSemiInvulnerableActionResult
}

const normalizedMoveId = (value: string): string => value.trim().toLowerCase()

const effectForTarget = (
  effects: readonly EncounterEffect[],
  targetPlacementId: string,
): EncounterCapabilityEffect | null | 'ambiguous' => {
  const candidates = activeMoveSemiInvulnerableEffectsForPlacement(
    effects,
    targetPlacementId,
  )
  if (candidates.length === 0) return null
  return candidates.length === 1 ? candidates[0]! : 'ambiguous'
}

const setupGroupForEffect = (
  effects: readonly EncounterEffect[],
  effect: EncounterCapabilityEffect,
): MoveSemiInvulnerableSetupGroup | null => tryMoveSemiInvulnerableSetupGroup(
  effects,
  effect.source.operationId,
)

const malformedState = (
  effects: readonly EncounterEffect[],
  targetPlacementId: string,
): MovementSemiInvulnerableState => {
  const first = activeMoveSemiInvulnerableEffectsForPlacement(effects, targetPlacementId)[0]
  return first ? moveSemiInvulnerableStateForEffect(first) ?? 'phased' : 'phased'
}

const blockedMalformedTargetability = (
  targetPlacementId: string,
  state: MovementSemiInvulnerableState,
): MoveSemiInvulnerableTargetabilityResult => deepFreezeMoveSemiInvulnerable({
  targetable: false,
  reasonCode: 'target-excluded-malformed-semi-invulnerable-state' as const,
  targetPlacementId,
  state,
  setupOperationId: null,
  familyId: null,
  role: null,
  exception: null,
})

const normalTargetability = (
  targetPlacementId: string,
): MoveSemiInvulnerableTargetabilityResult => deepFreezeMoveSemiInvulnerable({
  targetable: true,
  reasonCode: 'targetable-normal-state' as const,
  targetPlacementId,
  state: 'none' as const,
  setupOperationId: null,
  familyId: null,
  role: null,
  exception: null,
})

const malformedAction = (
  state: MovementSemiInvulnerableState,
): MoveSemiInvulnerableActionResult => deepFreezeMoveSemiInvulnerable({
  available: false,
  reasonCode: 'action-blocked-malformed-semi-invulnerable-state' as const,
  state,
  setupOperationId: null,
  familyId: null,
})

/** Build immutable target/action queries over one authoritative effect snapshot. */
export const createMoveSemiInvulnerableTargetabilityResolver = (input: {
  readonly effects: readonly EncounterEffect[]
  /** Effective map-owned Capability modes keyed by authoritative placement ID. */
  readonly capabilityModesByPlacement?: ReadonlyMap<string, ReadonlySet<string>>
  /** Mount/fusion participants removed from independent play by source text. */
  readonly capabilityCarriedPlacementIds?: ReadonlySet<string>
  /** Participants forbidden from independent actions by a Capability state. */
  readonly capabilityActionBlockedPlacementIds?: ReadonlySet<string>
  /** Illusionist animation may reserve the user's Standard or Swift Action. */
  readonly capabilityReservedStandardActionPlacementIds?: ReadonlySet<string>
  readonly capabilityReservedSwiftActionPlacementIds?: ReadonlySet<string>
  /** Reviewed Move range metadata determines whether a mode blocks this action. */
  readonly actionTypeForMove?: (moveCanonicalId: string) => 'standard' | 'shift' | 'swift' | 'free' | 'full' | 'interrupt' | 'reaction'
  /** Wired Rotom may use only the GM-selected machine Move while inside it. */
  readonly capabilityAllowedMoveByPlacement?: ReadonlyMap<string, string>
}): MoveSemiInvulnerableTargetabilityResolver => {
  const effects = parseEncounterEffects(
    input.effects,
    'semiInvulnerable.targetability.effects',
  )

  const resolve = (
    query: MoveSemiInvulnerableTargetabilityInput,
  ): MoveSemiInvulnerableTargetabilityResult => {
    const targetPlacementId = assertMoveSemiInvulnerableCanonicalText(
      query.targetPlacementId,
      'Target placement ID',
    )
    assertMoveSemiInvulnerableCanonicalText(query.actorPlacementId, 'Actor placement ID')
    const attackingMoveId = assertMoveSemiInvulnerableCanonicalText(
      query.attackingMoveId,
      'Attacking move ID',
    )
    const timing = query.timing ?? 'ordinary'
    if (timing !== 'ordinary' && timing !== 'interrupt') {
      return failMoveSemiInvulnerableSetup(
        'invalid-setup',
        'Semi-invulnerable targeting timing is invalid.',
      )
    }

    if (input.capabilityCarriedPlacementIds?.has(targetPlacementId)) {
      return deepFreezeMoveSemiInvulnerable({
        targetable: false,
        reasonCode: 'target-excluded-capability-mode' as const,
        targetPlacementId,
        state: 'carried' as const,
        setupOperationId: null,
        familyId: null,
        role: null,
        exception: null,
      })
    }
    const targetCapabilityModes = input.capabilityModesByPlacement?.get(targetPlacementId)
    if (targetCapabilityModes?.has('intangible') || targetCapabilityModes?.has('inside-machine')) {
      return deepFreezeMoveSemiInvulnerable({
        targetable: false,
        reasonCode: 'target-excluded-capability-mode' as const,
        targetPlacementId,
        state: targetCapabilityModes.has('intangible') ? 'phased' as const : 'carried' as const,
        setupOperationId: null,
        familyId: null,
        role: null,
        exception: null,
      })
    }
    const targetEffect = effectForTarget(effects, targetPlacementId)
    if (targetEffect === null) return normalTargetability(targetPlacementId)
    if (targetEffect === 'ambiguous') {
      return blockedMalformedTargetability(
        targetPlacementId,
        malformedState(effects, targetPlacementId),
      )
    }
    const state = moveSemiInvulnerableStateForEffect(targetEffect) ?? 'phased'
    const group = setupGroupForEffect(effects, targetEffect)
    const role = group ? moveSemiInvulnerableEffectRole(group, targetEffect.id) : null
    if (!group || !role) return blockedMalformedTargetability(targetPlacementId, state)

    if (
      query.originatingSetupOperationId === group.setupOperationId
      && normalizedMoveId(attackingMoveId) === normalizedMoveId(group.definition.canonicalId)
    ) {
      return deepFreezeMoveSemiInvulnerable({
        targetable: true,
        reasonCode: 'targetable-originating-resolution' as const,
        targetPlacementId,
        state,
        setupOperationId: group.setupOperationId,
        familyId: group.definition.familyId,
        role,
        exception: null,
      })
    }

    const exceptions = role === 'user'
      ? group.definition.userTargetingExceptions
      : group.definition.carriedTargetingExceptions
    const reviewedException = exceptions.find(entry => (
      normalizedMoveId(entry.canonicalMoveId) === normalizedMoveId(attackingMoveId)
      && entry.timing === timing
    )) ?? null
    return deepFreezeMoveSemiInvulnerable({
      targetable: reviewedException !== null,
      reasonCode: reviewedException
        ? 'targetable-reviewed-exception' as const
        : 'target-excluded-semi-invulnerable' as const,
      targetPlacementId,
      state,
      setupOperationId: group.setupOperationId,
      familyId: group.definition.familyId,
      role,
      exception: reviewedException,
    })
  }

  const resolveAction: MoveSemiInvulnerableTargetabilityResolver['resolveAction'] = (query) => {
    const actorPlacementId = assertMoveSemiInvulnerableCanonicalText(
      query.actorPlacementId,
      'Action actor placement ID',
    )
    const moveCanonicalId = assertMoveSemiInvulnerableCanonicalText(
      query.moveCanonicalId,
      'Action move canonical ID',
    )
    if (input.capabilityCarriedPlacementIds?.has(actorPlacementId)
      || input.capabilityActionBlockedPlacementIds?.has(actorPlacementId)) {
      return deepFreezeMoveSemiInvulnerable({
        available: false,
        reasonCode: 'action-blocked-capability-mode' as const,
        state: 'carried' as const,
        setupOperationId: null,
        familyId: null,
      })
    }
    const capabilityModes = input.capabilityModesByPlacement?.get(actorPlacementId)
    const wiredAllowedMove = input.capabilityAllowedMoveByPlacement?.get(actorPlacementId)
    const wiredMoveAllowed = capabilityModes?.has('inside-machine') === true
      && wiredAllowedMove !== undefined
      && normalizedMoveId(wiredAllowedMove) === normalizedMoveId(moveCanonicalId)
    const actionType = input.actionTypeForMove?.(moveCanonicalId) ?? 'standard'
    const standardBlocked = (actionType === 'standard' || actionType === 'full') && (
      capabilityModes?.has('intangible') === true
      || capabilityModes?.has('shrunken') === true
      || capabilityModes?.has('shadow-melded') === true
      || input.capabilityReservedStandardActionPlacementIds?.has(actorPlacementId) === true
    )
    const swiftBlocked = actionType === 'swift'
      && input.capabilityReservedSwiftActionPlacementIds?.has(actorPlacementId) === true
    if (standardBlocked || swiftBlocked || capabilityModes?.has('invisible')
      || (capabilityModes?.has('inside-machine') && !wiredMoveAllowed)) {
      return deepFreezeMoveSemiInvulnerable({
        available: false,
        reasonCode: 'action-blocked-capability-mode' as const,
        state: capabilityModes?.has('intangible') === true ? 'phased' as const : 'none' as const,
        setupOperationId: null,
        familyId: null,
      })
    }
    const actorEffect = effectForTarget(effects, actorPlacementId)
    if (actorEffect === null) {
      return deepFreezeMoveSemiInvulnerable({
        available: true,
        reasonCode: 'action-available-normal-state' as const,
        state: 'none' as const,
        setupOperationId: null,
        familyId: null,
      })
    }
    if (actorEffect === 'ambiguous') {
      return malformedAction(malformedState(effects, actorPlacementId))
    }
    const state = moveSemiInvulnerableStateForEffect(actorEffect) ?? 'phased'
    const group = setupGroupForEffect(effects, actorEffect)
    const role = group ? moveSemiInvulnerableEffectRole(group, actorEffect.id) : null
    if (!group || !role) return malformedAction(state)
    if (role === 'carried-target') {
      return deepFreezeMoveSemiInvulnerable({
        available: false,
        reasonCode: 'action-blocked-carried-target' as const,
        state,
        setupOperationId: group.setupOperationId,
        familyId: group.definition.familyId,
      })
    }
    const isResolution = query.originatingSetupOperationId === group.setupOperationId
      && normalizedMoveId(moveCanonicalId) === normalizedMoveId(group.definition.canonicalId)
    return deepFreezeMoveSemiInvulnerable({
      available: isResolution,
      reasonCode: isResolution
        ? 'action-available-setup-resolution' as const
        : 'action-blocked-awaiting-setup-resolution' as const,
      state,
      setupOperationId: group.setupOperationId,
      familyId: group.definition.familyId,
    })
  }

  return Object.freeze({ resolve, resolveAction })
}
