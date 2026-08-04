import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingEggGroupId, BreedingMoveId, BreedingSpeciesId } from '#shared/breeding/ids'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import {
  evaluateBreedingCompatibility,
  type BreedingCompatibilityParentFacts,
} from '../../server/domain/breeding/compatibility'
import {
  BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
  BREEDING_INHERITANCE_LIMITS,
  BreedingInheritanceSnapshotValidationError,
  breedingInheritanceParentSnapshotDefinitionSha256,
  buildBreedingInheritanceCandidates,
  createBreedingInheritanceParentSnapshot,
  parseBreedingInheritanceParentSnapshot,
  type BreedingEffectiveKnownMoveSnapshot,
  type BreedingInheritanceParentSnapshot,
} from '../../server/domain/breeding/inheritanceCandidates'
import { resolveBreedingOffspring } from '../../server/domain/breeding/offspringResolution'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const policy = readJson<Record<string, any>>('data/breeding-automation/inheritance-candidate-policy.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const registry = readJson<{ definitionSha256: string }>('data/breeding-automation/compiled-registry.json')
const canonicalIds = readJson<{ definitionSha256: string }>('data/breeding-automation/canonical-ids.json')
const offspringPolicy = readJson<{ definitionSha256: string }>('data/breeding-automation/offspring-resolution-policy.json')

const parent = (
  parentRef: string,
  speciesId: string,
  genderId: 'female' | 'male' | 'genderless',
  eggGroupIds: string[],
): BreedingCompatibilityParentFacts => ({
  parentRef,
  speciesId: speciesId as BreedingSpeciesId,
  genderId,
  level: 30,
  eggGroupIds: eggGroupIds as BreedingEggGroupId[],
  gmMaturityConfirmed: true,
})
const resolvedBulbasaur = () => {
  const parents = [
    parent('sheet:bulbasaur-f', 'bulbasaur', 'female', ['monster', 'plant']),
    parent('sheet:ivysaur-m', 'ivysaur', 'male', ['monster', 'plant']),
  ] as const
  const options = resolveBreedingCampaignOptionSnapshot()
  const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
  return resolveBreedingOffspring({
    parents, options, compatibility, familyRoll: 5, familyChoice: null, speciesOverride: null,
  })
}
const effectiveMove = (
  moveId: string,
  evidenceId: string,
  sourceKind: 'sheet-known-move' | 'permanent-move-grant' | 'effective-provider' = 'sheet-known-move',
): BreedingEffectiveKnownMoveSnapshot => ({
  moveId: moveId as BreedingMoveId,
  evidence: [{
    evidenceId,
    sourceKind,
    sourceId: `${sourceKind}:${evidenceId}`,
    sourceDefinitionSha256: 'b'.repeat(64),
  }],
})
const snapshot = (
  parentRef: string,
  speciesId: string,
  moves: BreedingEffectiveKnownMoveSnapshot[],
  sourceSheetSha256 = 'a'.repeat(64),
): BreedingInheritanceParentSnapshot => createBreedingInheritanceParentSnapshot({
  schemaVersion: 1,
  parentRef,
  speciesId: speciesId as BreedingSpeciesId,
  sourceSheetSha256,
  effectiveKnownMoves: moves,
})
const parentSnapshots = () => [
  snapshot('sheet:bulbasaur-f', 'bulbasaur', [
    effectiveMove('tackle', 'move:tackle'),
    effectiveMove('light-screen', 'move:light-screen'),
    effectiveMove('amnesia', 'move:amnesia', 'permanent-move-grant'),
    effectiveMove('attract', 'move:attract'),
  ]),
  snapshot('sheet:ivysaur-m', 'ivysaur', [
    effectiveMove('nature-power', 'move:nature-power', 'effective-provider'),
    effectiveMove('light-screen', 'move:light-screen-other'),
    effectiveMove('attract', 'move:attract-other'),
  ], 'c'.repeat(64)),
] as const

describe('canonical inheritance candidate construction', () => {
  it('freezes exact source-bound construction, limits, pathways, and provenance policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-inheritance-candidate-policy-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
      definitionSha256: BREEDING_INHERITANCE_CANDIDATE_POLICY_DEFINITION_SHA256,
    })
    expect(policy.definitionSha256).toBe(hashDefinition(policy.definition))
    expect(policy.definition.bindings).toMatchObject({
      sourceAdjudicationsFileSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-adjudications.json'))),
      compiledRegistryDefinitionSha256: registry.definitionSha256,
      canonicalIdDefinitionSha256: canonicalIds.definitionSha256,
      offspringResolutionPolicyDefinitionSha256: offspringPolicy.definitionSha256,
    })
    expect(policy.definition.construction.pathways).toEqual(['child-egg-move', 'child-machine-compatible'])
    expect(policy.definition.input).toMatchObject({
      effectiveMovesPerParentMaximum: 64,
      evidenceRowsPerMoveMaximum: 16,
      candidateMaximum: 256,
    })
    expect(policy.definition.input.legacyFields).toEqual([
      'eggMoves-forbidden', 'inheritedMoves-forbidden', 'move-labels-forbidden',
    ])
    expect(policy.definition.reasonIds).toHaveLength(8)
  })

  it('creates strict detached, sorted, self-hashed effective Move snapshots', () => {
    const sourceMoves = [
      effectiveMove('light-screen', 'evidence:z'),
      effectiveMove('amnesia', 'evidence:a'),
    ]
    const result = snapshot('sheet:parent-1', 'bulbasaur', sourceMoves)
    expect(result.effectiveKnownMoves.map(move => move.moveId)).toEqual(['amnesia', 'light-screen'])
    expect(result.definitionSha256).toBe(breedingInheritanceParentSnapshotDefinitionSha256({
      schemaVersion: 1,
      parentRef: result.parentRef,
      speciesId: result.speciesId,
      sourceSheetSha256: result.sourceSheetSha256,
      effectiveKnownMoves: result.effectiveKnownMoves,
    }))
    expect(parseBreedingInheritanceParentSnapshot(result)).toEqual(result)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.effectiveKnownMoves)).toBe(true)
    expect(Object.isFrozen(result.effectiveKnownMoves[0]!.evidence)).toBe(true)

    sourceMoves[0]!.evidence[0] = { ...sourceMoves[0]!.evidence[0]!, evidenceId: 'evidence:mutated' }
    expect(result.effectiveKnownMoves[1]!.evidence[0]!.evidenceId).toBe('evidence:z')

    expect(() => parseBreedingInheritanceParentSnapshot({ ...result, definitionSha256: '0'.repeat(64) }))
      .toThrow(BreedingInheritanceSnapshotValidationError)
    expect(() => parseBreedingInheritanceParentSnapshot({ ...result, eggMoves: [] }))
      .toThrow(/invalid shape/)
  })

  it('deduplicates by canonical Move ID while retaining every parent, pathway, and evidence row', () => {
    const parents = parentSnapshots()
    const result = buildBreedingInheritanceCandidates({ offspring: resolvedBulbasaur(), parentSnapshots: parents })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.candidates.map(candidate => candidate.moveId)).toEqual([
      'amnesia', 'attract', 'light-screen', 'nature-power',
    ])
    expect(result.candidates.find(candidate => candidate.moveId === 'amnesia')!.sources).toEqual([{
      parentIndex: 0,
      parentRef: 'sheet:bulbasaur-f',
      parentSpeciesId: 'bulbasaur',
      pathwayId: 'child-egg-move',
      knownMoveEvidence: [{
        evidenceId: 'move:amnesia',
        sourceKind: 'permanent-move-grant',
        sourceId: 'permanent-move-grant:move:amnesia',
        sourceDefinitionSha256: 'b'.repeat(64),
      }],
    }])
    expect(result.candidates.find(candidate => candidate.moveId === 'light-screen')!.sources.map(source => ({
      parentIndex: source.parentIndex,
      pathwayId: source.pathwayId,
      evidenceId: source.knownMoveEvidence[0]!.evidenceId,
    }))).toEqual([
      { parentIndex: 0, pathwayId: 'child-egg-move', evidenceId: 'move:light-screen' },
      { parentIndex: 0, pathwayId: 'child-machine-compatible', evidenceId: 'move:light-screen' },
      { parentIndex: 1, pathwayId: 'child-egg-move', evidenceId: 'move:light-screen-other' },
      { parentIndex: 1, pathwayId: 'child-machine-compatible', evidenceId: 'move:light-screen-other' },
    ])
    expect(result.parentSnapshotDefinitionSha256s).toEqual(parents.map(parent => parent.definitionSha256))
    expect(result.candidateSetDefinitionSha256).toBe(hashDefinition(result.candidates))
    expect(result).toMatchObject({
      offspringSpeciesId: 'bulbasaur',
      compiledRegistryDefinitionSha256: registry.definitionSha256,
      canonicalIdDefinitionSha256: canonicalIds.definitionSha256,
      policyDefinitionSha256: policy.definitionSha256,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.candidates)).toBe(true)
    expect(Object.isFrozen(result.candidates[0]!.sources)).toBe(true)
  })

  it('returns a resolved empty immutable set when no effectively known Move uses an allowed child pathway', () => {
    const result = buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(),
      parentSnapshots: [
        snapshot('sheet:bulbasaur-f', 'bulbasaur', [effectiveMove('tackle', 'move:tackle')]),
        snapshot('sheet:ivysaur-m', 'ivysaur', [effectiveMove('growl', 'move:growl')]),
      ],
    })
    expect(result).toMatchObject({ status: 'resolved', candidates: [] })
    expect(result.candidateSetDefinitionSha256).toBe(hashDefinition([]))
    expect(Object.isFrozen(result.candidates)).toBe(true)
  })

  it('fails closed on unknown canonical IDs, duplicate provenance, and closed limits', () => {
    const valid = snapshot('sheet:parent', 'bulbasaur', [effectiveMove('amnesia', 'evidence:a')])
    const unknownMove = {
      ...valid,
      effectiveKnownMoves: [{ ...valid.effectiveKnownMoves[0], moveId: 'not-a-canonical-move' }],
    } as any
    expect(buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(), parentSnapshots: [unknownMove, parentSnapshots()[1]],
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.unknown-move-id'] })

    const duplicateMove = {
      ...valid,
      effectiveKnownMoves: [valid.effectiveKnownMoves[0], valid.effectiveKnownMoves[0]],
    } as any
    expect(buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(), parentSnapshots: [duplicateMove, parentSnapshots()[1]],
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.provenance-conflict'] })

    const tooMany = {
      ...valid,
      effectiveKnownMoves: Array.from({ length: BREEDING_INHERITANCE_LIMITS.effectiveMovesPerParent + 1 }, () => valid.effectiveKnownMoves[0]),
    } as any
    expect(buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(), parentSnapshots: [tooMany, parentSnapshots()[1]],
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.limit-exceeded'] })
  })

  it('rejects duplicate parent identity, unavailable parent specs, and Family-inconsistent snapshots', () => {
    const parents = parentSnapshots()
    expect(buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(), parentSnapshots: [parents[0], { ...parents[1], parentRef: parents[0].parentRef } as any],
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.parent-snapshot-invalid'] })

    expect(buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(),
      parentSnapshots: [snapshot('sheet:mew', 'mew', []), parents[1]],
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.parent-spec-unavailable'] })

    const mismatched = [
      snapshot('sheet:abra-f', 'abra', []),
      snapshot('sheet:kadabra-m', 'kadabra', []),
    ] as const
    expect(buildBreedingInheritanceCandidates({
      offspring: resolvedBulbasaur(), parentSnapshots: mismatched,
    })).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.parent-family-inconsistent'] })
  })

  it('rejects stale/unresolved offspring authority and remains deterministic after source mutations', () => {
    const parents = parentSnapshots()
    const resolved = resolvedBulbasaur()
    const stale = resolved.status === 'resolved'
      ? { ...resolved, compiledRegistryDefinitionSha256: '0'.repeat(64) }
      : resolved
    expect(buildBreedingInheritanceCandidates({ offspring: stale as any, parentSnapshots: parents }))
      .toMatchObject({ status: 'unavailable', reasonIds: ['breeding.inheritance.offspring-unavailable'] })

    const first = buildBreedingInheritanceCandidates({ offspring: resolved, parentSnapshots: parents })
    const second = buildBreedingInheritanceCandidates({ offspring: resolved, parentSnapshots: parents })
    expect(second).toEqual(first)
  })
})
