import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import matrix from '../../data/contests/trainer-participant-variant-matrix.v1.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const variants = ['standard','supercontest','festival','rotation'] as const
const methods = ['simultaneous','alternating'] as const

describe('P11-063 Trainer Participant deterministic variant matrix', () => {
  it('covers all four base variants, both methods, and every supported contestant count', () => {
    expect(matrix).toMatchObject({ schemaVersion: 1, fixtureSetId: 'trainer-participant-contest-variant-matrix-v1', participantVariantId: 'trainer-participant' })
    expect(matrix.scenarios).toHaveLength(24)
    expect(new Set(matrix.scenarios.map(row => row.id)).size).toBe(24)
    for (const variantId of variants) for (const participantMethodId of methods) for (const contestantCount of [3,4,5]) {
      expect(matrix.scenarios).toContainEqual(expect.objectContaining({ variantId, participantMethodId, contestantCount }))
    }
    for (const source of matrix.sources) expect(acceptedSuccessorHead(source.path, source.sha256), source.path).toBe(sha256(source.path))
  })

  it('pins exact lifecycle, scheduling, placement, settlement, and replay evidence', () => {
    for (const scenario of matrix.scenarios) {
      const multiplier = scenario.participantMethodId === 'simultaneous' ? 2 : 1
      const baseTurns = scenario.variantId === 'festival'
        ? Array.from({ length: scenario.contestantCount - 2 }, (_, index) => scenario.contestantCount - index).reduce((sum, count) => sum + count * count, 0)
        : scenario.contestantCount * scenario.contestantCount
      expect(scenario.expected.acceptedAppeals, scenario.id).toBe(baseTurns * multiplier)
      expect(scenario.expected.letters).toHaveLength(scenario.contestantCount)
      expect(scenario.expected.placements).toHaveLength(scenario.contestantCount)
      expect(scenario.expected.settlement).toHaveLength(scenario.contestantCount)
      expect(scenario.expected.placements.map(row => row.placement).sort((a,b) => a! - b!)).toEqual(Array.from({ length: scenario.contestantCount }, (_, index) => index + 1))
      expect(scenario.expected.placements.every(row => row.finalScore === row.appeal - row.fumble)).toBe(true)
      expect(scenario.expected.settlement.filter(row => row.ribbon)).toHaveLength(1)
      expect(scenario.expected.settlement.every(row => row.pokemonAwards === (scenario.variantId === 'rotation' ? scenario.contestantCount : 1))).toBe(true)
      expect(scenario.expected.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u)
      for (const sequence of Object.values(scenario.expected.performerSequences)) {
        if (scenario.participantMethodId === 'simultaneous') for (let index = 0; index < sequence.length; index += 2) expect(new Set(sequence.slice(index, index + 2)), `${scenario.id}:${index}`).toEqual(new Set(['trainer','pokemon']))
        else for (let index = 1; index < sequence.length; index += 1) expect(sequence[index], `${scenario.id}:${index}`).not.toBe(sequence[index - 1])
      }
    }
    expect(new Set(matrix.scenarios.map(row => row.expected.evidenceSha256)).size).toBe(matrix.scenarios.length)
  })
})
