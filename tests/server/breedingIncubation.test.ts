import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import authorityJson from '../fixtures/breeding/egg-production-cross-owner-authority-v1.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import incubationContractJson from '../../data/breeding-automation/incubation-contract.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingEggReadyCorrectionProjectionV1 } from '../../shared/breeding/readinessCorrection'
import { parseBreedingReadResourceV1 } from '../../shared/breeding/readSets'
import type { PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import {
  authorizeBreedingEggIncubationV1,
  authorizeBreedingEggReadinessCorrectionV1,
  createBreedingActorAuthorityV1,
  createBreedingGmOverrideEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
  BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
  planBreedingIncubationAdvanceV1,
  planBreedingIncubationPauseV1,
  pokemonEggIncubationDocumentDefinitionSha256,
  projectBreedingIncubationProgressV1,
} from '../../server/domain/breeding/incubation'
import {
  BREEDING_EGG_WARMER_CAPABILITY_POLICY_DEFINITION_SHA256,
} from '../../server/domain/breeding/eggWarmerCapability'
import { createBreedingEggWarmerCapabilityHandoffV1 } from '../../server/domain/breeding/modifierProviderHandoff'
import {
  BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256,
  BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256,
  BREEDING_READINESS_CORRECTION_PROVIDER_ID,
  planBreedingEggReadinessCorrectionV1,
  projectBreedingEggReadinessCorrectionV1,
} from '../../server/domain/breeding/readinessCorrection'
import {
  createPokemonEggOffspringBlueprintV1,
  parseAuthoritativePokemonEggDocumentV1,
} from '../../server/domain/breeding/lineage'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../../server/domain/breeding/operations'
import { createBreedingOperationReadSetV1 } from '../../server/domain/breeding/readSets'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createSqliteBreedingIncubationSegmentRepository } from '../../server/storage/breedingIncubationSegmentRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationEvidenceRepository } from '../../server/storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  managePokemonEggIncubation,
  queryPokemonEggIncubation,
} from '../../server/useCases/managePokemonEggIncubation'
import { markPokemonEggReady } from '../../server/useCases/markPokemonEggReady'
import { applyPokemonEggWarmerCapability } from '../../server/useCases/applyPokemonEggWarmerCapability'

const authority = authorityJson as any
const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}
const close = (database: RotomDatabase): void => {
  const index = databases.indexOf(database)
  if (index >= 0) databases.splice(index, 1)
  database.close()
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const eggId = (value: number): string => `pokemon-egg:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const overrideId = (value: number): string => `breeding-override:v1:${value.toString(16).padStart(32, '0')}`
const optionId = (value: number): string => `option:v1:${value.toString(16).padStart(32, '0')}`
const sha = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const ruleset = authority.project.ruleset
const EGG_ID = eggId(1)
const OWNER_DOCUMENT = { slug: 'trainer-owner', folder: '' }
const OWNER_AUTH_DOCUMENT = { ...OWNER_DOCUMENT, revision: 5, updatedAt: 100 }
const ownerProfile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0001' as any,
  displayName: 'Owner' as any,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}

const sourceCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(1),
  commandKind: 'create-source-egg',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null }],
  payload: {
    eggId: EGG_ID,
    ownerTrainerSlug: 'trainer-owner',
    source: {
      kind: 'gm',
      reasonId: 'breeding.egg-source.reviewed',
      evidenceDefinitionSha256: 'e'.repeat(64),
    },
    speciesOptionId: optionId(1),
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})

const egg = (): PokemonEggDocumentV1 => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: {
      valueId: 'cuddly',
      resolutionKind: 'fixed',
      rollRecordId: null,
      optionId: null,
      choiceEvidenceId: null,
    },
    ability: {
      valueId: species.basicAbilityIds[0]!,
      resolutionKind: 'fixed',
      rollRecordId: null,
      optionId: null,
      choiceEvidenceId: null,
    },
    gender: {
      valueId: 'female',
      resolutionKind: 'fixed',
      rollRecordId: null,
      optionId: null,
      choiceEvidenceId: null,
    },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  const durationResultDefinitionSha256 = 'd'.repeat(64)
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: 'trainer-owner',
    source: {
      kind: 'gm',
      reasonId: 'breeding.egg-source.reviewed',
      evidenceDefinitionSha256: 'e'.repeat(64),
    },
    ruleset,
    definitionHashes: [
      blueprint.definitionSha256,
      durationResultDefinitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      ruleset.definitionSha256,
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256,
      lastAppliedClockRevision: 1,
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
}

const incubationCommand = (input: {
  operation: number
  kind: 'advance-egg-incubation' | 'set-egg-incubation-pause'
  revision: number
  clockRevision: number
  campaignMinute: number
  role?: 'gm' | 'player'
  paused?: boolean
  reasonId?: string | null
}) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(input.operation),
  commandKind: input.kind,
  actor: input.role === 'gm'
    ? { profileId: 'gm-principal', selectedTrainerSlug: null }
    : { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: input.revision }],
  payload: input.kind === 'advance-egg-incubation'
    ? {
        eggId: EGG_ID,
        throughClockRevision: input.clockRevision,
        throughCampaignMinute: input.campaignMinute,
      }
    : {
        eggId: EGG_ID,
        paused: input.paused ?? true,
        reasonId: input.paused === false ? null : input.reasonId ?? 'breeding.incubation-pause.owner-request',
      },
})

const seed = (path = ':memory:'): { database: RotomDatabase, egg: PokemonEggDocumentV1 } => {
  const database = open(path)
  const command = sourceCommand()
  const initialEgg = egg()
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    operations.reserve(command, 100)
    createSqlitePokemonEggRepository(database).insert(initialEgg)
    operations.settle(command, createBreedingOperationAcceptedV1({
      operationId: command.operationId,
      commandHash: createBreedingOperationCommandHash(command),
      commandKind: command.commandKind,
      outcomeKind: 'source-egg-created',
      aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }],
      changedScopes: command.scopes,
      committedAtCampaignMinute: 100,
    }), 100)
    database.connection.prepare(`
      UPDATE campaign_clock
      SET revision = 1, campaign_minute = 100, last_operation_id = ?
      WHERE singleton = 1
    `).run(command.operationId)
    database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('trainer', 'trainer-owner', ?, 5, 100)
    `).run(stableJsonStringify(OWNER_DOCUMENT))
  })
  return { database, egg: initialEgg }
}
const setClock = (database: RotomDatabase, revision: number, campaignMinute: number): void => {
  database.connection.prepare(`
    UPDATE campaign_clock SET revision = ?, campaign_minute = ?, last_operation_id = ? WHERE singleton = 1
  `).run(revision, campaignMinute, op(1))
}
const resource = (
  resourceKind: string,
  resourceId: string,
  revision: number,
  definitionSha256: string,
  purposes: readonly string[],
  observedCampaignMinute: number | null = null,
) => parseBreedingReadResourceV1({
  resourceKind,
  resourceId,
  existence: 'present',
  revision,
  definitionSha256,
  observedCampaignMinute,
  purposes: [...purposes].sort(),
})
const clockHash = (revision: number, campaignMinute: number): string => sha({
  schemaVersion: 1,
  revision,
  campaignMinute,
  lastOperationId: op(1),
})
const incubationDependencies = (currentEgg: PokemonEggDocumentV1) => {
  const baseRate = {
    providerKind: 'system' as const,
    providerId: BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
    subjectKind: 'pokemon-egg' as const,
    subjectId: EGG_ID,
    subjectRevision: currentEgg.revision,
    checkpoint: 'incubation-operation' as const,
    providerDefinitionSha256: BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  }
  return [{
    providerKind: 'system' as const,
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign' as const,
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization' as const,
    providerDefinitionSha256: securityPolicyJson.definitionSha256,
    effectiveEvidenceSha256: sha([baseRate]),
  }, baseRate]
}
const readSetFor = (
  command: ReturnType<typeof incubationCommand>,
  currentEgg: PokemonEggDocumentV1,
  clockRevision: number,
  campaignMinute: number,
  role: 'gm' | 'player' = 'player',
) => createBreedingOperationReadSetV1({
  readSetId: readSetId(Number.parseInt(command.operationId.slice(-4), 16) || 1) as any,
  operationId: command.operationId,
  commandSha256: createBreedingOperationCommandHash(command),
  commandKind: command.commandKind,
  capturedAtCampaignMinute: campaignMinute,
  resources: [
    resource('campaign-clock', 'campaign-clock', clockRevision, clockHash(clockRevision, campaignMinute), ['campaign-time'], campaignMinute),
    resource('pokemon-egg', EGG_ID, currentEgg.revision, pokemonEggIncubationDocumentDefinitionSha256(currentEgg), ['conflict', 'mechanics']),
    ...(role === 'player'
      ? [resource('trainer-sheet', 'trainer-owner', 5, sha(OWNER_AUTH_DOCUMENT), ['authorization'])]
      : []),
  ],
  referenceVersions: authority.readSet.referenceVersions,
  dependencyEvidence: incubationDependencies(currentEgg),
  writeExpectations: command.scopes,
})
const authorityFor = (
  command: ReturnType<typeof incubationCommand>,
  readSet: ReturnType<typeof readSetFor>,
  currentEgg: PokemonEggDocumentV1,
  role: 'gm' | 'player' = 'player',
) => {
  const actor = createBreedingActorAuthorityV1({
    role,
    command,
    authenticatedPrincipalSha256: (role === 'gm' ? 'c' : 'a').repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64),
    profile: role === 'player' ? ownerProfile : null,
    evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute,
  })
  const control = role === 'player'
    ? createBreedingTrainerControlEvidenceV1({
        profile: ownerProfile,
        trainerSheetSlug: 'trainer-owner',
        trainerSheetRevision: 5,
        trainerSheetDefinitionSha256: sha(OWNER_AUTH_DOCUMENT),
        evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute,
      })
    : null
  const overrides = role === 'gm'
    ? [createBreedingGmOverrideEvidenceV1({
        overrideId: overrideId(Number.parseInt(command.operationId.slice(-4), 16) || 1) as any,
        command,
        actorAuthority: actor,
        overrideKind: 'owner-control',
        target: { kind: 'trainer-sheet', trainerSheetSlug: 'trainer-owner' },
        reasonId: 'breeding.override.owner-control',
        createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
        securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
      })]
    : []
  const receipt = authorizeBreedingEggIncubationV1({
    command,
    readSet,
    actorAuthority: actor,
    trainerControl: control,
    egg: currentEgg,
    gmOverrides: overrides,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  return { actor, control, overrides, receipt }
}
const request = (
  command: ReturnType<typeof incubationCommand>,
  readSet: ReturnType<typeof readSetFor>,
  auth: ReturnType<typeof authorityFor>,
  audience: 'gm' | 'owner' = 'owner',
) => ({
  command,
  readSet,
  authorizationReceipt: auth.receipt,
  actorAuthority: auth.actor,
  trainerControl: auth.control,
  gmOverrides: auth.overrides,
  audience,
})
const options = (database: RotomDatabase, extra: Record<string, unknown> = {}) => ({
  database,
  campaignProjectionKey: 'campaign-secret-key-with-at-least-32-bytes',
  realtimeTimestamp: 1_700_000_000_000,
  ...extra,
})

const readinessCommand = (input: {
  operation: number
  revision: number
  reasonId?: string
}) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(input.operation),
  commandKind: 'mark-egg-ready',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: input.revision }],
  payload: {
    eggId: EGG_ID,
    reasonId: input.reasonId ?? 'breeding.egg-ready.incubation-correction',
  },
})
const readinessDependencies = (currentEgg: PokemonEggDocumentV1) => {
  const correction = {
    providerKind: 'system' as const,
    providerId: BREEDING_READINESS_CORRECTION_PROVIDER_ID,
    subjectKind: 'pokemon-egg' as const,
    subjectId: EGG_ID,
    subjectRevision: currentEgg.revision,
    checkpoint: 'incubation-operation' as const,
    providerDefinitionSha256: BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256,
  }
  return [{
    providerKind: 'system' as const,
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign' as const,
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization' as const,
    providerDefinitionSha256: securityPolicyJson.definitionSha256,
    effectiveEvidenceSha256: sha([correction]),
  }, correction]
}
const readinessReadSetFor = (
  command: ReturnType<typeof readinessCommand>,
  currentEgg: PokemonEggDocumentV1,
  clockRevision: number,
  campaignMinute: number,
) => createBreedingOperationReadSetV1({
  readSetId: readSetId(Number.parseInt(command.operationId.slice(-4), 16) || 1) as any,
  operationId: command.operationId,
  commandSha256: createBreedingOperationCommandHash(command),
  commandKind: command.commandKind,
  capturedAtCampaignMinute: campaignMinute,
  resources: [
    resource('campaign-clock', 'campaign-clock', clockRevision, clockHash(clockRevision, campaignMinute), ['campaign-time'], campaignMinute),
    resource('pokemon-egg', EGG_ID, currentEgg.revision, pokemonEggIncubationDocumentDefinitionSha256(currentEgg), ['conflict', 'mechanics']),
  ],
  referenceVersions: authority.readSet.referenceVersions,
  dependencyEvidence: readinessDependencies(currentEgg),
  writeExpectations: command.scopes,
})
const readinessAuthorityFor = (
  command: ReturnType<typeof readinessCommand>,
  readSet: ReturnType<typeof readinessReadSetFor>,
  currentEgg: PokemonEggDocumentV1,
  includeOverride = true,
) => {
  const actor = createBreedingActorAuthorityV1({
    role: 'gm',
    command,
    authenticatedPrincipalSha256: 'c'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64),
    profile: null,
    evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute,
  })
  const overrides = includeOverride
    ? [createBreedingGmOverrideEvidenceV1({
        overrideId: overrideId(Number.parseInt(command.operationId.slice(-4), 16) || 1) as any,
        command,
        actorAuthority: actor,
        overrideKind: 'operation-recovery',
        target: { kind: 'breeding-operation', operationId: command.operationId },
        reasonId: 'breeding.override.egg-readiness-correction',
        createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
        securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
      })]
    : []
  const receipt = authorizeBreedingEggReadinessCorrectionV1({
    command,
    readSet,
    actorAuthority: actor,
    egg: currentEgg,
    gmOverrides: overrides,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  return { actor, overrides, receipt }
}
const readinessRequest = (
  command: ReturnType<typeof readinessCommand>,
  readSet: ReturnType<typeof readinessReadSetFor>,
  auth: ReturnType<typeof readinessAuthorityFor>,
) => ({
  command,
  readSet,
  authorizationReceipt: auth.receipt,
  actorAuthority: auth.actor,
  gmOverrides: auth.overrides,
})

const currentOwnerQueryAuthority = (
  currentEgg: PokemonEggDocumentV1,
  clockRevision: number,
  campaignMinute: number,
) => {
  const command = incubationCommand({ operation: 90, kind: 'advance-egg-incubation', revision: currentEgg.revision, clockRevision, campaignMinute })
  const actor = createBreedingActorAuthorityV1({
    role: 'player',
    command,
    authenticatedPrincipalSha256: 'a'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64),
    profile: ownerProfile,
    evaluatedAtCampaignMinute: campaignMinute,
  })
  const control = createBreedingTrainerControlEvidenceV1({
    profile: ownerProfile,
    trainerSheetSlug: 'trainer-owner',
    trainerSheetRevision: 5,
    trainerSheetDefinitionSha256: sha(OWNER_AUTH_DOCUMENT),
    evaluatedAtCampaignMinute: campaignMinute,
  })
  return { actor, control }
}

describe('authoritative Pokémon Egg incubation', () => {
  it('accumulates base-rate campaign minutes, clamps totals, and records exact readiness and overflow', () => {
    expect(incubationContractJson.definitionSha256).toBe(sha(incubationContractJson.definition))
    expect(incubationContractJson.definition.modifierPolicy).toMatchObject({
      policyDefinitionSha256: BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
      baseRateEvidenceDefinitionSha256: BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
      currentExecutableMode: 'base-rate-or-authoritative-continuous-rate',
    })
    const initial = egg()
    const firstCommand = incubationCommand({ operation: 10, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 350 })
    const first = planBreedingIncubationAdvanceV1({
      egg: initial,
      command: firstCommand,
      campaignClock: { revision: 2, campaignMinute: 350, lastOperationId: op(1) },
      modifierContributions: [],
    })
    expect(first.egg).toMatchObject({ revision: 1, status: 'incubating', incubation: { accumulatedCampaignMinutes: 250 } })
    expect(first.segment).toMatchObject({ elapsedCampaignMinutes: 250, creditedCampaignMinutes: 250, skippedCampaignMinutes: 0, overflowCampaignMinutes: 0, reachedReady: false })

    const secondCommand = incubationCommand({ operation: 11, kind: 'advance-egg-incubation', revision: 1, clockRevision: 3, campaignMinute: 800 })
    const second = planBreedingIncubationAdvanceV1({
      egg: first.egg,
      command: secondCommand,
      campaignClock: { revision: 3, campaignMinute: 800, lastOperationId: op(1) },
      modifierContributions: [],
    })
    expect(second.egg).toMatchObject({
      revision: 2,
      status: 'ready',
      incubation: {
        accumulatedCampaignMinutes: 600,
        readyAtCampaignMinute: 700,
        readinessKind: 'incubation-complete',
        readyOperationId: secondCommand.operationId,
      },
    })
    expect(second.segment).toMatchObject({
      elapsedCampaignMinutes: 450,
      creditedCampaignMinutes: 350,
      overflowCampaignMinutes: 100,
      accumulatedAfterCampaignMinutes: 600,
      readyAtCampaignMinute: 700,
    })
  })

  it('credits the valid prefix before pause, skips paused campaign time, and resumes from a durable checkpoint', () => {
    const pauseCommand = incubationCommand({ operation: 12, kind: 'set-egg-incubation-pause', revision: 0, clockRevision: 2, campaignMinute: 200 })
    const paused = planBreedingIncubationPauseV1({
      egg: egg(),
      command: pauseCommand,
      campaignClock: { revision: 2, campaignMinute: 200, lastOperationId: op(1) },
      modifierContributions: [],
    })
    expect(paused.egg.incubation).toMatchObject({ accumulatedCampaignMinutes: 100, paused: true, pauseOperationId: pauseCommand.operationId })
    expect(paused.segment).toMatchObject({ creditedCampaignMinutes: 100, pauseMutation: 'paused', pausedDuringSegment: false })

    const skippedCommand = incubationCommand({ operation: 13, kind: 'advance-egg-incubation', revision: 1, clockRevision: 3, campaignMinute: 300 })
    const skipped = planBreedingIncubationAdvanceV1({
      egg: paused.egg,
      command: skippedCommand,
      campaignClock: { revision: 3, campaignMinute: 300, lastOperationId: op(1) },
      modifierContributions: [],
    })
    expect(skipped.egg.incubation.accumulatedCampaignMinutes).toBe(100)
    expect(skipped.segment).toMatchObject({ skippedCampaignMinutes: 100, creditedCampaignMinutes: 0, pausedDuringSegment: true })

    const resumeCommand = incubationCommand({ operation: 14, kind: 'set-egg-incubation-pause', revision: 2, clockRevision: 3, campaignMinute: 300, paused: false })
    const resumed = planBreedingIncubationPauseV1({
      egg: skipped.egg,
      command: resumeCommand,
      campaignClock: { revision: 3, campaignMinute: 300, lastOperationId: op(1) },
      modifierContributions: [],
    })
    expect(resumed.egg.incubation).toMatchObject({ accumulatedCampaignMinutes: 100, paused: false, pauseReasonId: null, pauseOperationId: null })
    expect(resumed.segment).toMatchObject({ elapsedCampaignMinutes: 0, pauseMutation: 'resumed', pausedDuringSegment: true })
  })

  it('commits Egg, immutable segment result, operation result, and four privacy-scoped refreshes exactly once', () => {
    const seeded = seed()
    setClock(seeded.database, 2, 250)
    const command = incubationCommand({ operation: 20, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 250 })
    const readSet = readSetFor(command, seeded.egg, 2, 250)
    const auth = authorityFor(command, readSet, seeded.egg)
    const first = managePokemonEggIncubation(request(command, readSet, auth), options(seeded.database))
    expect(first.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'egg-progressed' })
    expect(first.egg).toMatchObject({ revision: 1, incubation: { accumulatedCampaignMinutes: 150 } })
    expect(first.segment).toMatchObject({ operationId: command.operationId, creditedCampaignMinutes: 150, eggRevisionAfter: 1 })
    expect(first.execution.committedRealtimeEvents).toHaveLength(4)
    expect(first.execution.committedRealtimeEvents.some(event => JSON.stringify(event).includes('participating-owner'))).toBe(false)
    expect(JSON.stringify(first.projection)).not.toMatch(/species|nature|ability|gender|parent|breeder|profile|definition|sha256|roll|offer/iu)

    const retry = managePokemonEggIncubation(request(command, readSet, auth), options(seeded.database))
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.egg?.revision).toBe(1)
    expect(retry.segment).toEqual(first.segment)
    expect(retry.execution.committedRealtimeEvents).toEqual([])
  })

  it('rejects stale clocks and unavailable provider reducers without changing Egg totals or publishing', () => {
    const stale = seed()
    setClock(stale.database, 2, 250)
    const staleCommand = incubationCommand({ operation: 21, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 250 })
    const staleReadSet = readSetFor(staleCommand, stale.egg, 2, 250)
    const staleAuth = authorityFor(staleCommand, staleReadSet, stale.egg)
    setClock(stale.database, 3, 251)
    const staleResult = managePokemonEggIncubation(request(staleCommand, staleReadSet, staleAuth), options(stale.database))
    expect(staleResult.execution.record.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.stale-revision' })
    expect(staleResult.egg).toMatchObject({ revision: 0, incubation: { accumulatedCampaignMinutes: 0 } })
    expect(staleResult.segment).toBeNull()
    expect(staleResult.execution.committedRealtimeEvents).toEqual([])

    const unsupported = seed()
    setClock(unsupported.database, 2, 250)
    const command = incubationCommand({ operation: 22, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 250 })
    const readSet = readSetFor(command, unsupported.egg, 2, 250)
    const auth = authorityFor(command, readSet, unsupported.egg)
    const contributionDefinition = {
      schemaVersion: 1 as const,
      providerKind: 'item' as const,
      providerId: 'egg-warmer',
      checkpoint: 'continuous' as const,
      effect: 'progress-rate-multiplier' as const,
      numerator: 2,
      denominator: 1,
      subjectKind: 'pokemon-egg' as const,
      subjectId: EGG_ID,
      subjectRevision: 0,
      providerDefinitionSha256: 'f'.repeat(64),
      effectiveEvidenceSha256: '1'.repeat(64),
    }
    const result = managePokemonEggIncubation(request(command, readSet, auth), options(unsupported.database, {
      resolveCurrentModifierContributions: () => [{
        ...contributionDefinition,
        definitionSha256: sha(contributionDefinition),
      }],
    }))
    expect(result.execution.record.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.unavailable' })
    expect(result.egg?.revision).toBe(0)
    expect(result.segment).toBeNull()
    expect(result.execution.committedRealtimeEvents).toEqual([])
  })

  it('rolls back Egg, segment, result, and realtime rows together, then exactly resumes the pending reservation', () => {
    const seeded = seed()
    setClock(seeded.database, 2, 200)
    const command = incubationCommand({ operation: 23, kind: 'set-egg-incubation-pause', revision: 0, clockRevision: 2, campaignMinute: 200 })
    const readSet = readSetFor(command, seeded.egg, 2, 200)
    const auth = authorityFor(command, readSet, seeded.egg)
    expect(() => managePokemonEggIncubation(request(command, readSet, auth), options(seeded.database, {
      beforeSettle: () => { throw new Error('incubation-rollback') },
    }))).toThrow('incubation-rollback')
    expect(createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)?.revision).toBe(0)
    expect(createSqliteBreedingIncubationSegmentRepository(seeded.database).get(command.operationId)).toBeNull()
    expect(createSqliteBreedingOperationRepository(seeded.database).get(command.operationId)?.status).toBe('pending')
    expect(createSqliteBreedingOperationEvidenceRepository(seeded.database).get(command.operationId)).toMatchObject({
      readSet: { definitionSha256: readSet.definitionSha256 },
      authorizationReceipt: { definitionSha256: auth.receipt.definitionSha256 },
    })
    expect((seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as any).count).toBe(0)

    const recovered = managePokemonEggIncubation(request(command, readSet, auth), options(seeded.database, { resumePending: true }))
    expect(recovered.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'egg-pause-set' })
    expect(recovered.egg?.incubation).toMatchObject({ paused: true, accumulatedCampaignMinutes: 100 })
    expect(recovered.segment).toMatchObject({ pauseMutation: 'paused', creditedCampaignMinutes: 100 })
  })

  it('requires exact owner control or one command-bound GM override and limits progress queries to current viewers', () => {
    const seeded = seed()
    setClock(seeded.database, 2, 250)
    const gmCommand = incubationCommand({ operation: 24, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 250, role: 'gm' })
    const gmReadSet = readSetFor(gmCommand, seeded.egg, 2, 250, 'gm')
    const gmAuth = authorityFor(gmCommand, gmReadSet, seeded.egg, 'gm')
    expect(gmAuth.receipt).toMatchObject({ authorized: true, gmOverrideIds: [gmAuth.overrides[0]!.overrideId] })
    const result = managePokemonEggIncubation(request(gmCommand, gmReadSet, gmAuth, 'gm'), options(seeded.database))
    expect(result.egg?.revision).toBe(1)

    const currentEgg = result.egg!
    const owner = currentOwnerQueryAuthority(currentEgg, 2, 250)
    const ownerProjection = queryPokemonEggIncubation({
      eggId: EGG_ID,
      actorAuthority: owner.actor,
      trainerControl: owner.control,
      audience: 'owner',
    }, { database: seeded.database })
    expect(ownerProjection).toMatchObject({ revision: 1, accumulatedCampaignMinutes: 150, remainingCampaignMinutes: 450, progressBasisPoints: 2500 })

    const otherProfile: PlayerProfile = {
      schemaVersion: 1,
      id: 'profile_other_0001' as any,
      displayName: 'Other' as any,
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-other' }],
    }
    const otherCommand = parseBreedingOperationCommandV1({
      ...incubationCommand({ operation: 92, kind: 'advance-egg-incubation', revision: 1, clockRevision: 2, campaignMinute: 250 }),
      actor: { profileId: otherProfile.id, selectedTrainerSlug: 'trainer-other' },
    })
    const otherActor = createBreedingActorAuthorityV1({
      role: 'player', command: otherCommand, authenticatedPrincipalSha256: 'd'.repeat(64),
      authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: otherProfile, evaluatedAtCampaignMinute: 250,
    })
    const otherControl = createBreedingTrainerControlEvidenceV1({
      profile: otherProfile, trainerSheetSlug: 'trainer-other', trainerSheetRevision: 1,
      trainerSheetDefinitionSha256: 'e'.repeat(64), evaluatedAtCampaignMinute: 250,
    })
    expect(() => queryPokemonEggIncubation({
      eggId: EGG_ID, actorAuthority: otherActor, trainerControl: otherControl, audience: 'owner',
    }, { database: seeded.database })).toThrowError('Incubation query is unavailable for this viewer.')
    expect(() => queryPokemonEggIncubation({
      eggId: eggId(999), actorAuthority: otherActor, trainerControl: otherControl, audience: 'owner',
    }, { database: seeded.database })).toThrowError('Incubation query is unavailable for this viewer.')

    const gmQueryCommand = incubationCommand({ operation: 91, kind: 'advance-egg-incubation', revision: 1, clockRevision: 2, campaignMinute: 250, role: 'gm' })
    const gmActor = createBreedingActorAuthorityV1({
      role: 'gm',
      command: gmQueryCommand,
      authenticatedPrincipalSha256: 'c'.repeat(64),
      authenticationPolicyDefinitionSha256: 'b'.repeat(64),
      profile: null,
      evaluatedAtCampaignMinute: 250,
    })
    expect(queryPokemonEggIncubation({ eggId: EGG_ID, actorAuthority: gmActor, trainerControl: null, audience: 'gm' }, {
      database: seeded.database,
      validateCurrentGmAuthority: actor => actor.role === 'gm',
    })).toMatchObject({ audience: 'gm', accumulatedCampaignMinutes: 150 })
    expect(() => queryPokemonEggIncubation({ eggId: EGG_ID, actorAuthority: gmActor, trainerControl: null, audience: 'gm' }, { database: seeded.database })).toThrowError(expect.objectContaining({ code: 'breeding.incubation-use-case.invalid-authority' }))
    expect(() => queryPokemonEggIncubation({ eggId: EGG_ID, actorAuthority: gmActor, trainerControl: null, audience: 'gm' }, {
      database: seeded.database,
      validateCurrentGmAuthority: () => { throw new Error('verifier-fault') },
    })).toThrowError(expect.objectContaining({ code: 'breeding.incubation-use-case.invalid-authority' }))
  })

  it('fails closed on direct segment writes, malformed authority, enriched requests, and accessor-backed queries', () => {
    const seeded = seed()
    expect(() => createSqliteBreedingIncubationSegmentRepository(seeded.database).insert({
      command: incubationCommand({ operation: 25, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 200 }),
      segment: {} as any,
    })).toThrow('caller-owned SQLite transaction')

    setClock(seeded.database, 2, 200)
    const command = incubationCommand({ operation: 25, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 200 })
    const readSet = readSetFor(command, seeded.egg, 2, 200)
    const auth = authorityFor(command, readSet, seeded.egg)
    const enriched = { ...request(command, readSet, auth), mapId: 'forbidden' }
    expect(() => managePokemonEggIncubation(enriched as any, options(seeded.database))).toThrowError(expect.objectContaining({ code: 'breeding.incubation-use-case.invalid-request' }))
    const hiddenEnrichment = { ...request(command, readSet, auth) }
    Object.defineProperty(hiddenEnrichment, 'hiddenPatch', { value: true, enumerable: false })
    expect(() => managePokemonEggIncubation(hiddenEnrichment as any, options(seeded.database))).toThrowError(expect.objectContaining({ code: 'breeding.incubation-use-case.invalid-request' }))
    const enrichedModifiers: unknown[] = []
    Object.defineProperty(enrichedModifiers, 'hiddenPatch', { value: true, enumerable: false })
    expect(() => planBreedingIncubationAdvanceV1({
      egg: seeded.egg,
      command,
      campaignClock: { revision: 2, campaignMinute: 200, lastOperationId: op(1) },
      modifierContributions: enrichedModifiers,
    })).toThrowError(expect.objectContaining({ code: 'breeding.incubation.invalid-document' }))
    seeded.database.withTransaction(() => {
      createSqliteBreedingOperationRepository(seeded.database).reserve(command, 200)
    })
    expect(() => managePokemonEggIncubation(request(command, readSet, auth), options(seeded.database, {
      resumePending: true,
    }))).toThrowError(expect.objectContaining({ code: 'breeding.incubation-use-case.invalid-authority' }))

    const owner = currentOwnerQueryAuthority(seeded.egg, 2, 200)
    const accessor = { eggId: EGG_ID, actorAuthority: owner.actor, trainerControl: owner.control, audience: 'owner' } as any
    Object.defineProperty(accessor, 'eggId', { enumerable: true, get: () => EGG_ID })
    expect(() => queryPokemonEggIncubation(accessor, { database: seeded.database })).toThrowError(expect.objectContaining({ code: 'breeding.incubation-use-case.invalid-request' }))
    expect(createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)?.revision).toBe(0)
  })

  it('retains exact segment and operation evidence across a file-database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'breeding-incubation-'))
    tempRoots.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const first = seed(path)
    setClock(first.database, 2, 250)
    const command = incubationCommand({ operation: 26, kind: 'advance-egg-incubation', revision: 0, clockRevision: 2, campaignMinute: 250 })
    const readSet = readSetFor(command, first.egg, 2, 250)
    const auth = authorityFor(command, readSet, first.egg)
    const accepted = managePokemonEggIncubation(request(command, readSet, auth), options(first.database))
    close(first.database)

    const reopened = open(path)
    expect(createSqliteBreedingIncubationSegmentRepository(reopened).get(command.operationId)).toEqual(accepted.segment)
    const replay = managePokemonEggIncubation(request(command, readSet, auth), options(reopened))
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.segment).toEqual(accepted.segment)
    expect(replay.execution.committedRealtimeEvents).toEqual([])
  })

  it('plans GM readiness at the current campaign checkpoint without editing totals, target, or progress clocks', () => {
    const initial = egg()
    const command = readinessCommand({ operation: 40, revision: 0 })
    const ready = planBreedingEggReadinessCorrectionV1({
      egg: initial,
      command,
      campaignClock: {
        schemaVersion: 1,
        revision: 2,
        campaignMinute: 250,
        lastOperationId: op(1),
      },
    })
    expect(ready).toMatchObject({
      revision: 1,
      status: 'ready',
      incubation: {
        targetCampaignMinutes: 600,
        accumulatedCampaignMinutes: 0,
        lastAppliedClockRevision: 1,
        lastAppliedClockMinute: 100,
        readinessKind: 'gm-mark-ready',
        readyAtCampaignMinute: 250,
        readyOperationId: command.operationId,
      },
    })
    const projection = projectBreedingEggReadinessCorrectionV1({
      egg: ready,
      operationId: command.operationId,
      acceptedEggRevision: 1,
      reasonId: command.payload.reasonId,
      committedAtCampaignMinute: 250,
    })
    expect(parseBreedingEggReadyCorrectionProjectionV1(projection)).toEqual(projection)
    expect(projection).toMatchObject({
      audience: 'gm',
      reasonId: 'breeding.egg-ready.incubation-correction',
      accumulatedCampaignMinutes: 0,
      targetCampaignMinutes: 600,
    })
    expect(JSON.stringify(projection)).not.toMatch(/species|nature|ability|gender|parent|breeder|profile|definition|sha256|roll|offer/iu)

    expect(projectBreedingIncubationProgressV1({
      egg: initial,
      audience: 'gm',
      generatedAtCampaignMinute: 250,
    }).availableActions).toEqual(['advance-egg-incubation', 'set-egg-incubation-pause', 'mark-egg-ready'])
    expect(projectBreedingIncubationProgressV1({
      egg: initial,
      audience: 'owner',
      generatedAtCampaignMinute: 250,
    }).availableActions).toEqual(['advance-egg-incubation', 'set-egg-incubation-pause'])
  })

  it('atomically accepts one audited GM correction, emits four refreshes, and keeps exact retries silent', () => {
    const seeded = seed()
    setClock(seeded.database, 2, 250)
    const command = readinessCommand({ operation: 41, revision: 0 })
    const readSet = readinessReadSetFor(command, seeded.egg, 2, 250)
    const auth = readinessAuthorityFor(command, readSet, seeded.egg)
    expect(auth.receipt).toMatchObject({
      authorized: true,
      gmOverrideIds: [auth.overrides[0]!.overrideId],
    })

    const accepted = markPokemonEggReady(
      readinessRequest(command, readSet, auth),
      options(seeded.database),
    )
    expect(accepted.execution.record.result).toMatchObject({
      ok: true,
      outcomeKind: 'egg-ready',
      committedAtCampaignMinute: 250,
    })
    expect(accepted.egg).toMatchObject({
      revision: 1,
      status: 'ready',
      incubation: {
        accumulatedCampaignMinutes: 0,
        targetCampaignMinutes: 600,
        readinessKind: 'gm-mark-ready',
        readyOperationId: command.operationId,
      },
    })
    expect(accepted.projection).toMatchObject({
      acceptedEggRevision: 1,
      currentEggRevision: 1,
      reasonId: command.payload.reasonId,
    })
    expect(accepted.execution.committedRealtimeEvents).toHaveLength(4)
    expect(accepted.execution.committedRealtimeEvents.some(event => JSON.stringify(event).includes('participating-owner'))).toBe(false)
    expect(createSqliteBreedingIncubationSegmentRepository(seeded.database).get(command.operationId)).toBeNull()
    expect(createSqliteBreedingOperationEvidenceRepository(seeded.database).get(command.operationId)).toMatchObject({
      readSet: { definitionSha256: readSet.definitionSha256 },
      authorizationReceipt: { definitionSha256: auth.receipt.definitionSha256 },
    })

    const retry = markPokemonEggReady(
      readinessRequest(command, readSet, auth),
      options(seeded.database),
    )
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.execution.committedRealtimeEvents).toEqual([])
    expect(retry.projection).toEqual(accepted.projection)
  })

  it('requires a closed reason and one self-targeted GM override, and blocks paused or repeated corrections', () => {
    const initial = egg()
    const command = readinessCommand({ operation: 42, revision: 0 })
    const readSet = readinessReadSetFor(command, initial, 2, 200)
    const missingOverride = readinessAuthorityFor(command, readSet, initial, false)
    expect(missingOverride.receipt).toMatchObject({
      authorized: false,
      reasonId: 'breeding.authorization.gm-override-invalid',
    })

    const openReason = readinessCommand({
      operation: 43,
      revision: 0,
      reasonId: 'breeding.egg-ready.free-text-repair',
    })
    expect(() => planBreedingEggReadinessCorrectionV1({
      egg: initial,
      command: openReason,
      campaignClock: { schemaVersion: 1, revision: 2, campaignMinute: 200, lastOperationId: op(1) },
    })).toThrowError(expect.objectContaining({ code: 'breeding.readiness-correction.invalid-authority' }))

    const pauseCommand = incubationCommand({
      operation: 44,
      kind: 'set-egg-incubation-pause',
      revision: 0,
      clockRevision: 2,
      campaignMinute: 200,
      role: 'gm',
      reasonId: 'breeding.incubation-pause.gm-maintenance',
    })
    const paused = planBreedingIncubationPauseV1({
      egg: initial,
      command: pauseCommand,
      campaignClock: { revision: 2, campaignMinute: 200, lastOperationId: op(1) },
      modifierContributions: [],
    }).egg
    expect(projectBreedingIncubationProgressV1({
      egg: paused,
      audience: 'gm',
      generatedAtCampaignMinute: 200,
    }).availableActions).not.toContain('mark-egg-ready')
    expect(() => planBreedingEggReadinessCorrectionV1({
      egg: paused,
      command: readinessCommand({ operation: 45, revision: 1 }),
      campaignClock: { schemaVersion: 1, revision: 2, campaignMinute: 200, lastOperationId: op(1) },
    })).toThrowError(expect.objectContaining({ code: 'breeding.readiness-correction.unavailable' }))

    const ready = planBreedingEggReadinessCorrectionV1({
      egg: initial,
      command,
      campaignClock: { schemaVersion: 1, revision: 2, campaignMinute: 200, lastOperationId: op(1) },
    })
    expect(() => planBreedingEggReadinessCorrectionV1({
      egg: ready,
      command: readinessCommand({ operation: 46, revision: 1 }),
      campaignClock: { schemaVersion: 1, revision: 2, campaignMinute: 200, lastOperationId: op(1) },
    })).toThrowError(expect.objectContaining({ code: 'breeding.readiness-correction.unavailable' }))
  })

  it('rolls readiness mutation, result, and realtime back together and resumes its durable reservation', () => {
    const seeded = seed()
    setClock(seeded.database, 2, 250)
    const command = readinessCommand({ operation: 47, revision: 0 })
    const readSet = readinessReadSetFor(command, seeded.egg, 2, 250)
    const auth = readinessAuthorityFor(command, readSet, seeded.egg)
    expect(() => markPokemonEggReady(
      readinessRequest(command, readSet, auth),
      options(seeded.database, { beforeSettle: () => { throw new Error('readiness-rollback') } }),
    )).toThrow('readiness-rollback')
    expect(createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)?.revision).toBe(0)
    expect(createSqliteBreedingOperationRepository(seeded.database).get(command.operationId)?.status).toBe('pending')
    expect(createSqliteBreedingOperationEvidenceRepository(seeded.database).get(command.operationId)).not.toBeNull()
    expect((seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as any).count).toBe(0)

    const resumed = markPokemonEggReady(
      readinessRequest(command, readSet, auth),
      options(seeded.database, { resumePending: true }),
    )
    expect(resumed.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'egg-ready' })
    expect(resumed.egg).toMatchObject({ revision: 1, status: 'ready' })

    const stale = seed()
    setClock(stale.database, 2, 250)
    const staleCommand = readinessCommand({ operation: 48, revision: 0 })
    const staleReadSet = readinessReadSetFor(staleCommand, stale.egg, 2, 250)
    const staleAuth = readinessAuthorityFor(staleCommand, staleReadSet, stale.egg)
    setClock(stale.database, 3, 251)
    const rejected = markPokemonEggReady(
      readinessRequest(staleCommand, staleReadSet, staleAuth),
      options(stale.database),
    )
    expect(rejected.execution.record.result).toMatchObject({
      ok: false,
      reasonId: 'breeding.operation.stale-revision',
    })
    expect(createSqlitePokemonEggRepository(stale.database).get(EGG_ID)?.revision).toBe(0)
    expect(rejected.execution.committedRealtimeEvents).toEqual([])
  })

  it('atomically persists and applies one current Egg Warmer Capability d10 with a campaign-time cooldown', () => {
    const seeded = seed()
    const sourceDocument = { slug: 'pokemon-fire', revision: 3, nickname: 'Fire', species: 'Ponyta', level: 20 }
    seeded.database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('pokemon', 'pokemon-fire', ?, 3, 100)
    `).run(stableJsonStringify(sourceDocument))
    const storedSource = createSqliteSheetRepository(seeded.database).get('pokemon', 'pokemon-fire')!
    const command = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: op(60),
      commandKind: 'apply-egg-warmer-capability',
      actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
      ruleset,
      scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
      payload: { eggId: EGG_ID, sourcePokemonSheetSlug: 'pokemon-fire', expectedSourcePokemonSheetRevision: 3, requestReductionRoll: true },
    })
    const resolveEffectiveCapabilities = () => ({
      actorPlacementId: 'breeding:pokemon-fire', unresolved: [], instances: [{
        instanceId: 'capability:egg-warmer:source', canonicalId: 'Egg Warmer', parameters: {}, value: null,
        effective: true, suppressionReasons: [], sources: [], primarySource: { kind: 'species-default', sourceId: 'species:ponyta', precedence: 1, label: 'Egg Warmer', value: null }, sourceEffectSha256: '5'.repeat(64),
      }],
    }) as any
    const resourceEvidenceDefinitionSha256 = sha({
      schemaVersion: 1,
      policyDefinitionSha256: BREEDING_EGG_WARMER_CAPABILITY_POLICY_DEFINITION_SHA256,
      sourcePokemonSheetSlug: 'pokemon-fire',
      latestReservedOrAcceptedUse: null,
    })
    const handoff = createBreedingEggWarmerCapabilityHandoffV1({
      egg: seeded.egg,
      sourcePokemonSheet: { slug: storedSource.slug, revision: storedSource.revision, document: storedSource.document },
      capturedAtCampaignMinute: 100,
      resourceEvidenceDefinitionSha256,
    }, { resolveEffectiveCapabilities })
    const dependencies = [...handoff.dependencyEvidence]
    const readSet = createBreedingOperationReadSetV1({
      readSetId: readSetId(60) as any,
      operationId: command.operationId,
      commandSha256: createBreedingOperationCommandHash(command),
      commandKind: command.commandKind,
      capturedAtCampaignMinute: 100,
      resources: [
        resource('campaign-clock', 'campaign-clock', 1, clockHash(1, 100), ['campaign-time'], 100),
        resource('pokemon-egg', EGG_ID, 0, pokemonEggIncubationDocumentDefinitionSha256(seeded.egg), ['conflict', 'mechanics']),
        resource('pokemon-sheet', 'pokemon-fire', 3, sha(storedSource.document), ['mechanics']),
      ],
      referenceVersions: authority.readSet.referenceVersions,
      dependencyEvidence: [{
        providerKind: 'system', providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign', subjectId: 'campaign', subjectRevision: null,
        checkpoint: 'authorization', providerDefinitionSha256: securityPolicyJson.definitionSha256, effectiveEvidenceSha256: sha(dependencies),
      }, ...dependencies],
      writeExpectations: command.scopes,
    })
    const actor = createBreedingActorAuthorityV1({ role: 'gm', command, authenticatedPrincipalSha256: 'c'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: null, evaluatedAtCampaignMinute: 100 })
    const overrides = [createBreedingGmOverrideEvidenceV1({
      overrideId: overrideId(60) as any, command, actorAuthority: actor, overrideKind: 'owner-control',
      target: { kind: 'trainer-sheet', trainerSheetSlug: 'trainer-owner' }, reasonId: 'breeding.override.owner-control',
      createdAtCampaignMinute: 100, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
    })]
    const receipt = authorizeBreedingEggIncubationV1({ command, readSet, actorAuthority: actor, trainerControl: null, egg: seeded.egg, gmOverrides: overrides, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })
    const applied = applyPokemonEggWarmerCapability({ command, readSet, authorizationReceipt: receipt, actorAuthority: actor, trainerControl: null, gmOverrides: overrides }, {
      ...options(seeded.database), resolveEffectiveCapabilities, drawReductionD10: () => 5,
    })
    expect(applied.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'egg-warmer-applied' })
    expect(applied.roll).toMatchObject({ purpose: 'provider-bounded', total: 5, generatedAtCampaignMinute: 100 })
    expect(applied.egg).toMatchObject({ revision: 1, incubation: { targetCampaignMinutes: 600, accumulatedCampaignMinutes: 300 } })
    const retry = applyPokemonEggWarmerCapability({ command, readSet, authorizationReceipt: receipt, actorAuthority: actor, trainerControl: null, gmOverrides: overrides }, {
      ...options(seeded.database), resolveEffectiveCapabilities, drawReductionD10: () => { throw new Error('must not redraw') },
    })
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.execution.committedRealtimeEvents).toEqual([])
    expect((seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM breeding_rolls').get() as any).count).toBe(1)
  })

  it('fails closed on enriched readiness input and retains exact correction evidence across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'breeding-readiness-'))
    tempRoots.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const first = seed(path)
    setClock(first.database, 2, 250)
    const command = readinessCommand({ operation: 49, revision: 0 })
    const readSet = readinessReadSetFor(command, first.egg, 2, 250)
    const auth = readinessAuthorityFor(command, readSet, first.egg)
    expect(() => markPokemonEggReady({
      ...readinessRequest(command, readSet, auth),
      elapsedCampaignMinutes: 600,
    } as any, options(first.database))).toThrowError(expect.objectContaining({
      code: 'breeding.readiness-correction-use-case.invalid-request',
    }))
    const accessor = readinessRequest(command, readSet, auth) as any
    Object.defineProperty(accessor, 'command', { enumerable: true, get: () => command })
    expect(() => markPokemonEggReady(accessor, options(first.database))).toThrowError(expect.objectContaining({
      code: 'breeding.readiness-correction-use-case.invalid-request',
    }))

    const accepted = markPokemonEggReady(
      readinessRequest(command, readSet, auth),
      options(first.database),
    )
    close(first.database)
    const reopened = open(path)
    const replay = markPokemonEggReady(
      readinessRequest(command, readSet, auth),
      options(reopened),
    )
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.projection).toEqual(accepted.projection)
    expect(replay.execution.committedRealtimeEvents).toEqual([])
    expect(createSqliteBreedingOperationEvidenceRepository(reopened).get(command.operationId)).toMatchObject({
      readSet: { definitionSha256: readSet.definitionSha256 },
      authorizationReceipt: { definitionSha256: auth.receipt.definitionSha256 },
    })
  })
})
