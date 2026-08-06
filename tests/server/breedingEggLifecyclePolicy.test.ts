import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import {
  PokemonEggValidationError,
  parsePokemonEggDocumentV1,
  type PokemonEggDocumentV1,
} from '../../shared/breeding/egg'
import {
  PokemonEggLifecycleValidationError,
  parsePokemonEggExternalLifecycleObservationV1,
  parsePokemonEggLifecycleProjectionV1,
} from '../../shared/breeding/eggLifecycle'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createBreedingActorAuthorityV1 } from '../../server/domain/breeding/authorization'
import { PokemonEggTransitionError, validatePokemonEggRevisionSuccessor } from '../../server/domain/breeding/eggLifecycle'
import {
  POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION_SHA256,
  PokemonEggLifecyclePolicyError,
  evaluatePokemonEggExternalLifecycleObservationV1,
  planPokemonEggOwnershipTransferV1,
  pokemonEggLifecycleDocumentDefinitionSha256,
  projectPokemonEggLifecycleV1,
} from '../../server/domain/breeding/eggLifecyclePolicy'
import { createPokemonEggOffspringBlueprintV1 } from '../../server/domain/breeding/lineage'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { queryPokemonEggLifecycle } from '../../server/useCases/queryPokemonEggLifecycle'

const ruleset = Object.freeze({
  rulesetId: rulesetJson.rulesetId,
  definitionSha256: rulesetJson.definitionSha256,
})
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const EGG_ID = 'pokemon-egg:v1:53535353535353535353535353535353'

const baseEggValue = (): Record<string, unknown> => ({
  schemaVersion: 1,
  eggId: EGG_ID,
  revision: 0,
  status: 'incubating',
  ownerTrainerSlug: 'trainer-owner',
  source: {
    kind: 'gm',
    reasonId: 'breeding.egg-source.campaign-mystery',
    evidenceDefinitionSha256: '1'.repeat(64),
  },
  ruleset,
  definitionHashes: ['1'.repeat(64), '2'.repeat(64)],
  parents: [],
  breeder: null,
  offspring: {
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: 'bulbasaur',
    speciesSpecDefinitionSha256: '3'.repeat(64),
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: 'overgrow', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    providerTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null },
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
    definitionSha256: '4'.repeat(64),
  },
  incubation: {
    averageCampaignMinutes: 600,
    targetCampaignMinutes: 600,
    accumulatedCampaignMinutes: 100,
    variationPolicyId: 'fixed-average',
    durationResultDefinitionSha256: '5'.repeat(64),
    lastAppliedClockRevision: 2,
    lastAppliedClockMinute: 200,
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
  updatedAtCampaignMinute: 200,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: operationId(1),
})
const egg = (): PokemonEggDocumentV1 => parsePokemonEggDocumentV1(baseEggValue())
const readyEgg = (readinessKind: 'incubation-complete' | 'gm-mark-ready' = 'incubation-complete'): PokemonEggDocumentV1 => {
  const value = baseEggValue() as any
  value.revision = 1
  value.status = 'ready'
  value.updatedAtCampaignMinute = 700
  value.statusChangedAtCampaignMinute = 700
  value.lastOperationId = operationId(2)
  value.incubation = {
    ...value.incubation,
    accumulatedCampaignMinutes: readinessKind === 'incubation-complete' ? 600 : 100,
    lastAppliedClockRevision: 3,
    lastAppliedClockMinute: 700,
    readyAtCampaignMinute: 700,
    readinessKind,
    readyOperationId: operationId(2),
  }
  return parsePokemonEggDocumentV1(value)
}
const transferCommand = (current: PokemonEggDocumentV1, value = 10, destination = 'trainer-recipient') => (
  parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: operationId(value),
    commandKind: 'transfer-egg',
    actor: { profileId: 'profile-owner', selectedTrainerSlug: current.ownerTrainerSlug },
    ruleset,
    scopes: [
      { kind: 'pokemon-egg', eggId: current.eggId, expectedRevision: current.revision },
      { kind: 'egg-transfer-consent', consentId: 'egg-transfer-consent:v1:00000000000000000000000000000001', expectedRevision: 0 },
      { kind: 'egg-transfer-consent', consentId: 'egg-transfer-consent:v1:00000000000000000000000000000002', expectedRevision: 0 },
    ],
    payload: {
      eggId: current.eggId,
      destinationTrainerSlug: destination,
      consentEvidenceIds: [
        'egg-transfer-consent:v1:00000000000000000000000000000001',
        'egg-transfer-consent:v1:00000000000000000000000000000002',
      ],
    },
  })
)

const canonicalStoredEgg = (): PokemonEggDocumentV1 => {
  const value = baseEggValue() as any
  const spec = compiledBreedingSpeciesSpec('bulbasaur')!
  value.offspring.speciesSpecDefinitionSha256 = spec.definitionSha256
  value.offspring.familyRootSpeciesId = spec.familyRootSpeciesId
  value.offspring.ability.valueId = spec.basicAbilityIds[0]
  const { definitionSha256: _definitionSha256, ...blueprintDefinition } = value.offspring
  value.offspring = createPokemonEggOffspringBlueprintV1(blueprintDefinition)
  value.definitionHashes = [
    value.incubation.durationResultDefinitionSha256,
    hatchDurationPolicyJson.definitionSha256,
    value.offspring.definitionSha256,
  ].sort()
  return parsePokemonEggDocumentV1(value)
}
const sourceCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(1),
  commandKind: 'create-source-egg',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null }],
  payload: {
    eggId: EGG_ID,
    ownerTrainerSlug: 'trainer-owner',
    source: {
      kind: 'gm',
      reasonId: 'breeding.egg-source.campaign-mystery',
      evidenceDefinitionSha256: '1'.repeat(64),
    },
    speciesOptionId: 'option:v1:53535353535353535353535353535353',
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})

const pausedEgg = (): PokemonEggDocumentV1 => {
  const value = baseEggValue() as any
  value.revision = 1
  value.updatedAtCampaignMinute = 250
  value.lastOperationId = operationId(3)
  value.incubation = {
    ...value.incubation,
    lastAppliedClockRevision: 3,
    lastAppliedClockMinute: 250,
    paused: true,
    pauseReasonId: 'breeding.incubation-pause.owner-request',
    pauseOperationId: operationId(3),
  }
  return parsePokemonEggDocumentV1(value)
}

describe('BR-053 Pokémon Egg lifecycle policy', () => {
  it('projects status-derived readiness without conferring transfer or hatch authorization', () => {
    expect(POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION_SHA256).toMatch(/^[0-9a-f]{64}$/u)
    expect(projectPokemonEggLifecycleV1({ egg: egg(), audience: 'owner', generatedAtCampaignMinute: 200 })).toMatchObject({
      readinessState: 'not-ready',
      incubationDisposition: 'active',
      canTransferBeforeHatch: true,
      canBeginHatch: false,
      blockerReasonIds: ['breeding.egg-lifecycle.not-ready'],
    })
    expect(projectPokemonEggLifecycleV1({ egg: pausedEgg(), audience: 'gm', generatedAtCampaignMinute: 250 })).toMatchObject({
      readinessState: 'not-ready',
      incubationDisposition: 'explicitly-paused',
      canTransferBeforeHatch: true,
      canBeginHatch: false,
    })
    const ready = projectPokemonEggLifecycleV1({ egg: readyEgg(), audience: 'owner', generatedAtCampaignMinute: 700 })
    expect(ready).toMatchObject({
      readinessState: 'ready',
      incubationDisposition: 'complete',
      canTransferBeforeHatch: true,
      canBeginHatch: true,
      blockerReasonIds: [],
    })
    expect(JSON.stringify(ready)).not.toMatch(/species|nature|ability|gender|parent|breeder|profile|consent|definition|sha256/iu)
  })

  it('queries an exact current GM-visible Egg revision idempotently and denies failed current authority', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const command = sourceCommand()
      const storedEgg = canonicalStoredEgg()
      database.withTransaction(() => {
        const operations = createSqliteBreedingOperationRepository(database)
        operations.reserve(command, 200)
        createSqlitePokemonEggRepository(database).insert(storedEgg)
        operations.settle(command, createBreedingOperationAcceptedV1({
          operationId: command.operationId,
          commandHash: createBreedingOperationCommandHash(command),
          commandKind: command.commandKind,
          outcomeKind: 'source-egg-created',
          aggregateRefs: [{ kind: 'pokemon-egg', id: storedEgg.eggId, revision: storedEgg.revision }],
          changedScopes: command.scopes,
          committedAtCampaignMinute: 200,
        }), 200)
        database.connection.prepare(`
          UPDATE campaign_clock
          SET revision = 2, campaign_minute = 200, last_operation_id = ?
          WHERE singleton = 1
        `).run(command.operationId)
      })
      const actor = createBreedingActorAuthorityV1({
        role: 'gm',
        command,
        authenticatedPrincipalSha256: 'a'.repeat(64),
        authenticationPolicyDefinitionSha256: 'b'.repeat(64),
        profile: null,
        evaluatedAtCampaignMinute: 200,
      })
      const input = { eggId: EGG_ID, actorAuthority: actor, trainerControl: null, audience: 'gm' as const }
      const first = queryPokemonEggLifecycle(input, { database, validateCurrentGmAuthority: () => true })
      const retry = queryPokemonEggLifecycle(input, { database, validateCurrentGmAuthority: () => true })
      expect(retry).toEqual(first)
      expect(stableJsonStringify(retry)).toBe(stableJsonStringify(first))
      expect(() => queryPokemonEggLifecycle(input, { database, validateCurrentGmAuthority: () => false })).toThrow('unavailable for this viewer')
    }
    finally {
      database.close()
    }
  })

  it('requires lifecycle projections to retain exact status, readiness, actions, and blockers', () => {
    const projection = projectPokemonEggLifecycleV1({ egg: readyEgg('gm-mark-ready'), audience: 'gm', generatedAtCampaignMinute: 700 })
    expect(() => parsePokemonEggLifecycleProjectionV1({ ...projection, canBeginHatch: false })).toThrow(PokemonEggLifecycleValidationError)
    expect(() => parsePokemonEggLifecycleProjectionV1({ ...projection, blockerReasonIds: ['breeding.egg-lifecycle.not-ready'] })).toThrow(PokemonEggLifecycleValidationError)
    expect(() => parsePokemonEggLifecycleProjectionV1({ ...projection, sourceLossPolicy: 'source-required' })).toThrow(PokemonEggLifecycleValidationError)
    expect(() => projectPokemonEggLifecycleV1({ egg: readyEgg(), audience: 'owner', generatedAtCampaignMinute: 699 })).toThrow(PokemonEggLifecyclePolicyError)
  })

  it('plans an incubating transfer as an owner-only revision while incubation continues across the transfer minute', () => {
    const current = egg()
    const beforeHash = pokemonEggLifecycleDocumentDefinitionSha256(current)
    const transferred = planPokemonEggOwnershipTransferV1({
      egg: current,
      command: transferCommand(current),
      atCampaignMinute: 300,
    })
    expect(transferred).toMatchObject({
      revision: 1,
      status: 'incubating',
      ownerTrainerSlug: 'trainer-recipient',
      updatedAtCampaignMinute: 300,
      statusChangedAtCampaignMinute: 100,
      lastOperationId: operationId(10),
    })
    expect(transferred.incubation).toEqual(current.incubation)
    expect(transferred.special).toEqual(current.special)
    expect(transferred.offspring).toEqual(current.offspring)
    expect(pokemonEggLifecycleDocumentDefinitionSha256(current)).toBe(beforeHash)
  })

  it('preserves both organic and GM readiness exactly across a pre-hatch transfer', () => {
    for (const kind of ['incubation-complete', 'gm-mark-ready'] as const) {
      const current = readyEgg(kind)
      const transferred = planPokemonEggOwnershipTransferV1({
        egg: current,
        command: transferCommand(current, kind === 'incubation-complete' ? 11 : 12),
        atCampaignMinute: 701,
      })
      expect(transferred.status).toBe('ready')
      expect(transferred.incubation).toEqual(current.incubation)
      expect(transferred.statusChangedAtCampaignMinute).toBe(700)
      expect(projectPokemonEggLifecycleV1({ egg: transferred, audience: 'owner', generatedAtCampaignMinute: 701 }).canBeginHatch).toBe(true)
    }
  })

  it('rejects self, stale, wrong-command, and post-hatch-start transfer reductions', () => {
    const current = egg()
    expect(() => planPokemonEggOwnershipTransferV1({
      egg: current,
      command: transferCommand(current, 13, current.ownerTrainerSlug),
      atCampaignMinute: 200,
    })).toThrow(PokemonEggLifecyclePolicyError)
    expect(() => planPokemonEggOwnershipTransferV1({
      egg: current,
      command: {
        ...transferCommand(current, 14),
        scopes: transferCommand(current, 14).scopes.map(scope => scope.kind === 'pokemon-egg'
          ? { ...scope, expectedRevision: 1 }
          : scope),
      },
      atCampaignMinute: 200,
    })).toThrow(PokemonEggLifecyclePolicyError)
    expect(() => planPokemonEggOwnershipTransferV1({
      egg: current,
      command: {
        ...transferCommand(current, 15),
        commandKind: 'mark-egg-ready',
        scopes: [{ kind: 'pokemon-egg', eggId: current.eggId, expectedRevision: current.revision }],
        payload: { eggId: current.eggId, reasonId: 'breeding.egg-ready.gm-adjudication' },
      },
      atCampaignMinute: 200,
    })).toThrow(PokemonEggLifecyclePolicyError)
    const ready = readyEgg()
    const started = parsePokemonEggDocumentV1({
      ...ready,
      revision: ready.revision + 1,
      status: 'awaiting-special-adjudication',
      special: {
        state: 'pending-adjudication',
        rollRecordId: 'breeding-roll:v1:53535353535353535353535353535353',
        rollTotal: 1,
        triggerIds: ['roll-1'],
        adjudicationId: null,
        outcomeId: null,
        automaticShiny: false,
      },
      hatchOperationId: operationId(16),
      updatedAtCampaignMinute: 701,
      statusChangedAtCampaignMinute: 701,
      lastOperationId: operationId(16),
    })
    expect(() => planPokemonEggOwnershipTransferV1({
      egg: started,
      command: transferCommand(started, 18),
      atCampaignMinute: 701,
    })).toThrow(PokemonEggLifecyclePolicyError)
  })

  it('prevents a generic owner-transfer successor from smuggling progress, pause, or readiness changes', () => {
    const current = egg()
    const command = transferCommand(current, 17)
    expect(() => validatePokemonEggRevisionSuccessor(current, {
      ...current,
      revision: 1,
      ownerTrainerSlug: 'trainer-recipient',
      incubation: {
        ...current.incubation,
        accumulatedCampaignMinutes: 101,
        lastAppliedClockRevision: 3,
        lastAppliedClockMinute: 201,
      },
      updatedAtCampaignMinute: 201,
      lastOperationId: command.operationId,
    })).toThrow(PokemonEggTransitionError)
  })

  it('treats storage and accepted-source loss as non-mutating observations that preserve readiness and incubation', () => {
    const current = readyEgg()
    const beforeHash = pokemonEggLifecycleDocumentDefinitionSha256(current)
    const storage = evaluatePokemonEggExternalLifecycleObservationV1({
      egg: current,
      observation: { schemaVersion: 1, kind: 'custody-change', custodyState: 'stored' },
      observedAtCampaignMinute: 800,
    })
    const sourceLoss = evaluatePokemonEggExternalLifecycleObservationV1({
      egg: current,
      observation: { schemaVersion: 1, kind: 'source-continuity-loss', sourceRole: 'origin', continuityState: 'missing' },
      observedAtCampaignMinute: 800,
    })
    expect(storage).toMatchObject({
      mutationRequired: false,
      reasonId: 'breeding.egg-lifecycle.storage-continues',
      facilityContributionDisposition: 'none',
    })
    expect(sourceLoss).toMatchObject({
      mutationRequired: false,
      reasonId: 'breeding.egg-lifecycle.source-loss-snapshot-preserved',
      hatchEligibilityDisposition: 'preserve-status-derived-eligibility',
    })
    expect(pokemonEggLifecycleDocumentDefinitionSha256(current)).toBe(beforeHash)
    expect(projectPokemonEggLifecycleV1({ egg: current, audience: 'gm', generatedAtCampaignMinute: 800 }).canBeginHatch).toBe(true)
    expect(() => evaluatePokemonEggExternalLifecycleObservationV1({
      egg: current,
      observation: { schemaVersion: 1, kind: 'source-continuity-loss', sourceRole: 'parent-0', continuityState: 'changed' },
      observedAtCampaignMinute: 800,
    })).toThrow(PokemonEggLifecyclePolicyError)
  })

  it('fails facility mechanics closed while preserving base-rate lifecycle state', () => {
    const current = egg()
    const unsupported = evaluatePokemonEggExternalLifecycleObservationV1({
      egg: current,
      observation: {
        schemaVersion: 1,
        kind: 'facility-change',
        facilityId: 'facility:unreviewed-incubator',
        evidenceDefinitionSha256: 'a'.repeat(64),
      },
      observedAtCampaignMinute: 200,
    })
    expect(unsupported).toMatchObject({
      mutationRequired: false,
      facilityContributionDisposition: 'unavailable',
      reasonId: 'breeding.egg-lifecycle.facility-unsupported',
    })
    expect(evaluatePokemonEggExternalLifecycleObservationV1({
      egg: current,
      observation: { schemaVersion: 1, kind: 'facility-change', facilityId: null, evidenceDefinitionSha256: null },
      observedAtCampaignMinute: 200,
    })).toMatchObject({
      facilityContributionDisposition: 'none',
      reasonId: 'breeding.egg-lifecycle.facility-removed-base-rate-continues',
    })
  })

  it('rejects malformed, enriched, accessor-backed, contradictory, and paused-ready lifecycle input', () => {
    expect(() => parsePokemonEggExternalLifecycleObservationV1({
      schemaVersion: 1,
      kind: 'facility-change',
      facilityId: 'facility:x',
      evidenceDefinitionSha256: null,
    })).toThrow(PokemonEggLifecycleValidationError)
    expect(() => parsePokemonEggExternalLifecycleObservationV1({
      schemaVersion: 1,
      kind: 'custody-change',
      custodyState: 'stored',
      clientEffect: 'pause',
    })).toThrow(PokemonEggLifecycleValidationError)
    const accessor = { schemaVersion: 1, kind: 'custody-change' } as Record<string, unknown>
    Object.defineProperty(accessor, 'custodyState', { enumerable: true, get: () => 'stored' })
    expect(() => parsePokemonEggExternalLifecycleObservationV1(accessor)).toThrow(PokemonEggLifecycleValidationError)
    const invalidReady = structuredClone(readyEgg()) as any
    invalidReady.incubation.paused = true
    invalidReady.incubation.pauseReasonId = 'breeding.incubation-pause.owner-request'
    invalidReady.incubation.pauseOperationId = operationId(20)
    expect(() => parsePokemonEggDocumentV1(invalidReady)).toThrow(PokemonEggValidationError)
  })
})
