import { describe, expect, it } from 'vitest'
import {
  normalizeAttackOfOpportunityTriggerPayload,
} from '#shared/attackOfOpportunityState'

describe('Attack of Opportunity trigger intent', () => {
  it('accepts bounded movement and ranged trigger facts', () => {
    expect(normalizeAttackOfOpportunityTriggerPayload({
      action: 'provoke',
      reason: 'movement',
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })).toEqual({
      action: 'provoke',
      reason: 'movement',
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })
    expect(normalizeAttackOfOpportunityTriggerPayload({
      action: 'provoke',
      reason: 'ranged-attack',
      provokerId: 'provoker',
      targetIds: ['target-a', 'target-b'],
    })).toEqual({
      action: 'provoke',
      reason: 'ranged-attack',
      provokerId: 'provoker',
      targetIds: ['target-a', 'target-b'],
    })
  })

  it('rejects client-authored prompt identities, candidates, options, and mechanics', () => {
    expect(normalizeAttackOfOpportunityTriggerPayload({
      action: 'provoke',
      reason: 'ranged-attack',
      provokerId: 'provoker',
      targetIds: ['target'],
      promptId: 'client-prompt',
    })).toBeNull()
    expect(normalizeAttackOfOpportunityTriggerPayload({
      action: 'queue',
      records: [{
        id: 'client-prompt',
        attackerId: 'attacker',
        moveName: 'Struggle',
        damage: 999,
      }],
    })).toBeNull()
    expect(normalizeAttackOfOpportunityTriggerPayload({
      action: 'provoke',
      reason: 'ranged-attack',
      provokerId: 'provoker',
      targetIds: ['duplicate', 'duplicate'],
    })).toBeNull()
  })
})
