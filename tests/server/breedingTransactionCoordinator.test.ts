import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '../../shared/breeding/project'
import type { CharacterSheet } from '../../src/types/characterSheet'
import { normalizeCharacterSheet } from '../../src/utils/sheetNormalize'
import {
  createPokemonBreedingOriginFromHatchedEgg,
  createPokemonEggOffspringBlueprintV1,
} from '../../server/domain/breeding/lineage'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../../server/domain/breeding/operations'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { validatePokemonEggRevisionSuccessor } from '../../server/domain/breeding/eggLifecycle'
import { breedingRealtimeRefreshAppendInputs } from '../../server/realtime/breedingRealtime'
import { createSqliteBreedingLineageRepository } from '../../server/storage/breedingLineageRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import {
  createSqliteInitializedPokemonSheetRepository,
  type CreateInitializedPokemonSheetInput,
} from '../../server/storage/initializedPokemonSheetRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../../server/storage/trainerSpeciesAcquisitionRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionContext,
} from '../../server/useCases/executeBreedingTransaction'

const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const ORIGIN_ID = 'pokemon-breeding-origin:v1:33333333333333333333333333333333'
const PROJECTION_KEY = '0123456789abcdef0123456789abcdef'
const ruleset = rulesetJson as Record<string, any>
const eggContract = eggContractJson as Record<string, any>
const rulesetRef = { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }
const databases: RotomDatabase[] = []
const roots: string[] = []

const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const rollId = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`

const projectCommand = (operation: string = operationId(1)): BreedingOperationCommandV1 => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operation,
  commandKind: 'create-breeding-project',
  actor: { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: null }],
  payload: {
    projectId: PROJECT_ID,
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: '1'.repeat(64),
    consentPolicy: 'same-owner-control',
  },
})

const projectDocument = (operation: string): BreedingProjectDocumentV1 => parseBreedingProjectDocumentV1({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 0,
  status: 'draft',
  ruleset: rulesetRef,
  projectCreationOptionSnapshotSha256: '1'.repeat(64),
  ownerTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-breeder',
  parentRefs: [
    { pokemonSheetSlug: 'pokemon-parent-a', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 2 },
    { pokemonSheetSlug: 'pokemon-parent-b', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 3 },
  ],
  consentPolicy: 'same-owner-control',
  timeline: {
    initialRequiredCampaignMinutes: 240,
    initialAccumulatedCampaignMinutes: 0,
    additionalRequiredCampaignMinutes: 240,
    additionalAccumulatedCampaignMinutes: 0,
    initialStartedAtCampaignMinute: null,
    checkReadyAtCampaignMinute: null,
    additionalStartedAtCampaignMinute: null,
    readyToProduceAtCampaignMinute: null,
    eggProducedAtCampaignMinute: null,
    lastAppliedClockRevision: null,
    lastAppliedClockMinute: null,
  },
  check: null,
  producedEggId: null,
  terminal: null,
  createdAtCampaignMinute: 100,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: operation,
})

const completeHatchCommand = (operation: string = operationId(2)): BreedingOperationCommandV1 => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operation,
  commandKind: 'complete-hatch',
  actor: { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [
    { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 },
    { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 0, fields: ['experience', 'roster'] },
    { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
    { kind: 'species-acquisition', trainerSheetSlug: 'trainer-owner', speciesId: 'bulbasaur' },
  ],
  payload: {
    eggId: EGG_ID,
    originId: ORIGIN_ID,
    destination: { kind: 'team', trainerSheetSlug: 'trainer-owner' },
  },
})

const accepted = (
  command: BreedingOperationCommandV1,
  aggregateRefs: readonly { readonly kind: 'breeding-project' | 'pokemon-egg' | 'pokemon-sheet' | 'trainer-sheet', readonly id: string, readonly revision: number }[],
  committedAtCampaignMinute: number,
) => createBreedingOperationAcceptedV1({
  operationId: command.operationId,
  commandHash: createBreedingOperationCommandHash(command),
  commandKind: command.commandKind,
  outcomeKind: command.commandKind === 'complete-hatch' ? 'hatched' : 'project-created',
  aggregateRefs,
  changedScopes: command.scopes,
  committedAtCampaignMinute,
})

const completeChildDocument = (): CreateInitializedPokemonSheetInput['document'] => {
  const normalized = normalizeCharacterSheet({
    slug: 'normalization-only',
    nickname: 'Sprout',
    species: 'Bulbasaur',
    level: 1,
    totalExp: 0,
    gender: 'Female',
    loyalty: 3,
    shiny: false,
    caughtBall: 'Basic Ball',
    player: false,
    nature: 'Cuddly',
    babyTemplate: false,
    inheritedRemaining: 0,
    serverPrivate: { breedingProviderTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null, coreHatchRules: {
      loyaltyRank: 3, startingTutorPoints: 1, providerEvidenceDefinitionSha256s: ['1'.repeat(64), '2'.repeat(64)],
      handoffDefinitionSha256: '3'.repeat(64), sourceEggId: EGG_ID,
    } } },
    combat: { currentHp: 11 },
    abilities: [{ name: 'Overgrow' }],
  } as CharacterSheet) as CharacterSheet & Record<string, unknown>
  const document = { ...normalized }
  delete document.slug
  delete document.revision
  return document as CreateInitializedPokemonSheetInput['document']
}

const hatchingEgg = (seedOperationId: string): PokemonEggDocumentV1 => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const offspring = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: {
      valueId: 'cuddly', resolutionKind: 'random', rollRecordId: rollId(1) as any,
      optionId: null, choiceEvidenceId: null,
    },
    ability: {
      valueId: 'overgrow', resolutionKind: 'random', rollRecordId: rollId(2) as any,
      optionId: null, choiceEvidenceId: null,
    },
    gender: {
      valueId: 'female', resolutionKind: 'random', rollRecordId: rollId(3) as any,
      optionId: null, choiceEvidenceId: null,
    },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parsePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 0,
    status: 'hatching',
    ownerTrainerSlug: 'trainer-owner',
    source: {
      kind: 'gm',
      reasonId: 'breeding.egg-source.reviewed',
      evidenceDefinitionSha256: '4'.repeat(64),
    },
    ruleset: rulesetRef,
    definitionHashes: [eggContract.definitionSha256, ruleset.definitionSha256].sort(),
    parents: [],
    breeder: null,
    offspring,
    incubation: {
      averageCampaignMinutes: 14_400,
      targetCampaignMinutes: 14_400,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256: '5'.repeat(64),
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 102,
      readyAtCampaignMinute: 102,
      readinessKind: 'gm-mark-ready',
      readyOperationId: seedOperationId,
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: {
      state: 'normal',
      rollRecordId: rollId(4),
      rollTotal: 50,
      triggerIds: [],
      adjudicationId: null,
      outcomeId: null,
      automaticShiny: false,
    },
    hatchOperationId: seedOperationId,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 202,
    statusChangedAtCampaignMinute: 202,
    lastOperationId: seedOperationId,
  })
}

const seedHatchState = (database: RotomDatabase): PokemonEggDocumentV1 => {
  const seedOperation = operationId(90)
  const seedCommand = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: seedOperation,
    commandKind: 'begin-hatch',
    actor: { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' },
    ruleset: rulesetRef,
    scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
    payload: {
      eggId: EGG_ID,
      destination: { kind: 'team', trainerSheetSlug: 'trainer-owner' },
      requestSpecialRoll: true,
    },
  })
  const operationRepository = createSqliteBreedingOperationRepository(database)
  database.withTransaction(() => operationRepository.reserve(seedCommand, 202))
  const egg = hatchingEgg(seedOperation)
  createSqlitePokemonEggRepository(database).insert(egg)
  createSqliteSheetRepository(database).save({
    kind: 'trainer',
    slug: 'trainer-owner',
    revision: 0,
    updatedAt: 1_000,
    document: {
      slug: 'trainer-owner',
      name: 'Owner',
      level: 10,
      dexExp: 7,
      currentTeam: [],
      boxedPokemon: [],
    },
  })
  return egg
}

const executeProject = (
  coordinator: ReturnType<typeof createBreedingTransactionCoordinator>,
  command: BreedingOperationCommandV1,
  beforeSettle?: () => void,
) => coordinator.execute({
  command,
  createdAtCampaignMinute: 100,
  settledAtCampaignMinute: 100,
  execute: (parsed, _operation, context) => {
    const project = context.repositories.projects.insert(projectDocument(parsed.operationId))
    context.appendRealtime(breedingRealtimeRefreshAppendInputs({
      aggregateKind: 'breeding-project',
      aggregateId: project.projectId,
      revision: project.revision,
      operationKind: parsed.commandKind,
      audienceTargets: [
        { audience: 'public', trainerSheetSlug: null },
        { audience: 'gm', trainerSheetSlug: null },
      ],
      campaignProjectionKey: PROJECTION_KEY,
      timestamp: 1_700_000_000_000,
    }))
    return accepted(parsed, [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }], 100)
  },
  ...(beforeSettle ? { beforeSettle } : {}),
})

const planHatch = (
  currentEgg: PokemonEggDocumentV1,
  parsed: BreedingOperationCommandV1,
  context: BreedingTransactionContext,
) => {
  const child = context.repositories.initializedPokemonSheets.create({
    baseSlug: 'Sprout',
    folder: 'Players/Owner/Team',
    updatedAt: 2_000,
    document: completeChildDocument(),
  })
  const reward = context.repositories.speciesAcquisitionRewards.record({
    schemaVersion: 1,
    trainerSheetSlug: 'trainer-owner',
    expectedTrainerRevision: 0,
    speciesId: 'bulbasaur',
    sourceKind: 'hatch',
    sourceEggId: currentEgg.eggId,
    acquiredAtCampaignMinute: 203,
    operationId: parsed.operationId,
    sheetUpdatedAt: 2_000,
  })
  if (reward.outcome !== 'first-acquisition-rewarded' || reward.appliedRewardAmount !== 1) {
    throw new Error('Expected the first historical Species reward to apply exactly once.')
  }
  const rewardedTrainer = context.repositories.sheets.getByRef('trainer', 'trainer-owner')!
  const trainer = context.repositories.sheets.replaceSetupSheet({
    kind: 'trainer',
    slug: 'trainer-owner',
    expectedRevision: rewardedTrainer.revision,
    sheet: {
      ...rewardedTrainer.sheet,
      currentTeam: [child.slug],
    },
    now: 2_001,
  })!
  const hatched = validatePokemonEggRevisionSuccessor(currentEgg, {
    ...currentEgg,
    revision: 1,
    status: 'hatched',
    incubation: { ...currentEgg.incubation },
    special: { ...currentEgg.special, triggerIds: [...currentEgg.special.triggerIds] },
    childSheetSlug: child.slug,
    updatedAtCampaignMinute: 203,
    statusChangedAtCampaignMinute: 203,
    lastOperationId: parsed.operationId,
  })
  const replaced = context.repositories.eggs.replace({ expectedRevision: 0, document: hatched })
  if (replaced.kind !== 'applied') throw new Error('Expected the hatching Egg revision to apply.')
  context.repositories.lineage.insertOrigin(createPokemonBreedingOriginFromHatchedEgg({
    originId: ORIGIN_ID as any,
    egg: hatched,
  }))
  context.appendRealtime(breedingRealtimeRefreshAppendInputs({
    aggregateKind: 'pokemon-egg',
    aggregateId: currentEgg.eggId,
    revision: hatched.revision,
    operationKind: parsed.commandKind,
    audienceTargets: [
      { audience: 'owner', trainerSheetSlug: 'trainer-owner' },
      { audience: 'gm', trainerSheetSlug: null },
    ],
    campaignProjectionKey: PROJECTION_KEY,
    timestamp: 1_700_000_000_001,
  }))
  return accepted(parsed, [
    { kind: 'pokemon-egg', id: hatched.eggId, revision: hatched.revision },
    { kind: 'pokemon-sheet', id: child.slug, revision: child.revision },
    { kind: 'trainer-sheet', id: trainer.sheet.slug as string, revision: trainer.sheet.revision },
  ], 203)
}

describe('Breeding transaction coordinator', () => {
  it('binds the reviewed top-level, connection, rollback, and post-commit contract', () => {
    const contract = JSON.parse(readFileSync(
      'data/breeding-automation/transaction-coordinator-contract.json',
      'utf8',
    )) as Record<string, any>
    expect(contract.definitionSha256).toBe(createHash('sha256')
      .update(stableJsonStringify(contract.definition)).digest('hex'))
    expect(contract.definition.coordinatorPath).toBe('server/useCases/executeBreedingTransaction.ts')
    expect(contract.definition.transaction).toMatchObject({
      reservation: 'durable-phase-1-before-mechanics',
      aggregateAndSettlement: 'one-top-level-SQLite-transaction',
      nestedInvocation: 'reject',
    })
    expect(contract.definition.participants).toEqual([
      'breeding-project', 'pokemon-egg', 'egg-transfer-consent', 'pokemon-sheet', 'trainer-sheet',
      'species-acquisition-history', 'breeding-operation-terminal-result', 'realtime-event-log',
    ])
    expect(contract.definition.transaction.transferAtomicity).toBe('Egg-owner-successor-both-consent-consumptions-result-and-realtime-rows')
    expect(contract.definition.publication).toMatchObject({
      timing: 'after-top-level-commit-only',
      order: 'persisted-global-sequence',
      failure: 'report-and-retain-durable-replay-row',
    })
    expect(contract.definition.authority).toMatchObject({ mapDependency: 'none', encounterDependency: 'none' })
  })

  it('commits a Project, terminal operation, and sequenced refresh rows before publishing, then survives restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'breeding-transaction-project-'))
    roots.push(root)
    const path = join(root, 'campaign.sqlite')
    let database = open(path)
    const projects = createSqliteBreedingProjectRepository(database)
    const operations = createSqliteBreedingOperationRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const published: number[] = []
    const coordinator = createBreedingTransactionCoordinator({
      database,
      projectRepository: projects,
      operationRepository: operations,
      realtimeEventRepository: realtime,
      publish: event => {
        expect(database.connection.isTransaction).toBe(false)
        expect(projects.get(PROJECT_ID)?.revision).toBe(0)
        expect(operations.get(operationId(1))?.status).toBe('accepted')
        expect(realtime.getBySequence(event.sequence)).toEqual(event)
        published.push(event.sequence)
      },
    })
    const command = projectCommand()
    const result = executeProject(coordinator, command)

    expect(result).toMatchObject({ kind: 'executed', publicationFailureCount: 0 })
    expect(result.committedRealtimeEvents.map(event => event.sequence)).toEqual([1, 2])
    expect(published).toEqual([1, 2])
    expect(JSON.stringify(result.committedRealtimeEvents)).not.toContain(PROJECT_ID)

    const planner = vi.fn()
    const replay = coordinator.execute({
      command,
      createdAtCampaignMinute: 100,
      settledAtCampaignMinute: 100,
      execute: planner,
    })
    expect(replay.kind).toBe('exact-retry')
    expect(replay.committedRealtimeEvents).toEqual([])
    expect(planner).not.toHaveBeenCalled()
    expect(published).toEqual([1, 2])

    database.close()
    databases.splice(databases.indexOf(database), 1)
    database = open(path)
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(0)
    expect(createSqliteBreedingOperationRepository(database).get(operationId(1))?.status).toBe('accepted')
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events)
      .toHaveLength(2)
  })

  it('rolls Project and event rows back together, retains pending recovery evidence, and invalidates leaked contexts', () => {
    const database = open()
    const projects = createSqliteBreedingProjectRepository(database)
    const operations = createSqliteBreedingOperationRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const published = vi.fn()
    const coordinator = createBreedingTransactionCoordinator({
      database,
      projectRepository: projects,
      operationRepository: operations,
      realtimeEventRepository: realtime,
      publish: published,
    })
    const command = projectCommand(operationId(3))
    let leakedContext: BreedingTransactionContext | null = null

    expect(() => coordinator.execute({
      command,
      createdAtCampaignMinute: 100,
      settledAtCampaignMinute: 100,
      execute: (parsed, _operation, context) => {
        leakedContext = context
        context.repositories.projects.insert(projectDocument(parsed.operationId))
        context.appendRealtime(breedingRealtimeRefreshAppendInputs({
          aggregateKind: 'breeding-project',
          aggregateId: PROJECT_ID,
          revision: 0,
          operationKind: parsed.commandKind,
          audienceTargets: [{ audience: 'gm', trainerSheetSlug: null }],
          campaignProjectionKey: PROJECTION_KEY,
          timestamp: 1_700_000_000_003,
        }))
        return accepted(parsed, [{ kind: 'breeding-project', id: PROJECT_ID, revision: 0 }], 100)
      },
      beforeSettle: () => { throw new Error('injected before terminal settlement') },
    })).toThrow('injected before terminal settlement')

    expect(projects.get(PROJECT_ID)).toBeNull()
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(operations.get(command.operationId)?.status).toBe('pending')
    expect(published).not.toHaveBeenCalled()
    expect(Object.keys(leakedContext!.repositories.projects)).not.toContain('database')
    expect(() => leakedContext!.repositories.projects.get(PROJECT_ID)).toThrowError(expect.objectContaining({
      code: 'breeding.transaction.inactive-context',
    }))
    expect(() => leakedContext!.appendRealtime(breedingRealtimeRefreshAppendInputs({
      aggregateKind: 'breeding-project',
      aggregateId: PROJECT_ID,
      revision: 0,
      operationKind: command.commandKind,
      audienceTargets: [{ audience: 'gm', trainerSheetSlug: null }],
      campaignProjectionKey: PROJECTION_KEY,
      timestamp: 1_700_000_000_003,
    }))).toThrowError(expect.objectContaining({ code: 'breeding.transaction.inactive-context' }))

    const recovered = coordinator.execute({
      command,
      createdAtCampaignMinute: 100,
      settledAtCampaignMinute: 100,
      resumePending: true,
      execute: (parsed, _operation, context) => {
        context.repositories.projects.insert(projectDocument(parsed.operationId))
        context.appendRealtime(breedingRealtimeRefreshAppendInputs({
          aggregateKind: 'breeding-project',
          aggregateId: PROJECT_ID,
          revision: 0,
          operationKind: parsed.commandKind,
          audienceTargets: [{ audience: 'gm', trainerSheetSlug: null }],
          campaignProjectionKey: PROJECTION_KEY,
          timestamp: 1_700_000_000_003,
        }))
        return accepted(parsed, [{ kind: 'breeding-project', id: PROJECT_ID, revision: 0 }], 100)
      },
    })
    expect(recovered.kind).toBe('executed')
    expect(recovered.committedRealtimeEvents.map(event => event.sequence)).toEqual([1])
    expect(projects.get(PROJECT_ID)).not.toBeNull()
  })

  it('atomically rolls back and recovers Egg, child, Trainer, acquisition history, operation, and events', () => {
    const database = open()
    const initialEgg = seedHatchState(database)
    const eggs = createSqlitePokemonEggRepository(database)
    const sheets = createSqliteSheetRepository(database)
    const acquisitions = createSqliteTrainerSpeciesAcquisitionRepository(database)
    const lineage = createSqliteBreedingLineageRepository(database)
    const operations = createSqliteBreedingOperationRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const childSheets = createSqliteInitializedPokemonSheetRepository({ database })
    const published: number[] = []
    const command = completeHatchCommand()
    const coordinator = createBreedingTransactionCoordinator({
      database,
      eggRepository: eggs,
      sheetRepository: sheets,
      initializedPokemonSheetRepository: childSheets,
      speciesAcquisitionRepository: acquisitions,
      lineageRepository: lineage,
      operationRepository: operations,
      realtimeEventRepository: realtime,
      publish: event => {
        expect(database.connection.isTransaction).toBe(false)
        expect(eggs.get(EGG_ID)).toMatchObject({ status: 'hatched', childSheetSlug: 'sprout' })
        expect(sheets.getByRef('pokemon', 'sprout')).not.toBeNull()
        expect(sheets.getByRef('trainer', 'trainer-owner')).toMatchObject({
          revision: 2,
          sheet: { dexExp: 8, currentTeam: ['sprout'] },
        })
        expect(acquisitions.get('trainer-owner', 'bulbasaur')).not.toBeNull()
        expect(lineage.findOriginByEgg(EGG_ID)).toMatchObject({ originId: ORIGIN_ID, childSheetSlug: 'sprout' })
        expect(operations.get(command.operationId)?.status).toBe('accepted')
        published.push(event.sequence)
      },
    })

    expect(() => coordinator.execute({
      command,
      createdAtCampaignMinute: 203,
      settledAtCampaignMinute: 203,
      execute: (parsed, _operation, context) => planHatch(initialEgg, parsed, context),
      beforeSettle: () => { throw new Error('injected hatch settlement failure') },
    })).toThrow()

    expect(eggs.get(EGG_ID)).toEqual(initialEgg)
    expect(sheets.getByRef('pokemon', 'sprout')).toBeNull()
    expect(sheets.getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 0, sheet: { dexExp: 7, currentTeam: [] } })
    expect(acquisitions.get('trainer-owner', 'bulbasaur')).toBeNull()
    expect(lineage.findOriginByEgg(EGG_ID)).toBeNull()
    expect(operations.get(command.operationId)?.status).toBe('pending')
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(published).toEqual([])

    const recovered = coordinator.execute({
      command,
      createdAtCampaignMinute: 203,
      settledAtCampaignMinute: 203,
      resumePending: true,
      execute: (parsed, _operation, context) => planHatch(eggs.get(EGG_ID)!, parsed, context),
    })
    expect(recovered.kind).toBe('executed')
    expect(recovered.committedRealtimeEvents.map(event => event.sequence)).toEqual([1, 2])
    expect(published).toEqual([1, 2])
    expect(lineage.findOriginByEgg(EGG_ID)).toMatchObject({ originId: ORIGIN_ID, childSheetSlug: 'sprout' })
    expect(acquisitions.get('trainer-owner', 'bulbasaur')).toMatchObject({
      sourceKind: 'hatch',
      sourceEggId: EGG_ID,
      operationId: command.operationId,
      trainerRevisionBeforeReward: 0,
    })
    expect(operations.get(command.operationId)?.result).toMatchObject({
      ok: true,
      aggregateRefs: [
        { kind: 'pokemon-egg', id: EGG_ID, revision: 1 },
        { kind: 'pokemon-sheet', id: 'sprout', revision: 0 },
        { kind: 'trainer-sheet', id: 'trainer-owner', revision: 2 },
      ],
    })
  })

  it('fails closed on mixed connections, nested ownership, async planners, and old event dedupe material', () => {
    const database = open()
    const foreign = open()
    expect(() => createBreedingTransactionCoordinator({
      database,
      projectRepository: createSqliteBreedingProjectRepository(foreign),
    })).toThrowError(expect.objectContaining({ code: 'breeding.transaction.repository-mismatch' }))

    const coordinator = createBreedingTransactionCoordinator({ database })
    const nestedCommand = projectCommand(operationId(10))
    database.withTransaction(() => {
      expect(() => executeProject(coordinator, nestedCommand)).toThrowError(expect.objectContaining({
        code: 'breeding.transaction.nested-boundary',
      }))
    })
    expect(createSqliteBreedingOperationRepository(database).get(nestedCommand.operationId)).toBeNull()

    const asyncCommand = projectCommand(operationId(11))
    expect(() => coordinator.execute({
      command: asyncCommand,
      createdAtCampaignMinute: 100,
      settledAtCampaignMinute: 100,
      execute: (() => Promise.resolve(null)) as never,
    })).toThrowError(expect.objectContaining({ code: 'breeding.transaction.async-executor' }))
    expect(createSqliteBreedingOperationRepository(database).get(asyncCommand.operationId)?.status).toBe('pending')

    const realtime = createSqliteRealtimeEventRepository({ database })
    const oldInputs = breedingRealtimeRefreshAppendInputs({
      aggregateKind: 'breeding-project',
      aggregateId: PROJECT_ID,
      revision: 0,
      operationKind: 'create-breeding-project',
      audienceTargets: [{ audience: 'gm', trainerSheetSlug: null }],
      campaignProjectionKey: PROJECTION_KEY,
      timestamp: 1_700_000_000_010,
    })
    realtime.appendMany(oldInputs)
    const replayCommand = projectCommand(operationId(12))
    expect(() => coordinator.execute({
      command: replayCommand,
      createdAtCampaignMinute: 100,
      settledAtCampaignMinute: 100,
      execute: (parsed, _operation, context) => {
        context.repositories.projects.insert(projectDocument(parsed.operationId))
        context.appendRealtime(oldInputs)
        return accepted(parsed, [{ kind: 'breeding-project', id: PROJECT_ID, revision: 0 }], 100)
      },
    })).toThrowError(expect.objectContaining({ code: 'breeding.transaction.event-replay' }))
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)).toBeNull()
    expect(createSqliteBreedingOperationRepository(database).get(replayCommand.operationId)?.status).toBe('pending')
    expect(realtime.cursorState().latestSequence).toBe(1)
  })

  it('reports publication failures without undoing committed durable rows', () => {
    const database = open()
    const reports = vi.fn()
    const coordinator = createBreedingTransactionCoordinator({
      database,
      publish: event => { if (event.sequence === 1) throw new Error('subscriber unavailable') },
      reportPublicationFailure: context => {
        reports(context)
        throw new Error('broken failure reporter')
      },
    })
    const result = executeProject(coordinator, projectCommand(operationId(20)))
    expect(result).toMatchObject({ kind: 'executed', publicationFailureCount: 1 })
    expect(reports).toHaveBeenCalledOnce()
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)).not.toBeNull()
    expect(createSqliteBreedingOperationRepository(database).get(operationId(20))?.status).toBe('accepted')
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events).toHaveLength(2)
  })
})
