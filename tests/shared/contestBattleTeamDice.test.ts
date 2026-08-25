import { describe, expect, it } from 'vitest'
import { emptyContestDicePools, spendBattleContestTeamDice } from '../../shared/contests/document'

const zero = () => ({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 })
const teamPools = (cute: number) => ({
  ...emptyContestDicePools(),
  cute: {
    total: cute,
    remaining: cute,
    contributors: [{ id: 'introduction:team', kind: 'introduction' as const, statId: 'cute' as const, dice: cute, active: true, label: 'Trainer Introduction', sourceId: 'contest-op:v1:intro-team', explanation: 'Trainer Introduction generated shared Cute dice.' }],
  },
})
const spend = (input: { pools?: ReturnType<typeof teamPools>, journal?: any[], performer?: string, operation?: string, cute?: number }) => spendBattleContestTeamDice({
  teamPools: input.pools ?? teamPools(4),
  journal: input.journal ?? [],
  enrolledPokemonPerformerIds: ['performer:team-a', 'performer:team-b', 'performer:team-c'],
  performerId: input.performer ?? 'performer:team-a',
  operationId: input.operation ?? 'contest-op:v1:battle-spend-a',
  spentDice: { ...zero(), cute: input.cute ?? 1 },
  createdAt: 900,
})

describe('Battle Contest Trainer-team dice custody', () => {
  it('lets different enrolled team Pokémon deplete one pool without copying dice', () => {
    const first = spend({ cute: 2 })
    expect(first).toMatchObject({ exactRetry: false, teamPools: { cute: { total: 4, remaining: 2 } } })
    expect(first.receipt).toMatchObject({ performerId: 'performer:team-a', sourcePolicy: 'battle-trainer-team', spentDice: { cute: 2 }, remainingBefore: { cute: 4 }, remainingAfter: { cute: 2 } })

    const second = spend({ pools: first.teamPools as ReturnType<typeof teamPools>, journal: [...first.journal], performer: 'performer:team-b', operation: 'contest-op:v1:battle-spend-b', cute: 1 })
    expect(second.teamPools.cute.remaining).toBe(1)
    expect(second.journal.map(row => row.performerId)).toEqual(['performer:team-a', 'performer:team-b'])
    expect(second.journal[1]).toMatchObject({ remainingBefore: { cute: 2 }, remainingAfter: { cute: 1 } })
  })

  it('is exact-retry safe and rejects identity drift, overspend, and non-team actors', () => {
    const first = spend({ cute: 2 })
    const retry = spend({ pools: first.teamPools as ReturnType<typeof teamPools>, journal: [...first.journal], cute: 2 })
    expect(retry.exactRetry).toBe(true)
    expect(retry.journal).toHaveLength(1)
    expect(retry.receipt).toBe(first.receipt)

    expect(() => spend({ pools: retry.teamPools as ReturnType<typeof teamPools>, journal: [...retry.journal], performer: 'performer:team-b', cute: 2 })).toThrow(/reused with changed input/)
    expect(() => spend({ pools: teamPools(1), cute: 2, operation: 'contest-op:v1:battle-overspend' })).toThrow(/Only 1 shared team cute dice remain/)
    expect(() => spend({ performer: 'performer:opponent', operation: 'contest-op:v1:battle-opponent' })).toThrow(/enrolled Pokémon on that Trainer team/)
    expect(() => spend({ cute: 4, operation: 'contest-op:v1:battle-over-cap' })).toThrow(/0 through 3/)
  })
})
