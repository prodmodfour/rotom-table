import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/breeding/egg-production-authority-v1.json'
import contract from '../../data/breeding-automation/parent-source-change-contract.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parsePokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  BreedingParentSourceChangeValidationError,
  parseBreedingParentSourceChangeEvidenceV1,
  parseBreedingParentSourceChangeImpactV1,
  type BreedingParentSourceChangeKindV1,
  type BreedingParentSourceFactV1,
} from '#shared/breeding/parentSourceChange'
import { parseBreedingProjectDocumentV1 } from '#shared/breeding/project'
import {
  BREEDING_PARENT_SOURCE_CHANGE_POLICY_DEFINITION_SHA256,
  BreedingParentSourceChangeAuthorityError,
  createBreedingParentSourceChangeEvidenceV1,
  evaluateAcceptedEggParentSourceChangeV1,
  evaluateBreedingProjectParentSourceChangeV1,
  parseAuthoritativeBreedingParentSourceChangeEvidenceV1,
  parseAuthoritativeBreedingParentSourceChangeImpactV1,
} from '../../server/domain/breeding/parentSourceChange'

const hash = (character: string): string => character.repeat(64)
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const changeId = (value: number): `breeding-parent-change:v1:${string}` => `breeding-parent-change:v1:${value.toString(16).padStart(32, '0')}`
const EGG_ID = 'pokemon-egg:v1:63636363636363636363636363636363'
const baseProject = () => parseBreedingProjectDocumentV1(structuredClone(fixture.project))
const prior = (): BreedingParentSourceFactV1 => ({
  pokemonSheetSlug: 'pokemon-parent-a',
  sheetRevision: 2,
  ownerTrainerSlug: 'trainer-owner',
  speciesId: 'bulbasaur',
  folder: 'team/garden',
  sourceSheetSha256: hash('2'),
  referenceSnapshotDefinitionSha256: hash('a'),
})
const nextFor = (kind: Exclude<BreedingParentSourceChangeKindV1, 'deletion'>): BreedingParentSourceFactV1 => {
  const current = prior()
  if (kind === 'source-reference-update') return { ...current, referenceSnapshotDefinitionSha256: hash('b') }
  const next = { ...current, sheetRevision: 3, sourceSheetSha256: hash('4') }
  if (kind === 'evolution') return { ...next, speciesId: 'ivysaur' }
  if (kind === 'trade') return { ...next, ownerTrainerSlug: 'trainer-recipient' }
  if (kind === 'rename') return { ...next, pokemonSheetSlug: 'garden-parent-renamed' }
  if (kind === 'folder-move') return { ...next, folder: 'box/retired' }
  return next
}
const change = (kind: BreedingParentSourceChangeKindV1, value = 1) => createBreedingParentSourceChangeEvidenceV1({
  changeId: changeId(value),
  changeKind: kind,
  prior: prior(),
  next: kind === 'deletion' ? null : nextFor(kind),
  observedAtCampaignMinute: 700,
})
const preCheckProject = () => {
  const project = structuredClone(fixture.project) as any
  project.revision = 1
  project.status = 'initial-time-in-progress'
  project.timeline = {
    initialRequiredCampaignMinutes: 240,
    initialAccumulatedCampaignMinutes: 120,
    additionalRequiredCampaignMinutes: 240,
    additionalAccumulatedCampaignMinutes: 0,
    initialStartedAtCampaignMinute: 0,
    checkReadyAtCampaignMinute: null,
    additionalStartedAtCampaignMinute: null,
    readyToProduceAtCampaignMinute: null,
    eggProducedAtCampaignMinute: null,
    lastAppliedClockRevision: 1,
    lastAppliedClockMinute: 120,
  }
  project.check = null
  project.producedEggId = null
  project.updatedAtCampaignMinute = 120
  project.statusChangedAtCampaignMinute = 0
  project.lastOperationId = operationId(2)
  return parseBreedingProjectDocumentV1(project)
}
const settledProject = () => {
  const project = structuredClone(fixture.project) as any
  project.revision = 3
  project.status = 'egg-produced'
  project.producedEggId = EGG_ID
  project.timeline.eggProducedAtCampaignMinute = 650
  project.updatedAtCampaignMinute = 650
  project.statusChangedAtCampaignMinute = 650
  project.lastOperationId = operationId(10)
  return parseBreedingProjectDocumentV1(project)
}
const terminalProject = () => {
  const project = structuredClone(preCheckProject()) as any
  project.revision = 2
  project.status = 'cancelled'
  project.terminal = {
    reasonId: 'breeding.project-terminal.cancelled-by-owner',
    atCampaignMinute: 650,
    operationId: operationId(11),
  }
  project.updatedAtCampaignMinute = 650
  project.statusChangedAtCampaignMinute = 650
  project.lastOperationId = operationId(11)
  return parseBreedingProjectDocumentV1(project)
}
const acceptedEgg = () => parsePokemonEggDocumentV1({
  schemaVersion: 1,
  eggId: EGG_ID,
  revision: 0,
  status: 'incubating',
  ownerTrainerSlug: 'trainer-owner',
  source: { kind: 'breeding', projectId: fixture.project.projectId },
  ruleset: fixture.project.ruleset,
  definitionHashes: [hash('1'), hash('2')],
  parents: structuredClone(fixture.parents),
  breeder: structuredClone(fixture.breeder),
  offspring: {
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: 'bulbasaur',
    speciesSpecDefinitionSha256: fixture.parents[0]!.speciesSpecDefinitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: 'overgrow', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    providerTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null },
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
    definitionSha256: hash('5'),
  },
  incubation: {
    averageCampaignMinutes: 600,
    targetCampaignMinutes: 600,
    accumulatedCampaignMinutes: 100,
    variationPolicyId: 'fixed-average',
    durationResultDefinitionSha256: hash('6'),
    lastAppliedClockRevision: 2,
    lastAppliedClockMinute: 600,
    readyAtCampaignMinute: null,
    readinessKind: null,
    readyOperationId: null,
    paused: false,
    pauseReasonId: null,
    pauseOperationId: null,
  },
  special: {
    state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [],
    adjudicationId: null, outcomeId: null, automaticShiny: false,
  },
  hatchOperationId: null,
  childSheetSlug: null,
  terminal: null,
  createdAtCampaignMinute: 600,
  updatedAtCampaignMinute: 600,
  statusChangedAtCampaignMinute: 600,
  lastOperationId: operationId(9),
})

const ALL_KINDS = [
  'evolution', 'trade', 'rename', 'folder-move', 'deletion', 'retraining', 'source-reference-update',
] as const

describe('BR-063 parent and source checkpoint policy', () => {
  it('binds a stable closed policy definition and reviewed contract', () => {
    expect(createHash('sha256').update(stableJsonStringify(contract.definition)).digest('hex')).toBe(contract.definitionSha256)
    expect(contract.definition.bindings.runtimePolicyDefinitionSha256).toBe(BREEDING_PARENT_SOURCE_CHANGE_POLICY_DEFINITION_SHA256)
    expect(contract.definition.changeKinds).toEqual(ALL_KINDS)
  })

  it('accepts exactly the seven semantic before/after deltas and rejects malformed, enriched, or hash-drifted evidence', () => {
    for (const [index, kind] of ALL_KINDS.entries()) {
      const evidence = change(kind, index + 1)
      expect(parseBreedingParentSourceChangeEvidenceV1(evidence)).toEqual(evidence)
      expect(parseAuthoritativeBreedingParentSourceChangeEvidenceV1(evidence)).toEqual(evidence)
    }
    expect(() => createBreedingParentSourceChangeEvidenceV1({
      changeId: changeId(20), changeKind: 'evolution', prior: prior(), next: nextFor('retraining'), observedAtCampaignMinute: 700,
    })).toThrow(BreedingParentSourceChangeAuthorityError)
    expect(() => parseBreedingParentSourceChangeEvidenceV1({ ...change('deletion'), extra: true })).toThrow(BreedingParentSourceChangeValidationError)
    expect(() => parseAuthoritativeBreedingParentSourceChangeEvidenceV1({ ...change('rename'), definitionSha256: hash('f') })).toThrow(BreedingParentSourceChangeAuthorityError)
    expect(() => parseBreedingParentSourceChangeEvidenceV1(Object.defineProperty({ ...change('trade') }, 'changeKind', { enumerable: true, get: () => 'trade' }))).toThrow(BreedingParentSourceChangeValidationError)
  })

  it('interrupts only revision-refreshable pre-check changes and requires complete revalidation and consent renewal', () => {
    for (const kind of ['evolution', 'folder-move', 'retraining'] as const) {
      const impact = evaluateBreedingProjectParentSourceChangeV1({ project: preCheckProject(), change: change(kind), evaluatedAtCampaignMinute: 700 })
      expect(impact).toMatchObject({
        checkpoint: 'project-pre-check', disposition: 'interrupt-refresh-and-revalidate',
        aggregateMutation: 'none', creditedProgress: 'preserve-no-new-credit',
        consent: 'renew-current-parent-revision-required', acceptedSnapshot: 'not-yet-created',
        reasonId: 'breeding.parent-change.pre-check-refresh-required',
      })
      expect(parseBreedingParentSourceChangeImpactV1(impact)).toEqual(impact)
    }
  })

  it('blocks rename, trade, deletion, and reference reinterpretation even before the check', () => {
    for (const kind of ['rename', 'trade', 'deletion', 'source-reference-update'] as const) {
      expect(evaluateBreedingProjectParentSourceChangeV1({
        project: preCheckProject(), change: change(kind), evaluatedAtCampaignMinute: 700,
      })).toMatchObject({
        checkpoint: 'project-pre-check-unrefreshable',
        disposition: 'block-until-cancel-or-reviewed-migration',
        aggregateMutation: 'none',
        consent: 'cannot-substitute-for-new-project',
        reasonId: 'breeding.parent-change.active-project-blocked',
      })
    }
  })

  it('blocks every parent or source change after the successful check without erasing credited progress', () => {
    for (const kind of ALL_KINDS) {
      expect(evaluateBreedingProjectParentSourceChangeV1({
        project: baseProject(), change: change(kind), evaluatedAtCampaignMinute: 700,
      })).toMatchObject({
        checkpoint: 'project-post-check',
        disposition: 'block-until-cancel-or-reviewed-migration',
        creditedProgress: 'preserve-no-new-credit', aggregateMutation: 'none',
      })
    }
  })

  it('preserves settled and terminal Projects without reopening or rewriting either checkpoint', () => {
    expect(evaluateBreedingProjectParentSourceChangeV1({
      project: settledProject(), change: change('deletion'), evaluatedAtCampaignMinute: 700,
    })).toMatchObject({ checkpoint: 'project-settled-with-egg', disposition: 'preserve-settled-project', acceptedSnapshot: 'immutable-preserved' })
    expect(evaluateBreedingProjectParentSourceChangeV1({
      project: terminalProject(), change: change('retraining'), evaluatedAtCampaignMinute: 700,
    })).toMatchObject({ checkpoint: 'project-terminal', disposition: 'preserve-terminal-project', acceptedSnapshot: 'not-applicable' })
  })

  it('preserves an accepted Egg byte-for-byte for every later parent and source change', () => {
    const egg = acceptedEgg()
    const before = stableJsonStringify(egg)
    for (const kind of ALL_KINDS) {
      expect(evaluateAcceptedEggParentSourceChangeV1({ egg, change: change(kind), evaluatedAtCampaignMinute: 700 })).toMatchObject({
        checkpoint: 'accepted-egg', disposition: 'preserve-immutable-egg', aggregateMutation: 'none',
        acceptedSnapshot: 'immutable-preserved', incubation: 'preserve-current-explicit-state',
        hatchEligibility: 'preserve-status-derived-eligibility',
        reasonId: 'breeding.parent-change.accepted-egg-preserved',
      })
      expect(stableJsonStringify(egg)).toBe(before)
    }
  })

  it('fails closed on wrong source checkpoints, stale time, and tampered impact hashes', () => {
    const wrong = change('retraining')
    const mismatched = createBreedingParentSourceChangeEvidenceV1({
      changeId: changeId(30), changeKind: 'retraining',
      prior: { ...wrong.prior, sheetRevision: 99 },
      next: { ...wrong.next!, sheetRevision: 100 },
      observedAtCampaignMinute: 700,
    })
    expect(() => evaluateBreedingProjectParentSourceChangeV1({ project: preCheckProject(), change: mismatched, evaluatedAtCampaignMinute: 700 })).toThrow(BreedingParentSourceChangeAuthorityError)
    expect(() => evaluateAcceptedEggParentSourceChangeV1({ egg: acceptedEgg(), change: mismatched, evaluatedAtCampaignMinute: 700 })).toThrow(BreedingParentSourceChangeAuthorityError)
    expect(() => evaluateAcceptedEggParentSourceChangeV1({ egg: acceptedEgg(), change: change('deletion'), evaluatedAtCampaignMinute: 699 })).toThrow(BreedingParentSourceChangeAuthorityError)
    const impact = evaluateAcceptedEggParentSourceChangeV1({ egg: acceptedEgg(), change: change('deletion'), evaluatedAtCampaignMinute: 700 })
    expect(() => parseAuthoritativeBreedingParentSourceChangeImpactV1({ ...impact, definitionSha256: createHash('sha256').update('tampered').digest('hex') })).toThrow(BreedingParentSourceChangeAuthorityError)
    expect(() => parseBreedingParentSourceChangeImpactV1({ ...impact, disposition: 'preserve-terminal-project' })).toThrow(BreedingParentSourceChangeValidationError)
  })
})
