import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { BreedingEggGroupId, BreedingMoveId, BreedingSpeciesId } from '../../shared/breeding/ids'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import { evaluateBreedingCompatibility, type BreedingCompatibilityParentFacts } from '../../server/domain/breeding/compatibility'
import { resolveBreedingHatchDuration, resolveBreedingHatchStartingLevel } from '../../server/domain/breeding/eggRuleHelpers'
import {
  buildBreedingInheritanceCandidates,
  createBreedingInheritanceParentSnapshot,
  type BreedingEffectiveKnownMoveSnapshot,
} from '../../server/domain/breeding/inheritanceCandidates'
import { resolveBreedingOffspring } from '../../server/domain/breeding/offspringResolution'
import {
  COMPILED_BREEDING_FAMILIES,
  COMPILED_BREEDING_SPECIES,
  COMPILED_BREEDING_SPECIES_COUNT,
  compiledBreedingSpeciesSpec,
} from '../../server/domain/breeding/registry'
import { resolveBreedingTraits } from '../../server/domain/breeding/traitResolution'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const report = readJson<Record<string, any>>('data/breeding-automation/whole-species-conformance.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const semanticClosure = readJson<Record<string, any>>('data/breeding-automation/semantic-closure-manifest.json')
const pureConformance = readJson<Record<string, any>>('data/breeding-automation/pure-rules-conformance.json')
const OPTION_ID = 'option:v1:81818181818181818181818181818181' as const

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
const knownMove = (moveId: BreedingMoveId, parentIndex: number): BreedingEffectiveKnownMoveSnapshot => ({
  moveId,
  evidence: [{
    evidenceId: `whole-species:${parentIndex}:${moveId}`,
    sourceKind: 'effective-provider',
    sourceId: `whole-species-provider:${parentIndex}`,
    sourceDefinitionSha256: String(parentIndex + 1).repeat(64),
  }],
})

describe('BR-081 whole-Species breeding conformance', () => {
  it('binds the current source, ruleset, closure, pure matrix, contracts, and evidence paths', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportId: 'ptu-1.05-breeding-whole-species-conformance-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      definitionSha256: hash(report.definition),
    })
    expect(report.definition).toMatchObject({ ticket: 'BR-081', status: 'certified' })
    expect(report.definition.bindings).toMatchObject({
      semanticClosureDefinitionSha256: semanticClosure.definitionSha256,
      pureRulesConformanceDefinitionSha256: pureConformance.definitionSha256,
    })
    expect(report.definition.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    expect(Object.values(report.definition.acceptance)).toEqual(Array(8).fill('pass'))
  })

  it('resolves every producible Species through compatibility, every Basic Ability, gender boundaries, inheritance, and hatch duration', () => {
    const options = resolveBreedingCampaignOptionSnapshot({ 'breeding.form-root-policy': 'gm-species-override' })
    let familyPairs = 0
    let speciesCases = 0
    let abilityCases = 0
    let inheritanceEggMoveIds = 0
    let inheritanceMachineMoveIds = 0
    let eggGroupMemberships = 0

    for (const family of COMPILED_BREEDING_FAMILIES) {
      const root = compiledBreedingSpeciesSpec(family.familyRootSpeciesId)!
      if (root.speciesId === 'ditto') continue
      const parents = root.genderPolicy.kind === 'ratio'
        ? [
            parent(`whole:${root.speciesId}:female`, root.speciesId, 'female', root.eggGroupIds),
            parent(`whole:${root.speciesId}:male`, root.speciesId, 'male', root.eggGroupIds),
          ] as const
        : [
            parent(`whole:${root.speciesId}:ditto`, 'ditto' as BreedingSpeciesId, 'genderless', ['ditto'] as BreedingEggGroupId[]),
            parent(`whole:${root.speciesId}:self`, root.speciesId, 'genderless', root.eggGroupIds),
          ] as const
      const compatibility = evaluateBreedingCompatibility({ parents, options, roleOverride: null })
      expect(compatibility.status, family.familyId).toBe('compatible')
      familyPairs += 1

      for (const speciesId of family.memberSpeciesIds) {
        const spec = compiledBreedingSpeciesSpec(speciesId)!
        const offspring = resolveBreedingOffspring({
          parents,
          options,
          compatibility,
          familyRoll: root.genderPolicy.kind === 'ratio' ? 5 : null,
          familyChoice: null,
          speciesOverride: { optionId: OPTION_ID, speciesId, evidenceId: `whole-species:${speciesId}` },
        })
        expect(offspring.status, speciesId).toBe('resolved')
        if (offspring.status !== 'resolved') continue
        expect(offspring.offspringSpeciesId).toBe(speciesId)

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
          abilityCases += 1
        }

        if (spec.genderPolicy.kind === 'ratio') {
          const boundaryRolls = [...new Set([1, Math.floor(spec.genderPolicy.femalePercent), Math.ceil(spec.genderPolicy.femalePercent), 100])]
            .filter(roll => roll >= 1 && roll <= 100)
          for (const genderRoll of boundaryRolls) {
            const traits = resolveBreedingTraits({
              offspring,
              pokemonEducationRank: 'Untrained',
              natureRoll: { firstDie: 6, secondDie: 6 },
              natureChoice: null,
              abilityRoll: 1,
              abilityChoice: null,
              genderRoll,
              genderChoice: null,
            })
            expect(traits.status, `${speciesId}:gender:${genderRoll}`).toBe('resolved')
            if (traits.status === 'resolved') {
              expect(traits.gender.id).toBe(genderRoll <= spec.genderPolicy.femalePercent ? 'female' : 'male')
            }
          }
        }

        const candidateMoveId = spec.eggMoveIds[0] ?? spec.machineCompatibleMoveIds[0] ?? null
        const effectiveKnownMoves = candidateMoveId ? [knownMove(candidateMoveId, 0)] : []
        const snapshots = parents.map((parentFacts, parentIndex) => createBreedingInheritanceParentSnapshot({
          schemaVersion: 1,
          parentRef: parentFacts.parentRef,
          speciesId: parentFacts.speciesId,
          sourceSheetSha256: String(parentIndex + 3).repeat(64),
          effectiveKnownMoves: effectiveKnownMoves.map(move => ({
            ...move,
            evidence: move.evidence.map(evidence => ({ ...evidence, evidenceId: `${evidence.evidenceId}:${parentIndex}` })),
          })),
        })) as [ReturnType<typeof createBreedingInheritanceParentSnapshot>, ReturnType<typeof createBreedingInheritanceParentSnapshot>]
        const inheritance = buildBreedingInheritanceCandidates({ offspring, parentSnapshots: snapshots })
        expect(inheritance.status, `${speciesId}:inheritance`).toBe('resolved')
        if (inheritance.status === 'resolved') {
          expect(inheritance.candidates.map(candidate => candidate.moveId)).toEqual(candidateMoveId ? [candidateMoveId] : [])
          if (candidateMoveId) {
            const pathways = Number(spec.eggMoveIds.includes(candidateMoveId)) + Number(spec.machineCompatibleMoveIds.includes(candidateMoveId))
            expect(inheritance.candidates[0]!.sources).toHaveLength(pathways * 2)
          }
        }

        const duration = resolveBreedingHatchDuration({
          speciesId,
          sourceKind: 'breeding',
          options,
          durationOverride: null,
          variationRoll: null,
          gmTarget: null,
        })
        expect(duration, `${speciesId}:duration`).toMatchObject({
          status: 'resolved',
          targetCampaignMinutes: spec.hatchCampaignMinutes,
          variationPolicyId: 'fixed-average',
        })
        expect(resolveBreedingHatchStartingLevel('breeding', options)).toMatchObject({ status: 'resolved', startingLevel: 1 })

        speciesCases += 1
        inheritanceEggMoveIds += spec.eggMoveIds.length
        inheritanceMachineMoveIds += spec.machineCompatibleMoveIds.length
        eggGroupMemberships += spec.eggGroupIds.length
      }
    }

    expect({ familyPairs, speciesCases, abilityCases, inheritanceEggMoveIds, inheritanceMachineMoveIds, eggGroupMemberships }).toEqual({
      familyPairs: report.definition.compatibility.representativeFamilyPairs,
      speciesCases: report.definition.compiledCoverage.producibleSpecies,
      abilityCases: report.definition.compiledCoverage.basicAbilityOptions,
      inheritanceEggMoveIds: report.definition.compiledCoverage.eggMoveIdentities,
      inheritanceMachineMoveIds: report.definition.compiledCoverage.machineCompatibleMoveIdentities,
      eggGroupMemberships: report.definition.compiledCoverage.eggGroupMemberships,
    })
  }, 30_000)

  it('retains exact Family graph, exclusion, ruleset-option, and hatch-policy closure totals', () => {
    const compilerReport = readJson<Record<string, any>>('data/breeding-automation/compiler-validation-report.json')
    expect(COMPILED_BREEDING_SPECIES).toHaveLength(COMPILED_BREEDING_SPECIES_COUNT)
    expect(COMPILED_BREEDING_FAMILIES.reduce((sum, family) => sum + family.evolutionEdges.length, 0))
      .toBe(report.definition.compiledCoverage.familyEvolutionEdges)
    expect(compilerReport.excludedSpecies).toHaveLength(report.definition.compiledCoverage.explicitlyExcludedSpecies)
    expect(ruleset.definition.campaignOptions).toHaveLength(report.definition.ruleset.campaignOptionCount)
    expect(new Set(ruleset.definition.campaignOptions.map((option: any) => option.id)).size)
      .toBe(report.definition.ruleset.campaignOptionCount)
    expect(report.definition.hatch).toMatchObject({
      lifecycleStatuses: 7,
      specialRollDomain: 100,
      specialTriggerTotals: [1, 100],
      automaticShiny: false,
      destinationKinds: ['box', 'team'],
    })
    expect(report.definition.determinism).toMatchObject({ purePipelineReplays: 100, fuzzCases: 2_048, result: 'pass' })
  })
})
