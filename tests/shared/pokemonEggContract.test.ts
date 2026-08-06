import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  POKEMON_EGG_ACTIVE_STATUSES,
  POKEMON_EGG_SETTLED_STATUSES,
  POKEMON_EGG_STATUSES,
  POKEMON_EGG_TERMINAL_NON_HATCH_STATUSES,
  PokemonEggValidationError,
  isPokemonEggSettledStatus,
  isPokemonEggStatus,
  parsePokemonEggDocumentV1,
  type PokemonEggDocumentV1,
  type PokemonEggStatus,
} from '../../shared/breeding/egg'
import {
  POKEMON_EGG_SPECIAL_TRANSITIONS,
  POKEMON_EGG_TRANSITIONS,
  PokemonEggTransitionError,
  isPokemonEggStatusTransitionAllowed,
  validatePokemonEggRevisionSuccessor,
} from '../../server/domain/breeding/eggLifecycle'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/egg-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const roll = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const EGG_ID = 'pokemon-egg:v1:11111111111111111111111111111111'
const PROJECT_ID = 'breeding-project:v1:22222222222222222222222222222222'

const evidence = (parentIndex: 0 | 1) => ({
  evidenceId: `parent-${parentIndex}:light-screen`,
  sourceKind: 'sheet-known-move',
  sourceId: `sheet-move:parent-${parentIndex}:light-screen`,
  sourceDefinitionSha256: 'b'.repeat(64),
})
const parentSnapshot = (parentIndex: 0 | 1) => ({
  schemaVersion: 1,
  parentIndex,
  pokemonSheetSlug: `pokemon-parent-${parentIndex}`,
  displayNameAtSnapshot: `Parent ${parentIndex + 1}`,
  ownerTrainerSlug: 'trainer-owner',
  sheetRevision: parentIndex + 3,
  sourceSheetSha256: String(parentIndex + 1).repeat(64),
  speciesId: 'bulbasaur',
  familyRootSpeciesId: 'bulbasaur',
  speciesSpecDefinitionSha256: '3'.repeat(64),
  genderId: parentIndex === 0 ? 'female' : 'male',
  roleId: parentIndex === 0 ? 'female-parent' : 'male-parent',
  roleEvidenceDefinitionSha256: '4'.repeat(64),
  level: 25,
  maturity: {
    policyId: 'minimum-level', minimumLevel: 20, gmConfirmed: null, eligible: true,
    evidenceDefinitionSha256: '5'.repeat(64),
  },
  eggGroupIds: ['monster', 'plant'],
  effectiveKnownMoves: [{ moveId: 'light-screen', evidence: [evidence(parentIndex)] }],
  effectiveMoveSnapshotDefinitionSha256: String(parentIndex + 6).repeat(64),
  controlEvidenceDefinitionSha256: '8'.repeat(64),
  capturedAtCampaignMinute: 95,
  definitionSha256: String(parentIndex + 7).repeat(64),
})
const baseValue = (): Record<string, any> => ({
  schemaVersion: 1,
  eggId: EGG_ID,
  revision: 0,
  status: 'incubating',
  ownerTrainerSlug: 'trainer-owner',
  source: { kind: 'breeding', projectId: PROJECT_ID },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  definitionHashes: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
  parents: [parentSnapshot(0), parentSnapshot(1)],
  breeder: {
    schemaVersion: 1,
    trainerSheetSlug: 'trainer-breeder',
    sheetRevision: 7,
    sourceSheetSha256: '7'.repeat(64),
    pokemonEducationRank: 'Expert',
    permissionEvidenceIds: ['edge:breeder'],
    providerSnapshotDefinitionSha256: '8'.repeat(64),
    capturedAtCampaignMinute: 96,
    definitionSha256: 'f'.repeat(64),
  },
  offspring: {
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: 'bulbasaur',
    speciesSpecDefinitionSha256: '3'.repeat(64),
    nature: {
      valueId: 'cuddly', resolutionKind: 'random', rollRecordId: roll(1), optionId: null, choiceEvidenceId: null,
    },
    ability: {
      valueId: 'overgrow', resolutionKind: 'random', rollRecordId: roll(2), optionId: null, choiceEvidenceId: null,
    },
    gender: {
      valueId: 'female', resolutionKind: 'random', rollRecordId: roll(3), optionId: null, choiceEvidenceId: null,
    },
    inheritanceCandidates: [{
      moveId: 'light-screen',
      sources: [
        { kind: 'parent', parentIndex: 0, parentRef: 'pokemon-parent-0', parentSpeciesId: 'bulbasaur', pathwayId: 'child-egg-move', knownMoveEvidence: [evidence(0)] },
        { kind: 'parent', parentIndex: 0, parentRef: 'pokemon-parent-0', parentSpeciesId: 'bulbasaur', pathwayId: 'child-machine-compatible', knownMoveEvidence: [evidence(0)] },
        { kind: 'parent', parentIndex: 1, parentRef: 'pokemon-parent-1', parentSpeciesId: 'bulbasaur', pathwayId: 'child-egg-move', knownMoveEvidence: [evidence(1)] },
        { kind: 'parent', parentIndex: 1, parentRef: 'pokemon-parent-1', parentSpeciesId: 'bulbasaur', pathwayId: 'child-machine-compatible', knownMoveEvidence: [evidence(1)] },
      ],
    }],
    providerTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null },
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
    definitionSha256: '9'.repeat(64),
  },
  incubation: {
    averageCampaignMinutes: 14_400,
    targetCampaignMinutes: 14_400,
    accumulatedCampaignMinutes: 0,
    variationPolicyId: 'fixed-average',
    durationResultDefinitionSha256: 'a'.repeat(64),
    lastAppliedClockRevision: 10,
    lastAppliedClockMinute: 100,
    readyAtCampaignMinute: null,
    readinessKind: null,
    readyOperationId: null,
    paused: false,
    pauseReasonId: null,
    pauseOperationId: null,
  },
  special: {
    state: 'not-rolled',
    rollRecordId: null,
    rollTotal: null,
    triggerIds: [],
    adjudicationId: null,
    outcomeId: null,
    automaticShiny: false,
  },
  hatchOperationId: null,
  childSheetSlug: null,
  terminal: null,
  createdAtCampaignMinute: 100,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: op(1),
})
const nextValue = (
  current: PokemonEggDocumentV1,
  status: PokemonEggStatus,
  minute: number,
  overrides: Record<string, unknown> = {},
): Record<string, any> => ({
  ...current,
  revision: current.revision + 1,
  status,
  updatedAtCampaignMinute: minute,
  statusChangedAtCampaignMinute: status === current.status ? current.statusChangedAtCampaignMinute : minute,
  lastOperationId: op(current.revision + 2),
  incubation: { ...current.incubation },
  special: { ...current.special, triggerIds: [...current.special.triggerIds] },
  terminal: current.terminal ? { ...current.terminal } : null,
  ...overrides,
})
const validateNext = (
  current: PokemonEggDocumentV1,
  status: PokemonEggStatus,
  minute: number,
  overrides: Record<string, unknown> = {},
): PokemonEggDocumentV1 => validatePokemonEggRevisionSuccessor(current, nextValue(current, status, minute, overrides))
const specialPath = () => {
  const incubating = parsePokemonEggDocumentV1(baseValue())
  const progressed = validateNext(incubating, 'incubating', 199, {
    incubation: {
      ...incubating.incubation,
      accumulatedCampaignMinutes: 14_399,
      lastAppliedClockRevision: 11,
      lastAppliedClockMinute: 199,
    },
  })
  const readyOperationId = op(3)
  const ready = validateNext(progressed, 'ready', 200, {
    incubation: {
      ...progressed.incubation,
      accumulatedCampaignMinutes: 14_400,
      lastAppliedClockRevision: 12,
      lastAppliedClockMinute: 200,
      readyAtCampaignMinute: 200,
      readinessKind: 'incubation-complete',
      readyOperationId,
    },
  })
  const hatchOperationId = op(4)
  const awaiting = validateNext(ready, 'awaiting-special-adjudication', 201, {
    special: {
      state: 'pending-adjudication',
      rollRecordId: roll(4),
      rollTotal: 1,
      triggerIds: ['roll-1'],
      adjudicationId: null,
      outcomeId: null,
      automaticShiny: false,
    },
    hatchOperationId,
  })
  const hatching = validateNext(awaiting, 'hatching', 202, {
    special: {
      ...awaiting.special,
      state: 'resolved',
      adjudicationId: 'adjudication:special-1',
      outcomeId: 'special-outcome:reviewed-1',
    },
  })
  const hatched = validateNext(hatching, 'hatched', 203, { childSheetSlug: 'pokemon-child' })
  return { incubating, progressed, ready, awaiting, hatching, hatched }
}

describe('PokemonEggDocument v1 and lifecycle', () => {
  it('freezes the aggregate, source kinds, nested blueprint, and lifecycle policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      contractId: 'ptu-1.05-pokemon-egg-document-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.statuses).toEqual(POKEMON_EGG_STATUSES)
    expect(policy.definition.activeStatuses).toEqual(POKEMON_EGG_ACTIVE_STATUSES)
    expect(policy.definition.settledStatuses).toEqual(POKEMON_EGG_SETTLED_STATUSES)
    expect(policy.definition.terminalNonHatchStatuses).toEqual(POKEMON_EGG_TERMINAL_NON_HATCH_STATUSES)
    expect(policy.definition.transitions).toEqual(POKEMON_EGG_TRANSITIONS)
    expect(policy.definition.special).toMatchObject({ automaticShiny: false })
    expect(policy.definition.authority).toMatchObject({ notSheetKind: true, notInventoryRow: true, notMapMetadata: true })
  })

  it('parses, detaches, and deeply freezes a complete breeding Egg blueprint', () => {
    const source = baseValue()
    const egg = parsePokemonEggDocumentV1(source)
    expect(egg).toMatchObject({
      schemaVersion: 1,
      eggId: EGG_ID,
      revision: 0,
      status: 'incubating',
      source: { kind: 'breeding', projectId: PROJECT_ID },
      parents: [{ parentIndex: 0 }, { parentIndex: 1 }],
      breeder: { trainerSheetSlug: 'trainer-breeder', pokemonEducationRank: 'Expert' },
      offspring: { speciesId: 'bulbasaur', familyRootSpeciesId: 'bulbasaur', startingLevel: 1 },
      special: { state: 'not-rolled', automaticShiny: false },
    })
    expect(Object.isFrozen(egg)).toBe(true)
    expect(Object.isFrozen(egg.parents)).toBe(true)
    expect(Object.isFrozen(egg.parents[0])).toBe(true)
    expect(Object.isFrozen(egg.offspring)).toBe(true)
    expect(Object.isFrozen(egg.offspring.inheritanceCandidates[0]!.sources)).toBe(true)
    source.parents[0].speciesId = 'charmander'
    source.offspring.inheritanceCandidates.length = 0
    expect(egg.parents[0]!.speciesId).toBe('bulbasaur')
    expect(egg.offspring.inheritanceCandidates).toHaveLength(1)
  })

  it('accepts readiness, one pending special roll, adjudication, hatching, and one child', () => {
    const path = specialPath()
    expect(Object.values(path).map(egg => egg.status)).toEqual([
      'incubating', 'incubating', 'ready', 'awaiting-special-adjudication', 'hatching', 'hatched',
    ])
    expect(path.awaiting).toMatchObject({
      special: { state: 'pending-adjudication', rollTotal: 1, triggerIds: ['roll-1'], automaticShiny: false },
      hatchOperationId: op(4),
      childSheetSlug: null,
    })
    expect(path.hatched).toMatchObject({
      status: 'hatched',
      special: { state: 'resolved', outcomeId: 'special-outcome:reviewed-1', automaticShiny: false },
      hatchOperationId: op(4),
      childSheetSlug: 'pokemon-child',
      terminal: null,
    })
    expect(isPokemonEggSettledStatus(path.hatched.status)).toBe(true)
    const impossible = nextValue(path.hatched, 'hatched', 204)
    expect(() => validatePokemonEggRevisionSuccessor(path.hatched, impossible)).toThrow(PokemonEggTransitionError)
  })

  it('supports a normal one-roll hatch, audited GM readiness, pause, and pre-hatch transfer', () => {
    const base = parsePokemonEggDocumentV1(baseValue())
    const paused = validateNext(base, 'incubating', 101, {
      incubation: {
        ...base.incubation,
        paused: true,
        pauseReasonId: 'pause:facility-closed',
        pauseOperationId: op(2),
      },
    })
    expect(paused.incubation.paused).toBe(true)
    const resumed = validateNext(paused, 'incubating', 102, {
      incubation: {
        ...paused.incubation,
        paused: false,
        pauseReasonId: null,
        pauseOperationId: null,
      },
    })
    const transferred = validateNext(resumed, 'incubating', 103, { ownerTrainerSlug: 'trainer-recipient' })
    expect(transferred.ownerTrainerSlug).toBe('trainer-recipient')
    const ready = validateNext(transferred, 'ready', 104, {
      incubation: {
        ...transferred.incubation,
        readyAtCampaignMinute: 104,
        readinessKind: 'gm-mark-ready',
        readyOperationId: op(5),
      },
    })
    expect(ready.incubation).toMatchObject({ accumulatedCampaignMinutes: 0, readinessKind: 'gm-mark-ready' })
    const hatching = validateNext(ready, 'hatching', 105, {
      special: {
        state: 'normal', rollRecordId: roll(5), rollTotal: 50, triggerIds: [],
        adjudicationId: null, outcomeId: null, automaticShiny: false,
      },
      hatchOperationId: op(6),
    })
    expect(hatching.special).toMatchObject({ state: 'normal', rollTotal: 50, automaticShiny: false })
    expect(validateNext(hatching, 'hatched', 106, { childSheetSlug: 'pokemon-normal-child' }).status).toBe('hatched')
  })

  it('allows typed parentless source Eggs but never manufactures lineage', () => {
    for (const source of [
      { kind: 'fossil', sourceId: 'fossil:helix-1', evidenceDefinitionSha256: '4'.repeat(64) },
      { kind: 'gm', reasonId: 'breeding.egg-source.mysterious', evidenceDefinitionSha256: '5'.repeat(64) },
      { kind: 'feature-artificial', providerId: 'provider:playing-god', evidenceDefinitionSha256: '6'.repeat(64) },
    ]) {
      const value = baseValue()
      value.source = source
      value.parents = []
      value.breeder = null
      const inheritanceCandidates = source.kind === 'fossil' ? [{
        moveId: 'ancient-power',
        sources: [{
          kind: 'source-authority',
          authorityKind: 'fossil',
          authorityId: 'fossil-inheritance:helix-1',
          evidenceDefinitionSha256: 'e'.repeat(64),
        }],
      }] : []
      value.offspring = {
        ...value.offspring,
        inheritanceCandidates,
        startingLevel: source.kind === 'fossil' ? 10 : 1,
        definitionSha256: source.kind === 'fossil' ? 'c'.repeat(64) : 'd'.repeat(64),
      }
      expect(parsePokemonEggDocumentV1(value)).toMatchObject({
        source,
        parents: [],
        breeder: null,
        offspring: { inheritanceCandidates },
      })
    }
    const invalid = baseValue()
    invalid.source = { kind: 'fossil', sourceId: 'fossil:bad', evidenceDefinitionSha256: '4'.repeat(64) }
    expect(() => parsePokemonEggDocumentV1(invalid)).toThrow(PokemonEggValidationError)
  })

  it('matches every status and special-state edge to the closed transition graphs', () => {
    for (const from of POKEMON_EGG_STATUSES) {
      for (const to of POKEMON_EGG_STATUSES) {
        expect(isPokemonEggStatusTransitionAllowed(from, to), `${from} -> ${to}`)
          .toBe(from !== to && policy.definition.transitions[from].includes(to))
      }
    }
    expect(POKEMON_EGG_SPECIAL_TRANSITIONS).toEqual({
      'not-rolled': ['normal', 'pending-adjudication'],
      normal: [],
      'pending-adjudication': ['resolved'],
      resolved: [],
    })
    expect(isPokemonEggStatus('awaiting-special-adjudication')).toBe(true)
    expect(isPokemonEggStatus('egg')).toBe(false)
    expect(isPokemonEggSettledStatus('cancelled')).toBe(true)
    expect(isPokemonEggSettledStatus('ready')).toBe(false)
  })

  it('rejects enriched, malformed, contradictory, legacy, or auto-Shiny documents', () => {
    const base = baseValue()
    const cases: Array<[string, Record<string, any>]> = [
      ['unknown field', { ...base, clientReady: true }],
      ['Egg ID', { ...base, eggId: 'egg-1' }],
      ['status', { ...base, status: 'egg' }],
      ['definition hash order', { ...base, definitionHashes: ['2'.repeat(64), '1'.repeat(64)] }],
      ['duplicate parent index', { ...base, parents: [parentSnapshot(0), { ...parentSnapshot(1), parentIndex: 0 }] }],
      ['auto Shiny', { ...base, special: { ...base.special, automaticShiny: true } }],
      ['full target without readiness', { ...base, incubation: { ...base.incubation, accumulatedCampaignMinutes: 14_400 } }],
      ['child before hatch', { ...base, childSheetSlug: 'pokemon-child' }],
      ['bad candidate attribution', {
        ...base,
        offspring: {
          ...base.offspring,
          inheritanceCandidates: [{
            ...base.offspring.inheritanceCandidates[0],
            sources: [{ ...base.offspring.inheritanceCandidates[0].sources[0], parentRef: 'other-parent' }],
          }],
        },
      }],
      ['legacy map metadata', { ...base, capabilityEggs: [{ hatchHours: 1 }] }],
    ]
    for (const [label, value] of cases) expect(() => parsePokemonEggDocumentV1(value), label).toThrow(PokemonEggValidationError)
    const accessor = baseValue()
    Object.defineProperty(accessor, 'revision', { enumerable: true, get: () => 0 })
    expect(() => parsePokemonEggDocumentV1(accessor)).toThrow(PokemonEggValidationError)
  })

  it('rejects stale, skipped, regressive, rerolled, immutable, post-hatch, and late-transfer successors', () => {
    const path = specialPath()
    const progress = nextValue(path.incubating, 'incubating', 101, {
      incubation: { ...path.incubating.incubation, accumulatedCampaignMinutes: 1, lastAppliedClockRevision: 11, lastAppliedClockMinute: 101 },
    })
    expect(() => validatePokemonEggRevisionSuccessor(path.incubating, { ...progress, revision: 0 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.egg.stale-revision' }))
    expect(() => validatePokemonEggRevisionSuccessor(path.incubating, { ...progress, lastOperationId: path.incubating.lastOperationId }))
      .toThrowError(expect.objectContaining({ code: 'breeding.egg.invalid-transition' }))
    expect(() => validatePokemonEggRevisionSuccessor(path.incubating, {
      ...progress,
      offspring: { ...path.incubating.offspring, definitionSha256: 'f'.repeat(64) },
    })).toThrowError(expect.objectContaining({ code: 'breeding.egg.immutable-field' }))

    const regression = nextValue(path.progressed, 'incubating', 200, {
      incubation: { ...path.progressed.incubation, accumulatedCampaignMinutes: 100, lastAppliedClockRevision: 12, lastAppliedClockMinute: 200 },
    })
    expect(() => validatePokemonEggRevisionSuccessor(path.progressed, regression))
      .toThrowError(expect.objectContaining({ code: 'breeding.egg.invalid-transition' }))

    const skipped = {
      ...path.hatching,
      revision: 1,
      eggId: path.incubating.eggId,
      createdAtCampaignMinute: path.incubating.createdAtCampaignMinute,
      lastOperationId: op(2),
    }
    expect(() => validatePokemonEggRevisionSuccessor(path.incubating, skipped))
      .toThrowError(expect.objectContaining({ code: 'breeding.egg.invalid-transition' }))

    const rerolled = nextValue(path.awaiting, 'hatching', 202, {
      special: {
        state: 'resolved', rollRecordId: roll(99), rollTotal: 100, triggerIds: ['roll-100'],
        adjudicationId: 'adjudication:bad', outcomeId: 'special-outcome:bad', automaticShiny: false,
      },
    })
    expect(() => validatePokemonEggRevisionSuccessor(path.awaiting, rerolled))
      .toThrowError(expect.objectContaining({ code: 'breeding.egg.immutable-field' }))

    const lateTransfer = nextValue(path.awaiting, 'awaiting-special-adjudication', 202, { ownerTrainerSlug: 'trainer-other' })
    expect(() => validatePokemonEggRevisionSuccessor(path.awaiting, lateTransfer))
      .toThrowError(expect.objectContaining({ code: 'breeding.egg.invalid-transition' }))
    expect(() => validatePokemonEggRevisionSuccessor(path.hatched, nextValue(path.hatched, 'hatched', 204)))
      .toThrow(PokemonEggTransitionError)
  })
})
