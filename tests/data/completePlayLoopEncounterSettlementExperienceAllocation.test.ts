import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-experience-allocation.v1.json'
import { ENCOUNTER_SETTLEMENT_EXPERIENCE_DISTRIBUTION_METHODS } from '../../server/domain/encounterSettlement/experienceAllocation'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-075 encounter settlement Experience allocation contract', () => {
  it('is versioned and hash-bound to canonical Experience and relationship authorities', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-075',
      status: 'current-semantics',
      contract: 'encounter-settlement-experience-allocation-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      rewardPackageContractSha256: sha256('data/complete-play-loop/encounter-settlement-reward-package.v1.json'),
      experienceAllocationModelSha256: sha256('server/domain/encounterSettlement/experienceAllocation.ts'),
      pokemonExperienceChartSha256: sha256('data/reference/pokemonExperienceChart.json'),
      pokemonExperienceRulesSha256: sha256('src/utils/sheets/pokemonExperience.ts'),
      sheetMutationRulesSha256: sha256('src/utils/sheetMutations.ts'),
      capabilityEvolutionRulesSha256: sha256('server/domain/capabilityAutomation/evolutionProviders.ts'),
      marsupialRelationshipRulesSha256: sha256('server/domain/capabilityAutomation/marsupialRelationship.ts'),
    })
  })

  it('matches fixed, weighted, and individually adjusted distribution policy', () => {
    expect(contract.distribution.methods).toEqual([
      ...ENCOUNTER_SETTLEMENT_EXPERIENCE_DISTRIBUTION_METHODS,
    ])
    expect(contract.distribution.fixed).toContain('stable participant-identity order')
    expect(contract.distribution.weighted).toContain('largest remainder')
    expect(contract.distribution.individual).toContain('sum exactly')
    expect(contract.distribution.conservation).toContain('exactly')
  })

  it('requires canonical current level authority and previews every threshold', () => {
    expect(contract.authority.completenessLiteral).toBe('authoritative-current')
    expect(contract.authority.experienceInvariant).toContain('canonical chart level exactly matches')
    expect(contract.levelPreview.canonicalLevels).toBe('data/reference/pokemonExperienceChart.json only')
    expect(contract.levelPreview.maxLevel).toBe(100)
    expect(contract.levelPreview.fields).toEqual(expect.arrayContaining([
      'total Experience before and after',
      'Level before and after',
      'every crossed canonical Level and threshold',
    ]))
  })

  it('retains Marsupial sharing and related Level-25 lifecycle writes', () => {
    expect(contract.marsupial.sharing).toContain('20-percent')
    expect(contract.marsupial.corruption).toContain('reject the whole plan')
    expect(contract.marsupial.level25).toContain('clears reciprocal pouch state')
    expect(contract.marsupial.relatedWrite).toContain('non-contributing zero-amount write')
  })

  it('makes the batch revision-bound, all-or-nothing, and private', () => {
    expect(contract.batchWrite.beforeAfterEvidence).toContain('SHA-256')
    expect(contract.batchWrite.staleRule).toContain('every sheet revision')
    expect(contract.batchWrite.atomicRule).toContain('no applicable writes')
    expect(contract.completion.pending).toContain('blocks application')
    expect(contract.completion.excluded).toContain('requires no allocation')
    expect(contract.privacy.serverPrivate).toEqual(expect.arrayContaining([
      'sheet document and hash',
      'relationship state and operation identity',
      'Profile ownership evidence',
    ]))
  })
})
