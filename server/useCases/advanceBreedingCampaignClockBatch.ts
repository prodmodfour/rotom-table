import { createHash } from 'node:crypto'
import canonicalIdsJson from '../../data/breeding-automation/canonical-ids.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import semanticRegistryJson from '../../data/breeding-automation/semantic-registry.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import { BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM, type BreedingCampaignClockEggBatchEntryV1, type BreedingCampaignClockEggBatchProjectionV1 } from '#shared/breeding/campaignClockBatch'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  parseBreedingOperationCommandV1,
  type BreedingConflictScopeV1,
  type BreedingOperationResultV1,
  type PokemonEggScopeV1,
} from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1, BreedingReferenceVersionSnapshotV1 } from '#shared/breeding/readSets'
import {
  authorizeBreedingCampaignClockBatchV1,
  authorizeBreedingEggIncubationV1,
  createBreedingActorAuthorityV1,
  createBreedingGmOverrideEvidenceV1,
  parseAuthoritativeBreedingActorAuthorityV1,
} from '../domain/breeding/authorization'
import {
  BREEDING_CAMPAIGN_CLOCK_BATCH_EVIDENCE_DEFINITION_SHA256,
  BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION_SHA256,
  BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID,
  deriveBreedingCampaignClockBatchChildOperationIdV1,
  deriveBreedingCampaignClockBatchOverrideIdV1,
  deriveBreedingCampaignClockBatchParentOverrideIdV1,
  deriveBreedingCampaignClockBatchParentReadSetIdV1,
  deriveBreedingCampaignClockBatchReadSetIdV1,
  projectBreedingCampaignClockEggBatchV1,
  validateBreedingCampaignClockBatchPlanV1,
} from '../domain/breeding/campaignClockBatch'
import {
  BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
  BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
} from '../domain/breeding/incubation'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import {
  createBreedingOperationReadSetV1,
  parseAuthoritativeBreedingReferenceVersionSnapshotV1,
} from '../domain/breeding/readSets'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../domain/breeding/registry'
import { createSqliteBreedingIncubationSegmentRepository } from '../storage/breedingIncubationSegmentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import {
  advanceBreedingCampaignClock,
  type AdvanceBreedingCampaignClockOptions,
} from './advanceBreedingCampaignClock'
import { managePokemonEggIncubation } from './managePokemonEggIncubation'

export interface AdvanceBreedingCampaignClockBatchInputV1 {
  readonly command: unknown
  readonly actorAuthority: unknown
  readonly referenceVersions: unknown
}
export interface AdvanceBreedingCampaignClockBatchOptions {
  readonly database?: RotomDatabase
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly validateCurrentGmAuthority: (actor: BreedingActorAuthorityV1) => boolean
  readonly resumePending?: boolean
  readonly beforeParentSettle?: () => void
  readonly beforeChildSettle?: (input: {
    readonly index: number
    readonly eggId: string
    readonly result: BreedingOperationResultV1
  }) => void
}
export interface AdvanceBreedingCampaignClockBatchResultV1 {
  readonly execution: ReturnType<typeof advanceBreedingCampaignClock>
  readonly projection: BreedingCampaignClockEggBatchProjectionV1
}
export interface DiscoverBreedingCampaignClockBatchInputV1 {
  readonly expectedClockRevision: number
  readonly targetCampaignMinute: number
}

export type AdvanceBreedingCampaignClockBatchErrorCode =
  | 'breeding.clock-batch-use-case.invalid-authority'
  | 'breeding.clock-batch-use-case.invalid-request'
  | 'breeding.clock-batch-use-case.repository-mismatch'
  | 'breeding.clock-batch-use-case.stale-authority'

export class AdvanceBreedingCampaignClockBatchError extends Error {
  readonly code: AdvanceBreedingCampaignClockBatchErrorCode

  constructor(code: AdvanceBreedingCampaignClockBatchErrorCode, message: string) {
    super(message)
    this.name = 'AdvanceBreedingCampaignClockBatchError'
    this.code = code
  }
}
const fail = (code: AdvanceBreedingCampaignClockBatchErrorCode, message: string): never => {
  throw new AdvanceBreedingCampaignClockBatchError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const strictObject = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.clock-batch-use-case.invalid-request', `${label} must be a plain data object without symbols.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.clock-batch-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.clock-batch-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const nonnegativeInteger = (value: unknown, label: string): number => (
  Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : fail('breeding.clock-batch-use-case.invalid-request', `${label} must be a nonnegative safe integer.`)
)
const clockDefinitionSha256 = (clock: {
  readonly revision: number
  readonly campaignMinute: number
  readonly lastOperationId: string | null
}): string => sha256({
  schemaVersion: 1,
  revision: clock.revision,
  campaignMinute: clock.campaignMinute,
  lastOperationId: clock.lastOperationId,
})
const resource = (input: {
  readonly resourceKind: BreedingReadResourceV1['resourceKind']
  readonly resourceId: string
  readonly revision: number
  readonly definitionSha256: string
  readonly observedCampaignMinute?: number | null
  readonly purposes: readonly BreedingReadResourceV1['purposes'][number][]
}): BreedingReadResourceV1 => Object.freeze({
  resourceKind: input.resourceKind,
  resourceId: input.resourceId,
  existence: 'present',
  revision: input.revision,
  definitionSha256: input.definitionSha256,
  observedCampaignMinute: input.observedCampaignMinute ?? null,
  purposes: Object.freeze([...input.purposes].sort()),
})
const resolverAttestation = (dependencies: readonly unknown[]) => Object.freeze({
  providerKind: 'system' as const,
  providerId: 'breeding-effective-dependency-set-v1',
  subjectKind: 'campaign' as const,
  subjectId: 'campaign',
  subjectRevision: null,
  checkpoint: 'authorization' as const,
  providerDefinitionSha256: securityPolicyJson.definitionSha256,
  effectiveEvidenceSha256: sha256(dependencies),
})
const batchDependency = () => Object.freeze({
  providerKind: 'system' as const,
  providerId: BREEDING_CAMPAIGN_CLOCK_BATCH_PROVIDER_ID,
  subjectKind: 'campaign' as const,
  subjectId: 'campaign',
  subjectRevision: null,
  checkpoint: 'campaign-clock-segment' as const,
  providerDefinitionSha256: BREEDING_CAMPAIGN_CLOCK_BATCH_POLICY_DEFINITION_SHA256,
  effectiveEvidenceSha256: BREEDING_CAMPAIGN_CLOCK_BATCH_EVIDENCE_DEFINITION_SHA256,
})
const incubationDependency = (egg: PokemonEggDocumentV1) => Object.freeze({
  providerKind: 'system' as const,
  providerId: BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
  subjectKind: 'pokemon-egg' as const,
  subjectId: egg.eggId,
  subjectRevision: egg.revision,
  checkpoint: 'incubation-operation' as const,
  providerDefinitionSha256: BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
  effectiveEvidenceSha256: BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
})
const currentReferenceMatches = (
  reference: BreedingReferenceVersionSnapshotV1,
  command: ReturnType<typeof parseBreedingOperationCommandV1>,
): boolean => reference.rulesetId === command.ruleset.rulesetId
  && reference.rulesetDefinitionSha256 === command.ruleset.definitionSha256
  && reference.sourceManifestSha256 === (rulesetJson as any).definition.sourceManifestSha256
  && reference.semanticRegistryDefinitionSha256 === semanticRegistryJson.definitionSha256
  && reference.compiledRegistryDefinitionSha256 === COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256
  && reference.canonicalIdsDefinitionSha256 === canonicalIdsJson.definitionSha256
const validateCurrentGm = (
  actor: BreedingActorAuthorityV1,
  options: AdvanceBreedingCampaignClockBatchOptions,
): void => {
  let authorized: unknown
  try { authorized = options.validateCurrentGmAuthority(actor) }
  catch { return fail('breeding.clock-batch-use-case.invalid-authority', 'Current GM authority verifier failed closed.') }
  if (promiseLike(authorized) || authorized !== true) {
    return fail('breeding.clock-batch-use-case.invalid-authority', 'Current authenticated GM authority is required.')
  }
}
const dueEggs = (database: RotomDatabase, revision: number, campaignMinute: number): readonly PokemonEggDocumentV1[] => (
  createSqlitePokemonEggRepository(database).listIncubatingBehindClock({
    revision,
    campaignMinute,
    limit: BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM,
  })
)

export const discoverBreedingCampaignClockIncubationBatchScopes = (
  input: DiscoverBreedingCampaignClockBatchInputV1,
  options: { readonly database?: RotomDatabase } = {},
): readonly BreedingConflictScopeV1[] => {
  strictObject(input, ['expectedClockRevision', 'targetCampaignMinute'], 'clockBatchDiscovery')
  const expectedClockRevision = nonnegativeInteger(input.expectedClockRevision, 'expectedClockRevision')
  const targetCampaignMinute = nonnegativeInteger(input.targetCampaignMinute, 'targetCampaignMinute')
  const database = options.database ?? getRotomDatabase()
  const clock = createSqliteCampaignClockRepository(database).get()
  if (clock.revision !== expectedClockRevision || targetCampaignMinute < clock.campaignMinute) {
    return fail('breeding.clock-batch-use-case.stale-authority', 'Batch discovery must bind the current clock and a nondecreasing target.')
  }
  const targetRevision = targetCampaignMinute === clock.campaignMinute ? clock.revision : clock.revision + 1
  return Object.freeze([
    { kind: 'campaign-clock' as const, expectedRevision: clock.revision },
    ...dueEggs(database, targetRevision, targetCampaignMinute).map(egg => Object.freeze({
      kind: 'pokemon-egg' as const,
      eggId: egg.eggId,
      expectedRevision: egg.revision,
    })),
  ])
}

const createParentAuthority = (input: {
  readonly command: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly actor: BreedingActorAuthorityV1
  readonly referenceVersions: BreedingReferenceVersionSnapshotV1
  readonly clock: ReturnType<ReturnType<typeof createSqliteCampaignClockRepository>['get']>
  readonly eggs: readonly PokemonEggDocumentV1[]
}): { readonly readSet: BreedingOperationReadSetV1, readonly receipt: BreedingAuthorizationReceiptV1 } => {
  const dependency = batchDependency()
  const readSet = createBreedingOperationReadSetV1({
    readSetId: deriveBreedingCampaignClockBatchParentReadSetIdV1(input.command.operationId),
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    capturedAtCampaignMinute: input.clock.campaignMinute,
    resources: [
      resource({
        resourceKind: 'campaign-clock', resourceId: 'campaign-clock', revision: input.clock.revision,
        definitionSha256: clockDefinitionSha256(input.clock), observedCampaignMinute: input.clock.campaignMinute,
        purposes: ['campaign-time', 'conflict'],
      }),
      ...input.eggs.map(egg => resource({
        resourceKind: 'pokemon-egg', resourceId: egg.eggId, revision: egg.revision,
        definitionSha256: sha256(egg), purposes: ['conflict', 'mechanics'],
      })),
    ],
    referenceVersions: input.referenceVersions,
    dependencyEvidence: [resolverAttestation([dependency]), dependency],
    writeExpectations: input.command.scopes,
  })
  const override = createBreedingGmOverrideEvidenceV1({
    overrideId: deriveBreedingCampaignClockBatchParentOverrideIdV1(input.command.operationId),
    command: input.command,
    actorAuthority: input.actor,
    overrideKind: 'operation-recovery',
    target: { kind: 'breeding-operation', operationId: input.command.operationId },
    reasonId: 'breeding.override.campaign-clock-incubation-batch',
    createdAtCampaignMinute: input.clock.campaignMinute,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const receipt = authorizeBreedingCampaignClockBatchV1({
    command: input.command,
    readSet,
    actorAuthority: input.actor,
    currentClock: input.clock,
    eggs: input.eggs,
    gmOverrides: [override],
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) {
    return fail('breeding.clock-batch-use-case.invalid-authority', 'Parent batch authorization failed closed.')
  }
  return Object.freeze({ readSet, receipt })
}

const childCommand = (input: {
  readonly parentCommand: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly scope: PokemonEggScopeV1
  readonly clockRevision: number
  readonly campaignMinute: number
}) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: deriveBreedingCampaignClockBatchChildOperationIdV1(
    input.parentCommand.operationId,
    input.scope.eggId,
  ),
  commandKind: 'advance-egg-incubation',
  actor: input.parentCommand.actor,
  ruleset: input.parentCommand.ruleset,
  scopes: [input.scope],
  payload: {
    eggId: input.scope.eggId,
    throughClockRevision: input.clockRevision,
    throughCampaignMinute: input.campaignMinute,
  },
})
const childActor = (input: {
  readonly command: ReturnType<typeof childCommand>
  readonly parentActor: BreedingActorAuthorityV1
  readonly campaignMinute: number
}): BreedingActorAuthorityV1 => createBreedingActorAuthorityV1({
  role: 'gm',
  command: input.command,
  authenticatedPrincipalSha256: input.parentActor.authenticatedPrincipalSha256,
  authenticationPolicyDefinitionSha256: input.parentActor.authenticationPolicyDefinitionSha256,
  profile: null,
  evaluatedAtCampaignMinute: input.campaignMinute,
})
const createChildAuthority = (input: {
  readonly parentCommand: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly command: ReturnType<typeof childCommand>
  readonly actor: BreedingActorAuthorityV1
  readonly referenceVersions: BreedingReferenceVersionSnapshotV1
  readonly clock: ReturnType<ReturnType<typeof createSqliteCampaignClockRepository>['get']>
  readonly egg: PokemonEggDocumentV1
}): { readonly readSet: BreedingOperationReadSetV1, readonly receipt: BreedingAuthorizationReceiptV1, readonly overrides: readonly unknown[] } => {
  const dependency = incubationDependency(input.egg)
  const readSet = createBreedingOperationReadSetV1({
    readSetId: deriveBreedingCampaignClockBatchReadSetIdV1(input.parentCommand.operationId, input.egg.eggId),
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    capturedAtCampaignMinute: input.clock.campaignMinute,
    resources: [
      resource({
        resourceKind: 'campaign-clock', resourceId: 'campaign-clock', revision: input.clock.revision,
        definitionSha256: clockDefinitionSha256(input.clock), observedCampaignMinute: input.clock.campaignMinute,
        purposes: ['campaign-time'],
      }),
      resource({
        resourceKind: 'pokemon-egg', resourceId: input.egg.eggId, revision: input.egg.revision,
        definitionSha256: sha256(input.egg), purposes: ['conflict', 'mechanics'],
      }),
    ],
    referenceVersions: input.referenceVersions,
    dependencyEvidence: [resolverAttestation([dependency]), dependency],
    writeExpectations: input.command.scopes,
  })
  const override = createBreedingGmOverrideEvidenceV1({
    overrideId: deriveBreedingCampaignClockBatchOverrideIdV1(input.parentCommand.operationId, input.egg.eggId),
    command: input.command,
    actorAuthority: input.actor,
    overrideKind: 'owner-control',
    target: { kind: 'trainer-sheet', trainerSheetSlug: input.egg.ownerTrainerSlug },
    reasonId: 'breeding.override.owner-control',
    createdAtCampaignMinute: input.clock.campaignMinute,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const overrides = Object.freeze([override])
  const receipt = authorizeBreedingEggIncubationV1({
    command: input.command,
    readSet,
    actorAuthority: input.actor,
    trainerControl: null,
    egg: input.egg,
    gmOverrides: overrides,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) {
    return fail('breeding.clock-batch-use-case.invalid-authority', 'Child incubation authorization failed closed.')
  }
  return Object.freeze({ readSet, receipt, overrides })
}
const terminalEntry = (input: {
  readonly record: BreedingOperationLedgerRecord
  readonly scope: PokemonEggScopeV1
  readonly executionKind: 'exact-retry' | 'executed'
  readonly database: RotomDatabase
}): BreedingCampaignClockEggBatchEntryV1 => {
  const result = input.record.result
  if (!result) return fail('breeding.clock-batch-use-case.repository-mismatch', 'Terminal child operation has no result.')
  const segment = createSqliteBreedingIncubationSegmentRepository(input.database).get(input.record.operationId)
  if (result.ok) {
    if (!segment || result.outcomeKind !== 'egg-progressed') {
      return fail('breeding.clock-batch-use-case.repository-mismatch', 'Accepted batch child must retain its incubation segment.')
    }
    return Object.freeze({
      eggId: input.scope.eggId,
      operationId: input.record.operationId,
      executionKind: input.executionKind,
      status: 'accepted',
      reasonId: null,
      eggRevisionBefore: input.scope.expectedRevision!,
      eggRevisionAfter: segment.eggRevisionAfter,
      creditedCampaignMinutes: segment.creditedCampaignMinutes,
      skippedCampaignMinutes: segment.skippedCampaignMinutes,
      overflowCampaignMinutes: segment.overflowCampaignMinutes,
      reachedReady: segment.reachedReady,
    })
  }
  return Object.freeze({
    eggId: input.scope.eggId,
    operationId: input.record.operationId,
    executionKind: input.executionKind,
    status: 'rejected',
    reasonId: result.reasonId,
    eggRevisionBefore: input.scope.expectedRevision!,
    eggRevisionAfter: null,
    creditedCampaignMinutes: null,
    skippedCampaignMinutes: null,
    overflowCampaignMinutes: null,
    reachedReady: null,
  })
}

export const advanceBreedingCampaignClockIncubationBatch = (
  input: AdvanceBreedingCampaignClockBatchInputV1,
  options: AdvanceBreedingCampaignClockBatchOptions,
): AdvanceBreedingCampaignClockBatchResultV1 => {
  strictObject(input, ['command', 'actorAuthority', 'referenceVersions'], 'clockBatchInput')
  const database = options.database ?? getRotomDatabase()
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'advance-campaign-clock') {
    return fail('breeding.clock-batch-use-case.invalid-request', 'Clock batch accepts advance-campaign-clock only.')
  }
  const currentClock = createSqliteCampaignClockRepository(database).get()
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  if (actor.role !== 'gm' || actor.commandActorProfileId !== command.actor.profileId
    || actor.selectedTrainerSlug !== null || actor.evaluatedAtCampaignMinute !== currentClock.campaignMinute) {
    return fail('breeding.clock-batch-use-case.invalid-authority', 'Batch command requires current command-matched GM authority.')
  }
  validateCurrentGm(actor, options)
  const referenceVersions = parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions)
  if (!currentReferenceMatches(referenceVersions, command)) {
    return fail('breeding.clock-batch-use-case.invalid-authority', 'Batch reference authority is not current app-owned authority.')
  }
  const operationRepository = createSqliteBreedingOperationRepository(database)
  const evidenceRepository = createSqliteBreedingOperationEvidenceRepository(database)
  const existing = operationRepository.get(command.operationId)
  if (existing && (existing.commandHash !== createBreedingOperationCommandHash(command)
    || !same(existing.command, command))) {
    return fail('breeding.clock-batch-use-case.invalid-request', 'Batch operation identity is already bound to another command.')
  }
  const parentEvidence = evidenceRepository.get(command.operationId)
  if (!existing || existing.status === 'pending') {
    const targetRevision = command.payload.targetCampaignMinute === currentClock.campaignMinute
      ? currentClock.revision
      : currentClock.revision + 1
    const discovered = dueEggs(database, targetRevision, command.payload.targetCampaignMinute)
    const plan = validateBreedingCampaignClockBatchPlanV1({ command, currentClock, dueEggs: discovered })
    const attempted = createParentAuthority({
      command,
      actor,
      referenceVersions,
      clock: currentClock,
      eggs: plan.dueEggs,
    })
    if (parentEvidence && (!same(parentEvidence.readSet, attempted.readSet)
      || !same(parentEvidence.authorizationReceipt, attempted.receipt))) {
      return fail('breeding.clock-batch-use-case.invalid-authority', 'Pending parent operation is bound to different authority evidence.')
    }
    database.withTransaction(() => {
      operationRepository.reserve(command, currentClock.campaignMinute)
      evidenceRepository.insert({ command, readSet: attempted.readSet, authorizationReceipt: attempted.receipt })
    })
  }
  else if (!parentEvidence) {
    return fail('breeding.clock-batch-use-case.repository-mismatch', 'Terminal batch parent is missing immutable operation evidence.')
  }
  const shouldResumeParent = existing === null || options.resumePending === true
  const parentOptions: AdvanceBreedingCampaignClockOptions = {
    database,
    dependentEggBatchAuthority: 'validated-by-campaign-clock-batch-v1',
    ...(shouldResumeParent ? { resumePending: true } : {}),
    ...(options.beforeParentSettle ? { beforeSettle: options.beforeParentSettle } : {}),
  }
  const execution = advanceBreedingCampaignClock(command, parentOptions)
  const settledClock = createSqliteCampaignClockRepository(database).get()
  if (execution.record.status !== 'accepted') {
    return Object.freeze({
      execution,
      projection: projectBreedingCampaignClockEggBatchV1({
        parentOperationId: command.operationId,
        parentExecutionKind: execution.kind,
        parentStatus: execution.record.status,
        clockRevision: settledClock.revision,
        campaignMinute: settledClock.campaignMinute,
        entries: [],
        hasMoreDueEggs: false,
      }),
    })
  }
  const parentResult = execution.record.result
  const clockRef = parentResult?.ok
    ? parentResult.aggregateRefs.find(reference => reference.kind === 'campaign-clock' && reference.id === 'campaign-clock')
    : null
  if (!parentResult?.ok || !clockRef || settledClock.revision !== clockRef.revision
    || settledClock.campaignMinute !== command.payload.targetCampaignMinute) {
    return fail('breeding.clock-batch-use-case.repository-mismatch', 'Accepted batch parent does not match the durable target clock.')
  }
  const eggScopes = command.scopes.slice(1) as readonly PokemonEggScopeV1[]
  const entries: BreedingCampaignClockEggBatchEntryV1[] = []
  for (let index = 0; index < eggScopes.length; index += 1) {
    const scope = eggScopes[index]!
    const child = childCommand({
      parentCommand: command,
      scope,
      clockRevision: settledClock.revision,
      campaignMinute: settledClock.campaignMinute,
    })
    const existingChild = operationRepository.get(child.operationId)
    if (existingChild?.status === 'accepted' || existingChild?.status === 'rejected') {
      if (!same(existingChild.command, child)) {
        return fail('breeding.clock-batch-use-case.repository-mismatch', 'Derived child identity collided with another command.')
      }
      entries.push(terminalEntry({ record: existingChild, scope, executionKind: 'exact-retry', database }))
      continue
    }
    const egg = createSqlitePokemonEggRepository(database).get(scope.eggId)
    if (!egg || egg.revision !== scope.expectedRevision || egg.status !== 'incubating') {
      return fail('breeding.clock-batch-use-case.stale-authority', 'A batch child changed before its operation could be durably settled.')
    }
    const actorForChild = childActor({ command: child, parentActor: actor, campaignMinute: settledClock.campaignMinute })
    const existingChildEvidence = evidenceRepository.get(child.operationId)
    const authority = existingChildEvidence
      ? {
          readSet: existingChildEvidence.readSet,
          receipt: existingChildEvidence.authorizationReceipt,
          overrides: [createBreedingGmOverrideEvidenceV1({
            overrideId: deriveBreedingCampaignClockBatchOverrideIdV1(command.operationId, egg.eggId),
            command: child,
            actorAuthority: actorForChild,
            overrideKind: 'owner-control',
            target: { kind: 'trainer-sheet', trainerSheetSlug: egg.ownerTrainerSlug },
            reasonId: 'breeding.override.owner-control',
            createdAtCampaignMinute: settledClock.campaignMinute,
            securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
          })],
        }
      : createChildAuthority({
          parentCommand: command,
          command: child,
          actor: actorForChild,
          referenceVersions,
          clock: settledClock,
          egg,
        })
    const childResult = managePokemonEggIncubation({
      command: child,
      readSet: authority.readSet,
      authorizationReceipt: authority.receipt,
      actorAuthority: actorForChild,
      trainerControl: null,
      gmOverrides: authority.overrides,
      audience: 'gm',
    }, {
      database,
      campaignProjectionKey: options.campaignProjectionKey,
      realtimeTimestamp: options.realtimeTimestamp,
      ...((existingChild === null || options.resumePending === true) ? { resumePending: true } : {}),
      ...(options.beforeChildSettle
        ? { beforeSettle: result => options.beforeChildSettle?.({ index, eggId: egg.eggId, result }) }
        : {}),
    })
    if (childResult.execution.record.status === 'pending') {
      entries.push(Object.freeze({
        eggId: scope.eggId,
        operationId: child.operationId,
        executionKind: 'pending',
        status: 'pending',
        reasonId: null,
        eggRevisionBefore: scope.expectedRevision!,
        eggRevisionAfter: null,
        creditedCampaignMinutes: null,
        skippedCampaignMinutes: null,
        overflowCampaignMinutes: null,
        reachedReady: null,
      }))
    }
    else {
      entries.push(terminalEntry({
        record: childResult.execution.record,
        scope,
        executionKind: childResult.execution.kind === 'exact-retry' ? 'exact-retry' : 'executed',
        database,
      }))
    }
  }
  const hasMoreDueEggs = dueEggs(database, settledClock.revision, settledClock.campaignMinute).length > 0
  return Object.freeze({
    execution,
    projection: projectBreedingCampaignClockEggBatchV1({
      parentOperationId: command.operationId,
      parentExecutionKind: execution.kind,
      parentStatus: execution.record.status,
      clockRevision: settledClock.revision,
      campaignMinute: settledClock.campaignMinute,
      entries,
      hasMoreDueEggs,
    }),
  })
}
