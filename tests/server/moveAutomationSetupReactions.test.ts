import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
} from '#shared/moveAutomation/events'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  INTERRUPTIBLE_MOVE_PLAN_LIMITS,
  MOVE_REDIRECTION_PRIORITY,
  MOVE_SETUP_REACTION_DEFINITION_HASH,
  MOVE_SETUP_REACTION_DEFINITIONS,
  MOVE_SETUP_REACTION_PRIORITY,
  MoveTargetRedirectionError,
  applyMoveTargetRedirection,
  applyPursuitReaction,
  applyReviewedMovePlanCancellation,
  applyShellTrapReaction,
  buildMovePlanCancellationRequestOperation,
  buildMoveTriggeredReactionRequestOperation,
  createMoveRoundSetupState,
  createMoveSetupLifecycleTriggerHandler,
  createMoveTargetRedirectionState,
  createMoveTriggeredReactionLedger,
  executeMoveRoundSetup,
  markInterruptibleMovePlanAccuracyResolved,
  reduceMoveRoundSetupEvent,
  reduceMoveTargetRedirectionEvent,
  synchronizeMoveRoundSetupResources,
} from '../../server/domain/moveAutomation/setupAndRedirectionReactions'
import { createMoveAutomationResourceResolver } from '../../server/domain/moveAutomation/resources'
import { reduceEncounterLifecycle } from '../../server/domain/moveAutomation/reduceLifecycle'
import { MOVE_SHIELD_GUARD_BREAK_PRIORITY } from '../../server/domain/moveAutomation/shieldReactionDefinitions'
import {
  SETUP_REACTION_CANARY_SCENARIO_IDS,
  createSetupReactionCanaryAuthority,
  runBeakBlastCanary,
  runDrownOutCanary,
  runFeintCanary,
  runFocusPunchCancellationCanary,
  runFollowMeCanary,
  runPursuitCanary,
  runRagePowderCanary,
  runShellTrapCanary,
  setupDamageEvent,
  setupDamageOperation,
  setupHitEvent,
  setupReactionPlan,
  setupRoundEndEvent,
  setupSwitchEvent,
} from '../fixtures/moveAutomation/setupReactions'

const eventEnvelope = (kind: string, eventId: string) => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind,
  sourceOperationId: `${eventId}.operation`,
  causalParentEventId: null,
  reasonCode: `setup-test.${kind}`,
})

describe('setup, cancellation, and redirection reaction primitives', () => {
  it('keeps one versioned reviewed definition and scenario for every canary family', () => {
    expect(MOVE_SETUP_REACTION_DEFINITIONS.map(definition => definition.canonicalId)).toEqual([
      'Focus Punch',
      'Beak Blast',
      'Shell Trap',
      'Follow Me',
      'Rage Powder',
      'Feint',
      'Pursuit',
      'Drown Out',
    ])
    expect(SETUP_REACTION_CANARY_SCENARIO_IDS).toHaveLength(8)
    expect(new Set(MOVE_SETUP_REACTION_DEFINITIONS.map(entry => entry.definitionId)).size).toBe(8)
    expect(MOVE_SETUP_REACTION_DEFINITION_HASH).toMatch(/^[a-f0-9]{64}$/)
    expect(MOVE_REDIRECTION_PRIORITY).toBeLessThan(MOVE_SETUP_REACTION_PRIORITY)
    expect(MOVE_SHIELD_GUARD_BREAK_PRIORITY).toBeGreaterThan(MOVE_SETUP_REACTION_PRIORITY)
  })

  it('cancels Focus Punch at the exact quarter-maximum-HP event before any mechanic or usage commits', () => {
    const canary = runFocusPunchCancellationCanary()

    expect(canary.result).toMatchObject({
      status: 'cancelled',
      state: {
        status: 'cancelled',
        cancellationReasonCode: 'focus-punch.cancelled-by-quarter-max-hp-hit',
        pendingPlan: {
          status: 'cancelled',
          operations: [],
          usageSpends: [],
          cancellations: [{
            cancellationKind: 'setup-threshold',
            retainTriggeringUsage: false,
            cancelledOperationIds: ['focus-punch.damage'],
            retainedUsageOperationIds: [],
            reactionUsageOperationId: null,
          }],
        },
      },
    })

    const declaredResources = synchronizeMoveRoundSetupResources({}, canary.state)
    expect(createMoveAutomationResourceResolver(declaredResources)
      .setupExecuteState('setup-user')).toMatchObject({
        canonicalMoveId: 'Focus Punch',
        status: 'setting-up',
      })
    const cancelledResources = synchronizeMoveRoundSetupResources(
      declaredResources,
      canary.result.state,
    )
    expect(createMoveAutomationResourceResolver(cancelledResources)
      .setupExecuteState('setup-user')).toBeNull()

    const duplicate = reduceMoveRoundSetupEvent({
      authority: canary.authority,
      state: canary.result.state,
      event: canary.event,
    })
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.state).toBe(canary.result.state)
  })

  it('keeps a sub-threshold Focus Punch deferred until round end, then executes the exact plan', () => {
    const canary = runFocusPunchCancellationCanary()
    const belowThreshold = setupDamageEvent({
      eventId: 'event.focus-punch.sub-threshold',
      resolutionId: 'resolution.provoking-small-hit',
      canonicalMoveId: 'Scratch',
      hitPointLoss: 9,
    })
    const observed = reduceMoveRoundSetupEvent({
      authority: canary.authority,
      state: canary.state,
      event: belowThreshold,
    })
    expect(observed).toMatchObject({
      status: 'observed',
      state: {
        status: 'setting-up',
        pendingPlan: {
          operations: [{ operation: { id: 'focus-punch.damage' } }],
          usageSpends: [{ disposition: 'triggering-move' }],
        },
      },
    })

    const ready = reduceMoveRoundSetupEvent({
      authority: canary.authority,
      state: observed.state,
      event: setupRoundEndEvent(2),
    })
    expect(ready.status).toBe('ready')
    expect(ready.state.status).toBe('ready-to-execute')
    const executed = executeMoveRoundSetup(ready.state)
    expect(executed).toMatchObject({
      status: 'executed',
      state: { status: 'executed' },
      plan: {
        status: 'pending',
        operations: [{ operation: { id: 'focus-punch.damage' } }],
        usageSpends: [{ disposition: 'triggering-move' }],
      },
    })
    expect(executeMoveRoundSetup(executed.state).status).toBe('duplicate')
  })

  it('burns a Beak Blast melee attacker from lifecycle evidence and keeps the round-end attack deferred', () => {
    const canary = runBeakBlastCanary()

    expect(canary.lifecycle.operations).toEqual([
      expect.objectContaining({
        kind: 'condition',
        source: { kind: 'lifecycle-event', id: canary.event.eventId },
        recipients: { kind: 'source-placement' },
        phase: 'hit',
        reasonCode: 'beak-blast.melee-attacker-burned',
        payload: expect.objectContaining({ conditionId: 'burned' }),
      }),
    ])
    expect(canary.observed.state.status).toBe('setting-up')
    expect(canary.ready).toMatchObject({
      status: 'ready',
      state: {
        status: 'ready-to-execute',
        pendingPlan: {
          operations: [{ operation: { id: 'beak-blast.damage' } }],
          usageSpends: [{ disposition: 'triggering-move' }],
        },
      },
    })
  })

  it('opens Shell Trap only from a melee hit fact and swaps source/target in its child', () => {
    const result = runShellTrapCanary()

    expect(result).toMatchObject({
      status: 'applied',
      application: {
        canonicalMoveId: 'Shell Trap',
        parentResolutionId: 'resolution.shell-trap-trigger',
        childResolutionId: 'resolution.shell-trap.1',
        sourcePlacementId: 'setup-user',
        targetPlacementIds: ['attacker'],
        sourceReplacement: { fromPlacementId: 'attacker', toPlacementId: 'setup-user' },
        targetReplacement: { fromPlacementId: 'setup-user', toPlacementId: 'attacker' },
        actionTiming: 'interrupt',
        usageSpend: { disposition: 'reaction', amount: 1 },
      },
      ledger: { applications: [{}], usageSpends: [{}] },
    })

    const authority = createSetupReactionCanaryAuthority()
    const event = setupHitEvent({
      eventId: 'event.shell-trap.lifecycle-window',
      resolutionId: 'resolution.shell-window-trigger',
      canonicalMoveId: 'Scratch',
    })
    const handler = createMoveSetupLifecycleTriggerHandler({
      authority,
      shellTrapUserPlacementIds: ['setup-user'],
      attackRangesByEventId: { [event.eventId]: 'melee' },
    })
    const lifecycle = reduceEncounterLifecycle(createEmptyEncounterState(), [event], [handler])
    expect(lifecycle.operations).toEqual([
      expect.objectContaining({
        kind: 'reaction-request',
        source: { kind: 'lifecycle-event', id: event.eventId },
        phase: 'hit',
        payload: expect.objectContaining({
          timing: 'post-hit',
          priority: MOVE_SETUP_REACTION_PRIORITY,
        }),
      }),
    ])

    const nonMelee = applyShellTrapReaction({
      authority,
      ledger: createMoveTriggeredReactionLedger(),
      triggeringEvent: event,
      triggeringRange: 'ranged',
      reactorPlacementId: 'setup-user',
      reactionOperationId: 'reaction.shell-trap.ranged',
      childResolutionId: 'resolution.shell-trap.ranged',
    })
    expect(nonMelee).toMatchObject({
      status: 'ineligible',
      reasonCode: 'shell-trap-not-melee',
      ledger: { applications: [], usageSpends: [] },
    })
  })

  it('redirects Follow Me before accuracy and filters unknown area recipients closed', () => {
    const canary = runFollowMeCanary()

    expect(canary.state.affectedActorPlacementIds).toEqual(['attacker', 'other-red'])
    expect(canary.result).toMatchObject({
      status: 'applied',
      plan: {
        accuracyState: 'pending',
        targetPlacementIds: ['redirector'],
        operations: [{ sourcePlacementId: 'attacker', recipientIds: ['redirector'] }],
      },
      application: {
        canonicalMoveId: 'Follow Me',
        redirectorPlacementId: 'redirector',
        requiredShift: null,
        participantReplacement: {
          targetReplacements: [{
            fromPlacementId: 'original-target',
            toPlacementId: 'redirector',
          }],
        },
      },
    })

    if (canary.result.status !== 'applied') throw new Error('Follow Me canary did not apply.')
    const duplicate = applyMoveTargetRedirection({
      authority: createSetupReactionCanaryAuthority(),
      state: canary.state,
      plan: canary.result.plan,
      applicationId: 'redirection.follow-me.1',
      redirectorWithinReach: true,
    })
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.plan).toBe(canary.result.plan)
  })

  it('requires Rage Powder reach and records its server-owned shift toward the new target', () => {
    const canary = runRagePowderCanary()

    expect(canary.state.affectedActorPlacementIds).toEqual(['attacker'])
    expect(canary.result).toMatchObject({
      status: 'applied',
      plan: {
        targetPlacementIds: ['redirector'],
        operations: [{ recipientIds: ['redirector'] }],
      },
      application: {
        canonicalMoveId: 'Rage Powder',
        requiredShift: {
          placementId: 'attacker',
          towardPlacementId: 'redirector',
          reasonCode: 'rage-powder.shift-to-source',
        },
      },
    })

    const authority = createSetupReactionCanaryAuthority()
    const unreachableState = createMoveTargetRedirectionState({
      authority,
      canonicalMoveId: 'Rage Powder',
      effectId: 'rage-powder.effect.unreachable',
      sourcePlacementId: 'redirector',
      authoritativeAreaRecipientIds: ['attacker'],
      createdTurn: 4,
      expiresAtSourceTurn: null,
    })
    const plan = setupReactionPlan({
      authority,
      resolutionId: 'resolution.rage-unreachable',
      canonicalMoveId: 'Scratch',
      actorPlacementId: 'attacker',
      targetPlacementIds: ['original-target'],
      operations: [{
        operation: setupDamageOperation('rage-unreachable.damage', 'Scratch'),
        sourcePlacementId: 'attacker',
        recipientIds: ['original-target'],
      }],
    })
    expect(applyMoveTargetRedirection({
      authority,
      state: unreachableState,
      plan,
      applicationId: 'redirection.rage-unreachable',
      redirectorWithinReach: false,
    })).toMatchObject({ status: 'ineligible', reasonCode: 'redirection-out-of-reach' })
  })

  it('rejects target changes after accuracy and expires redirection on source lifecycle facts', () => {
    const canary = runFollowMeCanary()
    const authority = createSetupReactionCanaryAuthority()
    const plan = setupReactionPlan({
      authority,
      resolutionId: 'resolution.late-redirection',
      canonicalMoveId: 'Scratch',
      actorPlacementId: 'attacker',
      targetPlacementIds: ['original-target'],
      operations: [{
        operation: setupDamageOperation('late-redirection.damage', 'Scratch'),
        sourcePlacementId: 'attacker',
        recipientIds: ['original-target'],
      }],
    })
    expect(() => applyMoveTargetRedirection({
      authority,
      state: canary.state,
      plan: markInterruptibleMovePlanAccuracyResolved(plan),
      applicationId: 'redirection.too-late',
      redirectorWithinReach: true,
    })).toThrowError(expect.objectContaining({ code: 'accuracy-already-resolved' }))

    const expired = reduceMoveTargetRedirectionEvent(canary.state, parseEncounterEvent({
      ...eventEnvelope('turn-end', 'event.redirector.turn.6.end'),
      round: 2,
      turn: 6,
      placementId: 'redirector',
      sideId: 'blue',
    }))
    expect(expired).toMatchObject({
      status: 'expired',
      affectedActorPlacementIds: [],
      expiryReasonCode: 'follow-me.source-next-turn-ended',
    })
    expect(reduceMoveTargetRedirectionEvent(expired, setupRoundEndEvent(2))).toBe(expired)
  })

  it('lets Feint cancel a shield plan before commit while retaining both reviewed usage spends once', () => {
    const first = runFeintCanary()

    expect(first).toMatchObject({
      status: 'cancelled',
      plan: {
        status: 'cancelled',
        operations: [],
        usageSpends: [
          { disposition: 'triggering-move', resourceId: 'protect.frequency-use' },
          { disposition: 'reaction', resourceId: 'feint.frequency-use' },
        ],
        cancellations: [{
          cancellationKind: 'feint',
          retainTriggeringUsage: true,
          cancelledOperationIds: ['protect.shield-effect'],
        }],
      },
    })
    if (first.status !== 'cancelled') throw new Error('Feint canary did not cancel.')
    const duplicate = applyReviewedMovePlanCancellation({
      authority: createSetupReactionCanaryAuthority(),
      plan: first.plan,
      canonicalReactionId: 'Feint',
      reactorPlacementId: 'attacker',
      reactionOperationId: 'reaction.feint.1',
    })
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.plan).toBe(first.plan)
    expect(duplicate.plan.usageSpends).toHaveLength(2)

    expect(buildMovePlanCancellationRequestOperation({
      canonicalReactionId: 'Feint',
      operationId: 'request.feint.1',
      recipients: 'actor',
    })).toMatchObject({
      phase: 'target',
      payload: { timing: 'target', priority: MOVE_SHIELD_GUARD_BREAK_PRIORITY },
    })
  })

  it('interrupts a switch with Pursuit using the recalled foe and reviewed overrides exactly once', () => {
    const first = runPursuitCanary()

    expect(first).toMatchObject({
      status: 'applied',
      application: {
        canonicalMoveId: 'Pursuit',
        sourcePlacementId: 'attacker',
        targetPlacementIds: ['original-target'],
        sourceReplacement: { fromPlacementId: 'original-target', toPlacementId: 'attacker' },
        targetReplacement: { fromPlacementId: 'sent-out', toPlacementId: 'original-target' },
        actionTiming: 'interrupt',
        damageBaseOverride: 8,
        movementSpeedBonus: 5,
      },
      ledger: { applications: [{}], usageSpends: [{ amount: 1 }] },
    })
    if (first.status !== 'applied') throw new Error('Pursuit canary did not apply.')
    const duplicate = applyPursuitReaction({
      authority: createSetupReactionCanaryAuthority(),
      ledger: first.ledger,
      triggeringEvent: setupSwitchEvent(),
      reactorPlacementId: 'attacker',
      reactionOperationId: 'reaction.pursuit.1',
      childResolutionId: 'resolution.pursuit.1',
      recalledTargetReachable: true,
    })
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.ledger).toBe(first.ledger)
    expect(duplicate.ledger.usageSpends).toHaveLength(1)

    expect(buildMoveTriggeredReactionRequestOperation({
      canonicalMoveId: 'Pursuit',
      operationId: 'request.pursuit.1',
      triggeringEventId: 'event.switch.original-target',
      recipients: 'selected-targets',
    })).toMatchObject({
      phase: 'movement',
      payload: { timing: 'switch', priority: MOVE_SETUP_REACTION_PRIORITY },
    })
  })

  it('lets Drown Out remove Chatter damage and confusion before accuracy without refunding Chatter', () => {
    const first = runDrownOutCanary()

    expect(first).toMatchObject({
      status: 'cancelled',
      reasonCode: 'drown-out.triggering-plan-cancelled',
      plan: {
        canonicalMoveId: 'Chatter',
        accuracyState: 'pending',
        status: 'cancelled',
        operations: [],
        usageSpends: [
          { disposition: 'triggering-move', resourceId: 'chatter.frequency-use' },
          { disposition: 'reaction', resourceId: 'drown-out.frequency-use' },
        ],
        cancellations: [{
          cancellationKind: 'drown-out',
          cancelledOperationIds: ['chatter.damage', 'chatter.confusion'],
          retainTriggeringUsage: true,
        }],
      },
    })
    if (first.status !== 'cancelled') throw new Error('Drown Out canary did not cancel.')
    const duplicate = applyReviewedMovePlanCancellation({
      authority: createSetupReactionCanaryAuthority(),
      plan: first.plan,
      canonicalReactionId: 'Drown Out',
      reactorPlacementId: 'redirector',
      reactionOperationId: 'reaction.drown-out.1',
    })
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.plan.usageSpends).toHaveLength(2)

    expect(buildMovePlanCancellationRequestOperation({
      canonicalReactionId: 'Drown Out',
      operationId: 'request.drown-out.1',
      recipients: 'selected-targets',
    })).toMatchObject({
      phase: 'declare',
      source: { kind: 'operation', id: 'ability.drown-out' },
      payload: { timing: 'declare', options: [{ id: 'ability.drown-out.use' }] },
    })
  })

  it('fails unknown allegiance, forged placements, and bounded inputs closed without mutation', () => {
    const authority = createSetupReactionCanaryAuthority()
    expect(() => createMoveTargetRedirectionState({
      authority,
      canonicalMoveId: 'Follow Me',
      effectId: 'follow-me.invalid-expiry',
      sourcePlacementId: 'redirector',
      authoritativeAreaRecipientIds: ['attacker'],
      createdTurn: 5,
      expiresAtSourceTurn: 5,
    })).toThrowError(expect.objectContaining({
      name: MoveTargetRedirectionError.name,
      code: 'invalid-expiry',
    }))
    expect(() => createMoveTargetRedirectionState({
      authority,
      canonicalMoveId: 'Rage Powder',
      effectId: 'rage-powder.forged',
      sourcePlacementId: 'redirector',
      authoritativeAreaRecipientIds: ['client-forged-placement'],
      createdTurn: 5,
      expiresAtSourceTurn: null,
    })).toThrowError(expect.objectContaining({ code: 'placement-not-found' }))

    const oversized = Array.from(
      { length: INTERRUPTIBLE_MOVE_PLAN_LIMITS.placements + 1 },
      (_, index) => `placement-${index}`,
    )
    expect(() => createMoveTargetRedirectionState({
      authority,
      canonicalMoveId: 'Rage Powder',
      effectId: 'rage-powder.oversized',
      sourcePlacementId: 'redirector',
      authoritativeAreaRecipientIds: oversized,
      createdTurn: 5,
      expiresAtSourceTurn: null,
    })).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }))
  })
})
