import { describe, expect, it } from 'vitest'
import registryJson from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import {
  ITEM_CATALOG_COHORT_MEMBER_LIMIT_MAXIMUM,
  ItemCatalogCohortContractError,
  parseItemCatalogCohortRegistryV1,
} from '../../shared/itemAutomation/catalogCohorts'

const clone = (): any => JSON.parse(JSON.stringify(registryJson))
const expectError = (mutate: (value: any) => void, path: string): void => {
  const value = clone()
  mutate(value)
  try {
    parseItemCatalogCohortRegistryV1(value)
    expect.unreachable('Expected strict cohort contract rejection')
  }
  catch (error) {
    expect(error).toBeInstanceOf(ItemCatalogCohortContractError)
    expect((error as ItemCatalogCohortContractError).path).toBe(path)
  }
}

describe('canonical item catalog cohort contract', () => {
  it('accepts one deeply frozen, bounded, complete reviewed registry', () => {
    const parsed = parseItemCatalogCohortRegistryV1(registryJson)
    expect(parsed).toEqual(registryJson)
    expect(parsed).not.toBe(registryJson)
    expect(parsed.cohortMemberLimit).toBeLessThanOrEqual(ITEM_CATALOG_COHORT_MEMBER_LIMIT_MAXIMUM)
    expect(parsed.cohorts.every(cohort => cohort.memberCount <= parsed.cohortMemberLimit)).toBe(true)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.cohorts)).toBe(true)
    expect(Object.isFrozen(parsed.cohorts[0]?.members)).toBe(true)
  })

  it('rejects expanded shapes, unsafe evidence paths, invalid states, and incomplete counts', () => {
    expectError(value => { value.privateNotes = [] }, 'itemCatalogCohortRegistry')
    expectError(value => { value.cohorts[0].sourceEvidence[0].path = '/etc/passwd' }, 'itemCatalogCohortRegistry.cohorts[0].sourceEvidence[0].path')
    expectError(value => { value.cohorts[0].implementationState = 'partial' }, 'itemCatalogCohortRegistry.cohorts[0].implementationState')
    expectError(value => { value.cohorts[0].memberCount -= 1 }, 'itemCatalogCohortRegistry.cohorts[0].memberCount')
    expectError(value => { value.itemCount -= 1 }, 'itemCatalogCohortRegistry.itemCount')
  })

  it('requires unique identities, contiguous sequence, no hidden gaps, and explicit remediation for any blocked mutation', () => {
    expectError(value => {
      value.cohorts[1].members[0].canonicalId = value.cohorts[0].members[0].canonicalId
    }, 'itemCatalogCohortRegistry.cohorts')
    expectError(value => { value.cohorts[1].sequence = 7 }, 'itemCatalogCohortRegistry.cohorts[1].sequence')
    expect(registryJson.cohorts.some(cohort => cohort.implementationState === 'blocked')).toBe(false)
    expectError(value => { value.cohorts[0].implementationState = 'blocked' }, 'itemCatalogCohortRegistry.cohorts[0].unresolvedRequirements')
    expectError(value => { value.cohorts[0].unresolvedRequirements = ['hidden gap'] }, 'itemCatalogCohortRegistry.cohorts[0].unresolvedRequirements')
  })
})
