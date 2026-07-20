import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import rulesetJson from '../../data/ability-automation/ruleset.json'
import {
  ABILITY_RULESET_PROVENANCE,
  AbilityRulesetValidationError,
  abilityRulesSourceSha256,
  loadCanonicalAbilityCatalog,
  parseAbilityRulesetProvenance,
} from '#shared/abilityAutomation/ruleset'

const abilitiesPath = join(process.cwd(), 'data', 'reference', 'abilities.json')
const sourceBytes = (): Uint8Array => readFileSync(abilitiesPath)

const provenanceForSource = async (source: string | Uint8Array) => {
  const provenance = structuredClone(rulesetJson)
  provenance.sourceData.sha256 = await abilityRulesSourceSha256(source)
  return provenance
}

const expectRulesetError = async (
  operation: Promise<unknown>,
  code: AbilityRulesetValidationError['code'],
): Promise<void> => {
  try {
    await operation
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityRulesetValidationError)
    expect((error as AbilityRulesetValidationError).code).toBe(code)
  }
}

const codePointSort = (values: readonly string[]): string[] => [...values].sort((left, right) => (
  left === right ? 0 : left < right ? -1 : 1
))

describe('canonical ability ruleset provenance', () => {
  it('loads exactly 483 unique abilities from the reviewed source bytes in canonical order', async () => {
    const catalog = await loadCanonicalAbilityCatalog(sourceBytes())
    const identities = catalog.abilities.map(ability => ability.canonicalId)

    expect(catalog.rulesetId).toBe('rotom-table-reference-abilities-v1')
    expect(catalog.canonicalizationVersion).toBe(1)
    expect(catalog.sourceDataSha256).toBe(ABILITY_RULESET_PROVENANCE.sourceData.sha256)
    expect(catalog.abilities).toHaveLength(483)
    expect(new Set(identities).size).toBe(483)
    expect(identities).toEqual(codePointSort(identities))
    expect(identities).toContain('Wind Power')
    expect(catalog.excludedHomebrewSourceKeys).toEqual([])
  })

  it('has no unresolved frequency or effect gaps after reviewed source adjudication', async () => {
    const catalog = await loadCanonicalAbilityCatalog(sourceBytes())

    expect(catalog.knownSourceGaps).toEqual({
      missingFrequency: [],
      missingEffect: [],
    })
    expect(catalog.abilities.every(ability => ability.source.frequency)).toBe(true)
    expect(catalog.abilities.every(ability => ability.source.effect)).toBe(true)
  })

  it('records an ordered, checked-in source hierarchy and explicit external fill boundary', () => {
    expect(ABILITY_RULESET_PROVENANCE.sourceHierarchy.orderedInputs.map(input => input.id)).toEqual([
      'legends-arceus-reference',
      'sword-shield-reference',
      'sun-moon-reference',
      'errata-3-reference',
      'errata-2-reference',
      'ptu-1.05-core-reference',
      'community-sheet-fill',
    ])
    for (const input of ABILITY_RULESET_PROVENANCE.sourceHierarchy.orderedInputs) {
      expect(existsSync(join(process.cwd(), input.location)), input.location).toBe(true)
    }
    expect(ABILITY_RULESET_PROVENANCE.sourceHierarchy.orderedInputs.at(-1)).toMatchObject({
      kind: 'documented-external-fill',
      location: 'scripts/fetch_abilities.py',
    })
  })

  it('rejects source-byte drift until provenance is intentionally reviewed', async () => {
    const changedSource = `${new TextDecoder().decode(sourceBytes())} `

    await expectRulesetError(loadCanonicalAbilityCatalog(changedSource), 'source-hash-mismatch')

    const reviewedProvenance = await provenanceForSource(changedSource)
    await expect(loadCanonicalAbilityCatalog(changedSource, reviewedProvenance)).resolves.toMatchObject({
      sourceDataSha256: reviewedProvenance.sourceData.sha256,
      abilities: expect.arrayContaining([
        expect.objectContaining({ canonicalId: 'Levitate', displayName: 'Levitate' }),
      ]),
    })
  })

  it('rejects identity drift even after source-byte review', async () => {
    const source = JSON.parse(new TextDecoder().decode(sourceBytes())) as Record<string, Record<string, unknown>>
    source.Levitate!.name = 'Not Levitate'
    const changedSource = JSON.stringify(source)

    await expectRulesetError(
      loadCanonicalAbilityCatalog(changedSource, await provenanceForSource(changedSource)),
      'invalid-catalog',
    )
  })

  it('rejects a new source gap until the reviewed gap policy changes', async () => {
    const source = JSON.parse(new TextDecoder().decode(sourceBytes())) as Record<string, Record<string, unknown>>
    delete source.Abominable!.frequency
    const changedSource = JSON.stringify(source)

    await expectRulesetError(
      loadCanonicalAbilityCatalog(changedSource, await provenanceForSource(changedSource)),
      'source-gap-policy-mismatch',
    )
  })

  it('keeps explicitly namespaced homebrew abilities outside the canonical catalog', async () => {
    const source = JSON.parse(new TextDecoder().decode(sourceBytes())) as Record<string, unknown>
    source['homebrew:Example Ability'] = {
      name: 'homebrew:Example Ability',
      frequency: 'Static',
      effect: 'A test-only noncanonical effect.',
    }
    const changedSource = JSON.stringify(source)
    const catalog = await loadCanonicalAbilityCatalog(
      changedSource,
      await provenanceForSource(changedSource),
    )

    expect(catalog.abilities).toHaveLength(483)
    expect(catalog.abilities.some(ability => ability.canonicalId === 'homebrew:Example Ability')).toBe(false)
    expect(catalog.excludedHomebrewSourceKeys).toEqual(['homebrew:Example Ability'])
  })

  it('rejects unknown provenance and canonical source fields', async () => {
    const provenance = {
      ...structuredClone(rulesetJson),
      canonicalization: {
        ...structuredClone(rulesetJson.canonicalization),
        unreviewedPolicy: true,
      },
    }
    expect(() => parseAbilityRulesetProvenance(provenance)).toThrow(/unknown: unreviewedPolicy/)

    const source = JSON.parse(new TextDecoder().decode(sourceBytes())) as Record<string, Record<string, unknown>>
    source.Abominable!.runtimeRule = 'unreviewed'
    const changedSource = JSON.stringify(source)
    await expectRulesetError(
      loadCanonicalAbilityCatalog(changedSource, await provenanceForSource(changedSource)),
      'invalid-catalog',
    )
  })
})
