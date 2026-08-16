import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import itemsJson from '../../data/reference/items.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  canonicalItemCatalogCohortDecision,
  canonicalItemCatalogCohortRegistry,
  listCanonicalItemCatalogCohortDecisions,
  requireCanonicalItemCatalogCohortDecision,
} from '../../server/domain/itemAutomation/catalogCohortRegistry'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('canonical item catalog cohort registry', () => {
  it('assigns every exact canonical item once through bounded reviewed cohorts', () => {
    const decisions = listCanonicalItemCatalogCohortDecisions()
    const canonicalIds = Object.keys(itemsJson)
    expect(decisions).toHaveLength(canonicalIds.length)
    expect(new Set(decisions.map(decision => decision.member.canonicalId))).toEqual(new Set(canonicalIds))
    expect(canonicalItemCatalogCohortRegistry.registrySha256).toBe(
      sha256(stableJsonStringify(canonicalItemCatalogCohortRegistry.cohorts)),
    )
    expect(canonicalItemCatalogCohortRegistry.cohorts.every(cohort => (
      cohort.memberCount >= 1
      && cohort.memberCount <= canonicalItemCatalogCohortRegistry.cohortMemberLimit
    ))).toBe(true)
  })

  it('projects decisions without treating catalog classification as mechanical authority', () => {
    expect(requireCanonicalItemCatalogCohortDecision('Potion').cohort).toMatchObject({
      providerId: 'core-item-spec', implementationState: 'native', unresolvedRequirements: [],
    })
    expect(requireCanonicalItemCatalogCohortDecision('TM 01 - Hone Claws').cohort).toMatchObject({
      providerId: 'machine-move', implementationState: 'native',
    })
    expect(requireCanonicalItemCatalogCohortDecision('Kitchen Knife').cohort).toMatchObject({
      providerId: 'equipment', implementationState: 'passive',
    })
    expect(requireCanonicalItemCatalogCohortDecision('Energy Powder').cohort).toMatchObject({
      providerId: 'guided-adjudication', implementationState: 'guided',
    })
    expect(requireCanonicalItemCatalogCohortDecision('Basic Ball').cohort).toMatchObject({
      providerId: 'capture', implementationState: 'native', unresolvedRequirements: [],
    })
    expect(requireCanonicalItemCatalogCohortDecision('Collection Jar').cohort).toMatchObject({
      providerId: 'interpretive-campaign-tool', implementationState: 'guided', unresolvedRequirements: [],
    })
    expect(requireCanonicalItemCatalogCohortDecision('Black Sludge').cohort).toMatchObject({
      providerId: 'core-item-spec', implementationState: 'native', unresolvedRequirements: [],
    })
    expect(canonicalItemCatalogCohortDecision('Invented Item')).toBeNull()
    expect(() => requireCanonicalItemCatalogCohortDecision('Invented Item')).toThrow(
      'has no reviewed cohort decision',
    )
  })

  it('pins every cohort source, executable, UI, and recovery evidence file', () => {
    for (const cohort of canonicalItemCatalogCohortRegistry.cohorts) {
      for (const group of [
        cohort.sourceEvidence,
        cohort.executableEvidence,
        cohort.uiProjectionEvidence,
        cohort.recoveryEvidence,
      ]) {
        expect(group.length, cohort.cohortId).toBeGreaterThan(0)
        for (const source of group) {
          expect(sha256(readFileSync(source.path)), `${cohort.cohortId}: ${source.path}`).toBe(source.sha256)
        }
      }
    }
  })

  it('records P8-093 closure with no blocked canonical row', () => {
    expect(canonicalItemCatalogCohortRegistry.implementationStateCounts).toEqual({
      guided: 40, native: 204, passive: 104,
    })
    const decisions = listCanonicalItemCatalogCohortDecisions()
    expect(decisions.filter(decision => decision.cohort.implementationState === 'blocked')).toEqual([])
    expect(decisions.filter(decision => decision.cohort.providerId === 'capture')).toHaveLength(25)
    expect(decisions.filter(decision => decision.cohort.providerId === 'interpretive-campaign-tool')).toHaveLength(34)
    expect(decisions.filter(decision => decision.cohort.providerId === 'canonical-data-defect')).toHaveLength(0)
    expect(decisions.every(decision => decision.cohort.unresolvedRequirements.length === 0)).toBe(true)
  })
})
