import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingAbilityId,
  BreedingEggGroupId,
  BreedingMoveId,
  BreedingSpeciesId,
} from '#shared/breeding/ids'
import {
  BreedingCampaignOptionValidationError,
  parseBreedingCampaignOptionSnapshotV1,
  resolveBreedingCampaignOptionSnapshot,
} from '../../server/domain/breeding/campaignOptions'
import {
  BREEDING_CANONICAL_MOVES,
  canonicalBreedingMoveIdentity,
} from '../../server/domain/breeding/canonicalIds'
import {
  evaluateBreedingCompatibility,
  type BreedingCompatibilityParentFacts,
} from '../../server/domain/breeding/compatibility'
import {
  resolveBreedingBabyTemplate,
  resolveBreedingHatchDuration,
  resolveBreedingHatchSpecial,
  resolveBreedingHatchStartingLevel,
} from '../../server/domain/breeding/eggRuleHelpers'
import {
  BreedingInheritanceSnapshotValidationError,
  buildBreedingInheritanceCandidates,
  createBreedingInheritanceParentSnapshot,
  parseBreedingInheritanceParentSnapshot,
  type BreedingEffectiveKnownMoveSnapshot,
} from '../../server/domain/breeding/inheritanceCandidates'
import { breedingNatureForOrderedDice } from '../../server/domain/breeding/natures'
import { resolveBreedingOffspring, type BreedingOffspringResolutionResult } from '../../server/domain/breeding/offspringResolution'
import {
  COMPILED_BREEDING_FAMILIES,
  COMPILED_BREEDING_FAMILY_COUNT,
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  COMPILED_BREEDING_SPECIES,
  COMPILED_BREEDING_SPECIES_COUNT,
  compiledBreedingSpeciesSpec,
} from '../../server/domain/breeding/registry'
import { resolveBreedingTraits } from '../../server/domain/breeding/traitResolution'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const hashDefinition = (value: unknown): string => sha256(stableJsonStringify(value))
const report = readJson<Record<string, any>>('data/breeding-automation/pure-rules-conformance.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const fixture = readJson<Record<string, any>>('data/breeding-automation/fixtures/inheritance-incubation-and-special.json')
const OPTION = 'option:v1:fedcba9876543210fedcba9876543210' as const

const parent = (
  parentRef: string,
  speciesId: BreedingSpeciesId,
  genderId: 'female' | 'male' | 'genderless',
  eggGroupIds: readonly BreedingEggGroupId[],
): BreedingCompatibilityParentFacts => ({
  parentRef,
  speciesId,
  genderId,
  level: 100,
  eggGroupIds,
  gmMaturityConfirmed: true,
})
const effectiveMove = (moveId: BreedingMoveId, evidenceId: string): BreedingEffectiveKnownMoveSnapshot => ({
  moveId,
  evidence: [{
    evidenceId,
    sourceKind: 'sheet-known-move',
    sourceId: `sheet-move:${evidenceId}`,
    sourceDefinitionSha256: 'a'.repeat(64),
  }],
})
const bulbasaurContext = () => {
  const options = resolveBreedingCampaignOptionSnapshot()
  const parents = [
    parent('sheet:bulbasaur-f', 'bulbasaur' as BreedingSpeciesId, 'female', ['monster', 'plant'] as BreedingEggGroupId[]),
    parent('sheet:bulbasaur-m', 'bulbasaur' as BreedingSpeciesId, 'male', ['monster', 'plant'] as BreedingEggGroupId[]),
  ] as const
  const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
  const offspring = resolveBreedingOffspring({
    parents, options, compatibility, familyRoll: 5, familyChoice: null, speciesOverride: null,
  })
  return { options, parents, compatibility, offspring }
}
const fullPipeline = () => {
  const context = bulbasaurContext()
  const traits = resolveBreedingTraits({
    offspring: context.offspring,
    pokemonEducationRank: 'Untrained',
    natureRoll: { firstDie: 2, secondDie: 3 },
    natureChoice: null,
    abilityRoll: 2,
    abilityChoice: null,
    genderRoll: 13,
    genderChoice: null,
  })
  const parentSnapshots = [
    createBreedingInheritanceParentSnapshot({
      schemaVersion: 1,
      parentRef: context.parents[0].parentRef,
      speciesId: context.parents[0].speciesId,
      sourceSheetSha256: 'b'.repeat(64),
      effectiveKnownMoves: [effectiveMove('light-screen' as BreedingMoveId, 'parent-0:light-screen')],
    }),
    createBreedingInheritanceParentSnapshot({
      schemaVersion: 1,
      parentRef: context.parents[1].parentRef,
      speciesId: context.parents[1].speciesId,
      sourceSheetSha256: 'c'.repeat(64),
      effectiveKnownMoves: [
        effectiveMove('light-screen' as BreedingMoveId, 'parent-1:light-screen'),
        effectiveMove('solar-beam' as BreedingMoveId, 'parent-1:solar-beam'),
      ],
    }),
  ] as const
  return Object.freeze({
    options: context.options,
    compatibility: context.compatibility,
    offspring: context.offspring,
    traits,
    inheritance: buildBreedingInheritanceCandidates({ offspring: context.offspring, parentSnapshots }),
    duration: resolveBreedingHatchDuration({
      speciesId: 'bulbasaur' as BreedingSpeciesId,
      sourceKind: 'breeding',
      options: context.options,
      durationOverride: null,
      variationRoll: null,
      gmTarget: null,
    }),
    startingLevel: resolveBreedingHatchStartingLevel('breeding', context.options),
    babyTemplate: resolveBreedingBabyTemplate(context.options, null),
    special: resolveBreedingHatchSpecial(context.options, { rollId: 'roll:special:42', total: 42 }, null),
  })
}

const xorshift32 = (initial: number) => {
  let state = initial >>> 0
  return (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

describe('breeding pure-rules conformance and deterministic replay', () => {
  it('binds the declared exhaustive, boundary, fuzz, fixture, and replay matrix to current rules', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportId: 'ptu-1.05-breeding-pure-rules-conformance-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(report.definitionSha256).toBe(hashDefinition(report.definition))
    expect(report.definition.graphCoverage).toMatchObject({
      familyCount: COMPILED_BREEDING_FAMILY_COUNT,
      speciesCount: COMPILED_BREEDING_SPECIES_COUNT,
    })
    expect(report.definition.fuzzing).toMatchObject({ seedUnsigned32: 3_221_344_269, iterations: 2_048 })
    expect(report.definition.deterministicReplay.iterations).toBe(100)
    expect(report.definition.bindings.compiledRegistryDefinitionSha256).toBe(COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256)
    expect(report.definition.fixtureExamples.flatMap((row: any) => row.fixtureId)).toContain(fixture.fixtureId)
  })

  it('exhaustively proves compiled Family DAG closure, reachability, roots, membership, and self-hashes', () => {
    expect(COMPILED_BREEDING_FAMILIES).toHaveLength(407)
    expect(COMPILED_BREEDING_SPECIES).toHaveLength(862)
    const allSpecies = new Set(COMPILED_BREEDING_SPECIES.map(spec => spec.speciesId))
    for (const family of COMPILED_BREEDING_FAMILIES) {
      const { definitionSha256, ...definition } = family
      expect(hashDefinition(definition), family.familyId).toBe(definitionSha256)
      expect(family.memberSpeciesIds).toContain(family.familyRootSpeciesId)
      expect(family.memberSpeciesIds).toContain(family.offspringRootSpeciesId)
      expect(family.formPolicies.find(row => row.speciesId === family.offspringRootSpeciesId)?.formPolicyId, family.familyId)
        .toBe('own-form-root')
      const members = new Set(family.memberSpeciesIds)
      expect(members.size, family.familyId).toBe(family.memberSpeciesIds.length)
      for (const member of members) {
        expect(allSpecies.has(member), `${family.familyId}:${member}`).toBe(true)
        expect(compiledBreedingSpeciesSpec(member)?.familyId).toBe(family.familyId)
      }
      const outgoing = new Map<string, string[]>()
      for (const edge of family.evolutionEdges) {
        expect(members.has(edge.fromSpeciesId), `${family.familyId}:${edge.fromSpeciesId}`).toBe(true)
        expect(members.has(edge.toSpeciesId), `${family.familyId}:${edge.toSpeciesId}`).toBe(true)
        outgoing.set(edge.fromSpeciesId, [...(outgoing.get(edge.fromSpeciesId) ?? []), edge.toSpeciesId])
      }
      const visiting = new Set<string>()
      const visited = new Set<string>()
      const visit = (id: string): void => {
        expect(visiting.has(id), `${family.familyId} cycle at ${id}`).toBe(false)
        if (visited.has(id)) return
        visiting.add(id)
        for (const next of outgoing.get(id) ?? []) visit(next)
        visiting.delete(id)
        visited.add(id)
      }
      visit(family.familyRootSpeciesId)
      expect(visited, family.familyId).toEqual(members)
    }
    for (const spec of COMPILED_BREEDING_SPECIES) {
      const { definitionSha256, ...definition } = spec
      expect(hashDefinition(definition), spec.speciesId).toBe(definitionSha256)
    }
  })

  it('exhaustively resolves every producible compiled Species through its Family and trait rules', () => {
    const options = resolveBreedingCampaignOptionSnapshot({ 'breeding.form-root-policy': 'gm-species-override' })
    let resolvedSpecies = 0
    for (const family of COMPILED_BREEDING_FAMILIES) {
      const root = compiledBreedingSpeciesSpec(family.familyRootSpeciesId)!
      if (root.speciesId === 'ditto') continue
      const parents = root.genderPolicy.kind === 'ratio'
        ? [
            parent(`parent:${root.speciesId}:f`, root.speciesId, 'female', root.eggGroupIds),
            parent(`parent:${root.speciesId}:m`, root.speciesId, 'male', root.eggGroupIds),
          ] as const
        : [
            parent(`parent:${root.speciesId}:ditto`, 'ditto' as BreedingSpeciesId, 'genderless', ['ditto'] as BreedingEggGroupId[]),
            parent(`parent:${root.speciesId}:self`, root.speciesId, 'genderless', root.eggGroupIds),
          ] as const
      const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
      expect(compatibility.status, family.familyId).toBe('compatible')
      for (const speciesId of family.memberSpeciesIds) {
        const offspring = resolveBreedingOffspring({
          parents,
          options,
          compatibility,
          familyRoll: root.genderPolicy.kind === 'ratio' ? 5 : null,
          familyChoice: null,
          speciesOverride: { optionId: OPTION, speciesId, evidenceId: `form:${speciesId}` },
        })
        expect(offspring.status, speciesId).toBe('resolved')
        if (offspring.status !== 'resolved') continue
        expect(offspring.offspringSpeciesId).toBe(speciesId)
        const spec = compiledBreedingSpeciesSpec(speciesId)!
        for (let abilityRoll = 1; abilityRoll <= spec.basicAbilityIds.length; abilityRoll += 1) {
          const traits = resolveBreedingTraits({
            offspring,
            pokemonEducationRank: 'Untrained',
            natureRoll: { firstDie: 1, secondDie: 1 },
            natureChoice: null,
            abilityRoll,
            abilityChoice: null,
            genderRoll: spec.genderPolicy.kind === 'ratio' ? 1 : null,
            genderChoice: null,
          })
          expect(traits.status, `${speciesId}:ability:${abilityRoll}`).toBe('resolved')
          if (traits.status === 'resolved') expect(traits.ability.id).toBe(spec.basicAbilityIds[abilityRoll - 1])
        }
        resolvedSpecies += 1
      }
    }
    expect(resolvedSpecies).toBe(COMPILED_BREEDING_SPECIES_COUNT - 1)
  })

  it('exhausts d20, ordered 2d6, d100, and 50–200 duration boundaries', () => {
    const options = resolveBreedingCampaignOptionSnapshot()
    const parents = [
      parent('sheet:abra-f', 'abra' as BreedingSpeciesId, 'female', ['humanshape'] as BreedingEggGroupId[]),
      parent('sheet:machop-m', 'machop' as BreedingSpeciesId, 'male', ['humanshape'] as BreedingEggGroupId[]),
    ] as const
    const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
    for (let roll = 1; roll <= 20; roll += 1) {
      expect(resolveBreedingOffspring({
        parents, options, compatibility, familyRoll: roll, familyChoice: null, speciesOverride: null,
      })).toMatchObject({
        status: 'resolved',
        selectedRoleId: roll <= 4 ? 'male-parent' : 'female-parent',
        selectedFamilyId: roll <= 4 ? 'family:machop' : 'family:abra',
      })
    }

    const natureIds = new Set<string>()
    for (let firstDie = 1; firstDie <= 6; firstDie += 1) {
      for (let secondDie = 1; secondDie <= 6; secondDie += 1) {
        natureIds.add(breedingNatureForOrderedDice(firstDie, secondDie)!.id)
      }
    }
    expect(natureIds.size).toBe(36)

    const bulbasaur = bulbasaurContext().offspring
    let female = 0
    for (let roll = 1; roll <= 100; roll += 1) {
      const traits = resolveBreedingTraits({
        offspring: bulbasaur,
        pokemonEducationRank: 'Untrained',
        natureRoll: { firstDie: 1, secondDie: 1 },
        natureChoice: null,
        abilityRoll: 1,
        abilityChoice: null,
        genderRoll: roll,
        genderChoice: null,
      })
      expect(traits.status, `gender:${roll}`).toBe('resolved')
      if (traits.status === 'resolved' && traits.gender.id === 'female') female += 1
      const special = resolveBreedingHatchSpecial(options, { rollId: `roll:special:${roll}`, total: roll }, null)
      expect(special.status, `special:${roll}`).toBe('resolved')
      if (special.status === 'resolved') expect(special.isSpecial).toBe(roll === 1 || roll === 100)
    }
    expect(female).toBe(12)

    const durationOptions = resolveBreedingCampaignOptionSnapshot({
      'breeding.hatch-duration-variation': 'server-random-half-to-double',
    })
    let previous = 0
    for (let percent = 50; percent <= 200; percent += 1) {
      const result = resolveBreedingHatchDuration({
        speciesId: 'bulbasaur' as BreedingSpeciesId,
        sourceKind: 'breeding',
        options: durationOptions,
        durationOverride: null,
        variationRoll: { rollId: `roll:duration:${percent}`, total: percent },
        gmTarget: null,
      })
      expect(result.status, `duration:${percent}`).toBe('resolved')
      if (result.status !== 'resolved') continue
      expect(result.targetCampaignMinutes).toBe(Math.ceil(14_400 * percent / 100))
      expect(result.targetCampaignMinutes).toBeGreaterThanOrEqual(previous)
      previous = result.targetCampaignMinutes
    }
    expect(previous).toBe(28_800)
  })

  it('executes the synthetic inheritance/source-gap and special examples with exact canonical identities', () => {
    const bySourceName = new Map(BREEDING_CANONICAL_MOVES.map(row => [row.sourceName, row.id]))
    const fixtureParents = fixture.entities.parents as Array<Record<string, any>>
    expect(fixtureParents.flatMap(row => row.effectiveKnownMoveNames)).toContain('Facade')
    expect(bySourceName.has('Facade')).toBe(false)
    expect(canonicalBreedingMoveIdentity('facade')).toMatchObject({ id: 'facade', sourceName: 'Façade' })
    expect(compiledBreedingSpeciesSpec('bulbasaur')!.machineCompatibleMoveIds).not.toContain('facade')
    const snapshots = fixtureParents.map((row, parentIndex) => createBreedingInheritanceParentSnapshot({
      schemaVersion: 1,
      parentRef: row.id,
      speciesId: 'bulbasaur' as BreedingSpeciesId,
      sourceSheetSha256: String(parentIndex + 1).repeat(64),
      effectiveKnownMoves: row.effectiveKnownMoveNames.flatMap((name: string) => {
        const moveId = bySourceName.get(name)
        return moveId ? [effectiveMove(moveId, `${row.id}:${moveId}`)] : []
      }),
    })) as [ReturnType<typeof createBreedingInheritanceParentSnapshot>, ReturnType<typeof createBreedingInheritanceParentSnapshot>]
    const offspring = bulbasaurContext().offspring
    const inheritance = buildBreedingInheritanceCandidates({ offspring, parentSnapshots: snapshots })
    expect(inheritance.status).toBe('resolved')
    if (inheritance.status === 'resolved') {
      expect(inheritance.candidates.map(candidate => candidate.moveId)).toEqual(['giga-drain', 'light-screen', 'solar-beam'])
      expect(inheritance.candidates.find(candidate => candidate.moveId === 'light-screen')!.sources).toHaveLength(4)
      expect(inheritance.candidates.some(candidate => candidate.moveId === 'facade')).toBe(false)
    }
    expect(resolveBreedingHatchSpecial(defaultOptionsForFixture(), { rollId: 'fixture:special:1', total: 1 }, null)).toMatchObject({
      status: 'resolved', isSpecial: true, workflow: 'bounded-gm-adjudication-pending', automaticShiny: false,
    })
  })

  it('fuzzes strict snapshots and identity boundaries with a fixed 2,048-case seed', () => {
    const next = xorshift32(report.definition.fuzzing.seedUnsigned32)
    const options = resolveBreedingCampaignOptionSnapshot()
    const validParent = createBreedingInheritanceParentSnapshot({
      schemaVersion: 1,
      parentRef: 'sheet:fuzz-parent',
      speciesId: 'bulbasaur' as BreedingSpeciesId,
      sourceSheetSha256: 'd'.repeat(64),
      effectiveKnownMoves: [effectiveMove('light-screen' as BreedingMoveId, 'fuzz:light-screen')],
    })
    const counts = [0, 0, 0, 0]
    for (let index = 0; index < report.definition.fuzzing.iterations; index += 1) {
      const target = next() % 4
      counts[target] += 1
      if (target === 0) {
        const corruption = next() % 4
        const malformed: any = corruption === 0
          ? { ...options, definitionSha256: (next() >>> 0).toString(16).padStart(64, '0') }
          : corruption === 1
            ? { ...options, schemaVersion: 2 }
            : corruption === 2
              ? { ...options, values: { ...options.values, fuzzUnknown: next() } }
              : null
        expect(() => parseBreedingCampaignOptionSnapshotV1(malformed)).toThrow(BreedingCampaignOptionValidationError)
      }
      else if (target === 1) {
        const randomId = `fuzz-${(next() >>> 0).toString(16)}-${index}`
        expect(canonicalBreedingMoveIdentity(randomId)).toBeNull()
      }
      else if (target === 2) {
        const corruption = next() % 4
        const malformed: any = corruption === 0
          ? { ...validParent, definitionSha256: '0'.repeat(64) }
          : corruption === 1
            ? { ...validParent, effectiveKnownMoves: [{ ...validParent.effectiveKnownMoves[0], moveId: `fuzz-${next()}` }] }
            : corruption === 2
              ? { ...validParent, legacyEggMoves: [] }
              : { ...validParent, sourceSheetSha256: 'not-a-hash' }
        expect(() => parseBreedingInheritanceParentSnapshot(malformed)).toThrow(BreedingInheritanceSnapshotValidationError)
      }
      else {
        const stale = { ...options, definitionSha256: (next() >>> 0).toString(16).padStart(64, '0') }
        expect(resolveBreedingBabyTemplate(stale, null).status).toBe('unavailable')
        expect(resolveBreedingHatchSpecial(stale, { rollId: `fuzz:roll:${index}`, total: 50 }, null).status).toBe('unavailable')
      }
    }
    expect(counts.reduce((total, value) => total + value, 0)).toBe(2_048)
    expect(counts.every(value => value > 400)).toBe(true)
  })

  it('replays the complete pure pipeline 100 times with equal output, hashes, and unchanged inputs', () => {
    const baseline = fullPipeline()
    const serialized = stableJsonStringify(baseline)
    expect(Object.values(baseline).every(value => value !== null)).toBe(true)
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const replay = fullPipeline()
      expect(replay).toEqual(baseline)
      expect(stableJsonStringify(replay)).toBe(serialized)
    }
    expect(stableJsonStringify(baseline)).toBe(serialized)
    expect((baseline.offspring as BreedingOffspringResolutionResult).status).toBe('resolved')
    expect(baseline.traits.status).toBe('resolved')
    expect(baseline.inheritance.status).toBe('resolved')
    expect(baseline.duration.status).toBe('resolved')
    expect(baseline.special.status).toBe('resolved')
  })
})

const defaultOptionsForFixture = () => resolveBreedingCampaignOptionSnapshot()
