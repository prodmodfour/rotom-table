import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import type { AbilitySubscriptionRoute } from '../../server/domain/abilityAutomation/subscriptionRouter'
import {
  AbilityReactionError,
  arbitrateAbilityReactionCandidates,
  createAbilityReactionCandidate,
  orderAbilityReactionCandidates,
  planAbilityReactionAvailabilitySpend,
} from '../../server/domain/abilityAutomation/reactions'
import {
  ABILITY_REACTION_PASS_SEMANTICS,
  abilityReactionCheckpointDefinition,
} from '#shared/abilityAutomation/reactions'
import {
  advanceAbilityReactionAvailabilityRound,
  createEmptyAbilityReactionAvailabilityLedger,
} from '#shared/abilityAutomation/reactionResources'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const HASH = 'a'.repeat(64)
const route = (input: {
  id: string
  canonicalId: string
  owner?: string
  priority?: number
  eventId?: string
  checkpoint?: 'pre-effect' | 'after-commit'
}): AbilitySubscriptionRoute => ({
  routeId: input.id,
  eventId: input.eventId ?? 'event.one',
  checkpoint: input.checkpoint ?? 'pre-effect',
  ownerPlacementId: input.owner ?? 'owner-token',
  abilityInstanceId: `base:${input.owner ?? 'owner-token'}:${input.canonicalId.toLowerCase()}`,
  canonicalId: input.canonicalId,
  modeId: 'mode-triggered',
  subscriptionId: 'subscription-react',
  priority: input.priority ?? 0,
  response: 'optional',
  oncePerCausalChain: true,
  runtimeVersion: 1,
  definitionHash: HASH,
  sourceModule: 'server/domain/abilityAutomation/specs/reaction.ts',
})
const candidate = (input: Parameters<typeof route>[0] & { timing: 'interrupt' | 'reaction' }) => (
  createAbilityReactionCandidate({
    windowId: `window.${input.id}`,
    route: route(input),
    actionVariant: {
      id: 'react', cost: 'free', timing: input.timing,
      availabilityPool: 'interrupt-reaction',
    },
  })
)
const cursor = (roundSequence = 1) => ({
  sceneId: 'scene.one', roundId: `round.${roundSequence}`, roundSequence,
})
const context = (encounterState = createEmptyEncounterState()): AuthoritativeAbilityContext => ({
  runtime: { canonicalId: 'Sample' },
  actor: { placement: { id: 'owner-token' }, effectiveAbilities: [] },
  map: { slug: 'reaction-arena', revision: 7, encounterState },
} as unknown as AuthoritativeAbilityContext)
const currentEncounter = (result: ReturnType<typeof planAbilityReactionAvailabilitySpend>) => (
  result.plan.changes[0]!.current as ReturnType<typeof createEmptyEncounterState>
)

describe('ability Interrupt/Reaction timing and arbitration', () => {
  it('binds checkpoints to exact phases and disclosure maxima', () => {
    expect(abilityReactionCheckpointDefinition('pre-effect')).toMatchObject({
      phase: 'pre-effect', interruptPosition: 'before-checkpoint', reactionPosition: 'after-checkpoint',
    })
    expect(abilityReactionCheckpointDefinition('after-commit').revealedInformation)
      .toContain('accepted-outcome')
  })

  it('orders Interrupts before Reactions, then priority and stable source identity', () => {
    const ordered = orderAbilityReactionCandidates([
      candidate({ id: 'reaction-high', canonicalId: 'Zulu', priority: 100, timing: 'reaction' }),
      candidate({ id: 'interrupt-z', canonicalId: 'Zulu', priority: 5, timing: 'interrupt' }),
      candidate({ id: 'interrupt-a', canonicalId: 'Alpha', priority: 5, timing: 'interrupt' }),
    ])
    expect(ordered.map(value => value.windowId)).toEqual([
      'window.interrupt-a', 'window.interrupt-z', 'window.reaction-high',
    ])
    expect(() => orderAbilityReactionCandidates([
      candidate({ id: 'one', canonicalId: 'Alpha', timing: 'reaction' }),
      candidate({ id: 'two', canonicalId: 'Beta', timing: 'reaction', eventId: 'event.two' }),
    ])).toThrowError(AbilityReactionError)
  })

  it('accepts only optional reactive variants using the shared availability pool', () => {
    expect(() => createAbilityReactionCandidate({
      windowId: 'window.invalid',
      route: route({ id: 'invalid', canonicalId: 'Alpha' }),
      actionVariant: { id: 'use', cost: 'free', timing: 'normal', availabilityPool: null },
    })).toThrowError(AbilityReactionError)
  })

  it('arbitrates only owners whose shared round availability remains ready', () => {
    const empty = advanceAbilityReactionAvailabilityRound(
      createEmptyAbilityReactionAvailabilityLedger(),
      cursor(),
    )
    const spent = {
      ...empty,
      entries: [{
        ownerPlacementId: 'spent-token',
        pool: 'interrupt-reaction' as const,
        spentByOperationId: 'operation.spent',
      }],
    }
    const result = arbitrateAbilityReactionCandidates({
      candidates: [
        candidate({ id: 'ready', canonicalId: 'Alpha', timing: 'reaction' }),
        candidate({ id: 'spent', canonicalId: 'Beta', owner: 'spent-token', timing: 'reaction', priority: 50 }),
      ],
      availabilityLedger: spent,
    })
    expect(result.next?.windowId).toBe('window.ready')
    expect(result.unavailableWindowIds).toEqual(['window.spent'])
  })

  it('spends Interrupt and Reaction from one owner-wide pool with exact retries', () => {
    const first = planAbilityReactionAvailabilitySpend({
      context: context(), cursor: cursor(), ownerPlacementId: 'owner-token',
      operationId: 'operation.react-one',
    })
    expect(first.status).toBe('spent')
    expect(currentEncounter(first).abilityReactionAvailability).toMatchObject({
      sceneId: 'scene.one', roundId: 'round.1',
      entries: [{ ownerPlacementId: 'owner-token', pool: 'interrupt-reaction' }],
    })
    const retry = planAbilityReactionAvailabilitySpend({
      context: context(currentEncounter(first)), cursor: cursor(), ownerPlacementId: 'owner-token',
      operationId: 'operation.react-one',
    })
    expect(retry).toMatchObject({ status: 'duplicate' })
    expect(retry.plan.changes).toEqual([])
    expect(() => planAbilityReactionAvailabilitySpend({
      context: context(currentEncounter(first)), cursor: cursor(), ownerPlacementId: 'owner-token',
      operationId: 'operation.react-two',
    })).toThrowError(/already spent/)
  })

  it('resets availability only at a monotonic round boundary and pass spends nothing', () => {
    const first = planAbilityReactionAvailabilitySpend({
      context: context(), cursor: cursor(), ownerPlacementId: 'owner-token',
      operationId: 'operation.react-one',
    })
    const second = planAbilityReactionAvailabilitySpend({
      context: context(currentEncounter(first)), cursor: cursor(2), ownerPlacementId: 'owner-token',
      operationId: 'operation.react-two',
    })
    expect(second.status).toBe('spent')
    expect(currentEncounter(second).abilityReactionAvailability?.entries).toHaveLength(1)
    expect(ABILITY_REACTION_PASS_SEMANTICS).toMatchObject({
      consumesAvailability: false, resumesAtNextPriority: true,
    })
  })
})
