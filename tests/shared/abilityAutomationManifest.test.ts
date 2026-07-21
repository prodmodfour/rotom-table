import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import manifestJson from '../../data/ability-automation/manifest.json'
import {
  AbilityAutomationManifestValidationError,
  parseAbilityAutomationManifest,
  type AbilityAutomationManifestValidationCode,
} from '#shared/abilityAutomation/manifest'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

const abilitiesPath = join(process.cwd(), 'data', 'reference', 'abilities.json')
const DEFINITION_HASH = 'a'.repeat(64)
let catalog: CanonicalAbilityCatalog

beforeAll(async () => {
  catalog = await loadCanonicalAbilityCatalog(readFileSync(abilitiesPath))
})

const provenance = () => ({
  rulesetId: catalog.rulesetId,
  canonicalizationVersion: catalog.canonicalizationVersion,
  sourceDataSha256: catalog.sourceDataSha256,
})

const completeRecord = () => ({
  canonicalId: 'Abominable',
  displayName: 'Abominable',
  baseStatus: 'complete',
  interactionStatus: 'unassessed',
  runtime: {
    kind: 'abilityspec-v1',
    version: 1,
    definitionHash: DEFINITION_HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/abominable.ts',
  },
  rulesProvenance: provenance(),
  capabilityTags: ['mode.static'],
  suggestedCapabilityTags: [],
  blockerCodes: [],
  limitations: [],
  manualSteps: [],
  scenarioIds: ['abominable.static-provider'],
  conformanceEvidence: {
    requirementTags: ['mode.static'],
    scenarios: [{
      scenarioId: 'abominable.static-provider',
      evidenceClasses: ['passive-applied', 'passive-suppressed'],
    }],
    notApplicable: [],
  },
  reviewedAt: '2026-07-09',
  unsupportedInteractionIds: [],
  rolloutCohortId: 'aa-060',
})

const blockedRecord = () => ({
  ...completeRecord(),
  canonicalId: 'Absorb Force',
  displayName: 'Absorb Force',
  baseStatus: 'blocked',
  runtime: {
    kind: 'unimplemented',
    version: null,
    definitionHash: null,
    sourceModule: null,
  },
  capabilityTags: [],
  suggestedCapabilityTags: ['mode.activated'],
  blockerCodes: ['runtime.unimplemented'],
  scenarioIds: [],
  conformanceEvidence: {
    requirementTags: [],
    scenarios: [],
    notApplicable: [],
  },
  reviewedAt: null,
})

const manifestWith = (...abilities: unknown[]) => ({ schemaVersion: 1, abilities })

const expectManifestError = (
  value: unknown,
  code: AbilityAutomationManifestValidationCode,
  path?: string,
): void => {
  try {
    parseAbilityAutomationManifest(value, catalog)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityAutomationManifestValidationError)
    expect((error as AbilityAutomationManifestValidationError).code).toBe(code)
    if (path) expect((error as AbilityAutomationManifestValidationError).path).toBe(path)
  }
}

describe('ability automation semantic manifest', () => {
  it('loads exactly one truthfully promoted or blocked row per canonical ability in canonical order', () => {
    const manifest = parseAbilityAutomationManifest(manifestJson, catalog)
    const canonicalIds = catalog.abilities.map(ability => ability.canonicalId)

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.abilities).toHaveLength(483)
    expect(manifest.abilities.map(ability => ability.canonicalId)).toEqual(canonicalIds)
    expect(new Set(manifest.abilities.map(ability => ability.canonicalId)).size).toBe(483)
    expect(manifest.abilities.filter(ability => ability.baseStatus === 'complete').map(ability => ability.canonicalId))
      .toEqual([
        'Abominable', 'Absorb Force', 'Accelerate', 'Adaptability', 'Aerilate', 'Aftermath',
        'Air Lock', 'Ambush', 'Analytic', 'Anchored', 'Anger Point', 'Anticipation',
        'Aqua Boost', 'Aqua Bullet', 'Arena Trap', 'Aroma Veil', 'Aura Break', 'Aura Storm',
        'Bad Dreams', 'Ball Fetch', 'Battery', 'Battle Armor', 'Beam Cannon', 'Beast Boost',
        'Beautiful', 'Berry Storage', 'Berserk', 'Big Pecks', 'Big Swallow', 'Blaze',
        'Blessed Touch', 'Blow Away', 'Blur', 'Bodyguard', 'Bone Lord', 'Bone Wielder',
        'Brimstone', 'Bulletproof', 'Bully', 'Cave Crasher', 'Celebrate', 'Chemical Romance',
        'Cherry Power', 'Chilling Neigh', 'Chlorophyll', 'Clay Cannons', 'Clear Body', 'Cloud Nine',
        'Cluster Mind', 'Color Change', 'Color Theory', 'Comatose', 'Combo Striker', 'Competitive',
        'Compound Eyes', 'Confidence', 'Conqueror', 'Contrary', 'Copy Master', 'Corrosion',
      ])
    expect(manifest.abilities.filter(ability => ability.baseStatus === 'blocked')).toHaveLength(423)
    expect(manifest.abilities.filter(ability => ability.runtime.kind === 'unimplemented')).toHaveLength(423)
  })

  it('keeps bootstrap mode hints non-authoritative and maps every row to its plan cohort', () => {
    const manifest = parseAbilityAutomationManifest(manifestJson, catalog)
    const counts = manifest.abilities.reduce<Record<string, number>>((result, ability) => {
      const hint = ability.suggestedCapabilityTags[0]
        ?? ['mode.static', 'mode.triggered', 'mode.activated']
          .find(tag => ability.capabilityTags.includes(tag))!
      result[hint] = (result[hint] ?? 0) + 1
      return result
    }, {})

    expect(counts).toEqual({
      'mode.static': 244,
      'mode.triggered': 119,
      'mode.activated': 120,
    })
    expect(manifest.abilities[0]).toMatchObject({ canonicalId: 'Abominable', rolloutCohortId: 'aa-060' })
    expect(manifest.abilities[11]).toMatchObject({ canonicalId: 'Anticipation', rolloutCohortId: 'aa-060' })
    expect(manifest.abilities[12]).toMatchObject({ canonicalId: 'Aqua Boost', rolloutCohortId: 'aa-061' })
    expect(manifest.abilities[24]).toMatchObject({ canonicalId: 'Beautiful', rolloutCohortId: 'aa-062' })
    expect(manifest.abilities[36]).toMatchObject({ canonicalId: 'Brimstone', rolloutCohortId: 'aa-063' })
    expect(manifest.abilities[48]).toMatchObject({ canonicalId: 'Cluster Mind', rolloutCohortId: 'aa-064' })
    expect(manifest.abilities.at(-1)).toMatchObject({ canonicalId: 'Zen Snowed', rolloutCohortId: 'aa-100' })
    expect(manifest.abilities.filter(ability => ability.baseStatus === 'complete')
      .every(ability => ability.capabilityTags.includes('runtime.abilityspec-v1'))).toBe(true)
    expect(manifest.abilities.filter(ability => ability.baseStatus === 'blocked')
      .every(ability => ability.capabilityTags.length === 0)).toBe(true)
  })

  it('accepts a debt-free reviewed AbilitySpec row with executable evidence', () => {
    const manifest = parseAbilityAutomationManifest(manifestWith(completeRecord()), catalog)

    expect(manifest.abilities[0]).toMatchObject({
      canonicalId: 'Abominable',
      baseStatus: 'complete',
      runtime: { kind: 'abilityspec-v1', version: 1 },
      scenarioIds: ['abominable.static-provider'],
    })
  })

  it('rejects unknown fields, identities, duplicates, and noncanonical ordering', () => {
    expectManifestError(
      { ...manifestWith(blockedRecord()), extra: true },
      'invalid-manifest',
      'manifest',
    )
    expectManifestError(
      manifestWith({ ...blockedRecord(), extra: true }),
      'invalid-manifest',
      'abilities[0]',
    )
    expectManifestError(
      manifestWith({ ...blockedRecord(), canonicalId: 'Unknown', displayName: 'Unknown' }),
      'unknown-ability',
      'abilities[0].canonicalId',
    )
    expectManifestError(
      manifestWith(blockedRecord(), blockedRecord()),
      'duplicate-ability',
      'manifest.abilities',
    )
    expectManifestError(
      manifestWith(blockedRecord(), completeRecord()),
      'canonical-order-mismatch',
      'manifest.abilities',
    )
  })

  it('requires exact rules provenance and valid server runtime references', () => {
    expectManifestError(
      manifestWith({
        ...blockedRecord(),
        rulesProvenance: { ...provenance(), sourceDataSha256: 'b'.repeat(64) },
      }),
      'provenance-mismatch',
      'abilities[0].rulesProvenance',
    )
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        runtime: {
          ...completeRecord().runtime,
          sourceModule: 'src/utils/abilityAutomation.ts',
        },
      }),
      'invalid-manifest',
      'abilities[0].runtime.sourceModule',
    )
  })

  it('enforces truthful complete, assisted, blocked, and unimplemented combinations', () => {
    const invalidRows = [
      {
        ...completeRecord(),
        scenarioIds: [],
        conformanceEvidence: {
          ...completeRecord().conformanceEvidence,
          requirementTags: [],
          scenarios: [],
        },
      },
      { ...completeRecord(), reviewedAt: null },
      { ...completeRecord(), blockerCodes: ['runtime.unimplemented'] },
      { ...completeRecord(), limitations: [{ code: 'manual.audit', summary: 'Not complete.' }] },
      { ...blockedRecord(), blockerCodes: [] },
      { ...blockedRecord(), capabilityTags: ['mode.static'] },
      {
        ...completeRecord(),
        baseStatus: 'assisted',
      },
      {
        ...completeRecord(),
        baseStatus: 'assisted',
        limitations: [{ code: 'choice.manual', summary: 'A choice remains manual.' }],
        blockerCodes: ['runtime.unimplemented'],
      },
    ]

    for (const row of invalidRows) {
      expectManifestError(manifestWith(row), 'invalid-status-combination')
    }

    expect(parseAbilityAutomationManifest(manifestWith({
      ...completeRecord(),
      baseStatus: 'assisted',
      limitations: [{ code: 'choice.manual', summary: 'A choice remains manual.' }],
    }), catalog).abilities[0]?.baseStatus).toBe('assisted')
  })

  it('requires complete rows to map every declared scenario to nonempty evidence', () => {
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        conformanceEvidence: {
          ...completeRecord().conformanceEvidence,
          requirementTags: [],
        },
      }),
      'missing-conformance-evidence',
      'abilities[0].conformanceEvidence.requirementTags',
    )
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        scenarioIds: [
          ...completeRecord().scenarioIds,
          'abominable.unmapped',
        ],
      }),
      'missing-conformance-evidence',
      'abilities[0].conformanceEvidence.scenarios',
    )
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        conformanceEvidence: {
          ...completeRecord().conformanceEvidence,
          scenarios: [{
            scenarioId: 'abominable.static-provider',
            evidenceClasses: [],
          }],
        },
      }),
      'invalid-conformance-evidence',
    )
  })

  it('requires capability, blocker, requirement, and evidence references to resolve', () => {
    expectManifestError(
      manifestWith({ ...completeRecord(), capabilityTags: ['mechanic.unknown'] }),
      'unknown-capability',
      'abilities[0].capabilityTags[0]',
    )
    expectManifestError(
      manifestWith({ ...blockedRecord(), blockerCodes: ['runtime.unknown'] }),
      'unknown-capability',
      'abilities[0].blockerCodes[0]',
    )
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        conformanceEvidence: {
          ...completeRecord().conformanceEvidence,
          requirementTags: ['mode.unknown'],
        },
      }),
      'unknown-evidence-requirement',
      'abilities[0].conformanceEvidence.requirementTags[0]',
    )
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        conformanceEvidence: {
          ...completeRecord().conformanceEvidence,
          scenarios: [{
            scenarioId: 'abominable.static-provider',
            evidenceClasses: ['unknown'],
          }],
        },
      }),
      'unknown-evidence-class',
      'abilities[0].conformanceEvidence.scenarios[0].evidenceClasses[0]',
    )
    expectManifestError(
      manifestWith({
        ...completeRecord(),
        conformanceEvidence: {
          ...completeRecord().conformanceEvidence,
          scenarios: [{
            scenarioId: 'abominable.static-provider',
            evidenceClasses: ['passive-applied'],
          }],
        },
      }),
      'missing-conformance-evidence',
      'abilities[0].conformanceEvidence',
    )
  })

  it('keeps base completion separate from explicit ecosystem interaction status', () => {
    const partial = {
      ...completeRecord(),
      interactionStatus: 'partial',
      unsupportedInteractionIds: ['move.transform'],
    }
    expect(parseAbilityAutomationManifest(manifestWith(partial), catalog).abilities[0])
      .toMatchObject({ baseStatus: 'complete', interactionStatus: 'partial' })

    expectManifestError(
      manifestWith({ ...partial, unsupportedInteractionIds: [] }),
      'invalid-status-combination',
      'abilities[0].unsupportedInteractionIds',
    )
    expectManifestError(
      manifestWith({ ...blockedRecord(), interactionStatus: 'complete' }),
      'invalid-status-combination',
      'abilities[0].interactionStatus',
    )
  })
})
