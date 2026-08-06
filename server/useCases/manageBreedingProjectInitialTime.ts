import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import type { BreedingParentControlEvidenceV1 } from '#shared/breeding/authorization'
import type { BreedingInitialProgressProjectionV1 } from '#shared/breeding/projectInitialProgress'
import type { BreedingOperationResultV1 } from '#shared/breeding/operations'
import {
  parseBreedingOperationCommandV1,
  type BreedingOperationCommandV1,
} from '#shared/breeding/operations'
import type { BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingParentControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION_SHA256,
  BREEDING_INITIAL_PROGRESS_SEGMENT_PROVIDER_ID,
  breedingProjectDocumentDefinitionSha256,
  createBreedingProjectFromSetupValidationV1,
  parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1,
  planBreedingInitialProgressSegmentV1,
  projectBreedingInitialProgressV1,
} from '../domain/breeding/projectInitialProgress'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import { parseAuthoritativeBreedingProjectSetupValidationV1 } from '../domain/breeding/projectSetupValidation'
import {
  parseAuthoritativeBreedingOperationReadSetV1,
  validateBreedingOperationReadSetCompleteness,
} from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface BreedingProjectInitialTimeExecutionResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly project: BreedingProjectDocumentV1 | null
  readonly projection: BreedingInitialProgressProjectionV1 | null
}
export interface BreedingProjectInitialTimeOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type BreedingProjectInitialTimeErrorCode =
  | 'breeding.initial-progress.invalid-authority'
  | 'breeding.initial-progress.repository-mismatch'
  | 'breeding.initial-progress.stale-reference'
  | 'breeding.initial-progress.wrong-command'
export class BreedingProjectInitialTimeError extends Error {
  readonly code: BreedingProjectInitialTimeErrorCode
  constructor(code: BreedingProjectInitialTimeErrorCode, message: string) {
    super(message)
    this.name = 'BreedingProjectInitialTimeError'
    this.code = code
  }
}
const fail = (code: BreedingProjectInitialTimeErrorCode, message: string): never => {
  throw new BreedingProjectInitialTimeError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const readResource = (
  readSet: BreedingOperationReadSetV1,
  kind: BreedingReadResourceV1['resourceKind'],
  id: string,
): BreedingReadResourceV1 | null => readSet.resources.find(resource => (
  resource.resourceKind === kind && resource.resourceId === id
)) ?? null
const resourceMatches = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly kind: BreedingReadResourceV1['resourceKind']
  readonly id: string
  readonly revision: number
  readonly definitionSha256: string
  readonly purpose: BreedingReadResourceV1['purposes'][number]
  readonly observedCampaignMinute?: number
}): boolean => {
  const resource = readResource(input.readSet, input.kind, input.id)
  return resource?.existence === 'present' && resource.revision === input.revision
    && resource.definitionSha256 === input.definitionSha256
    && resource.purposes.includes(input.purpose)
    && (input.observedCampaignMinute === undefined
      || resource.observedCampaignMinute === input.observedCampaignMinute)
}
const operationAuthority = (input: {
  readonly command: BreedingOperationCommandV1
  readonly readSetValue: unknown
  readonly receiptValue: unknown
}): { readonly readSet: BreedingOperationReadSetV1, readonly receipt: BreedingAuthorizationReceiptV1 } => {
  const readSet = validateBreedingOperationReadSetCompleteness(input.command, input.readSetValue)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.receiptValue)
  const commandSha256 = createBreedingOperationCommandHash(input.command)
  if (!receipt.authorized || receipt.reasonId !== 'breeding.authorization.authorized'
    || receipt.operationId !== input.command.operationId || receipt.commandSha256 !== commandSha256
    || receipt.commandKind !== input.command.commandKind
    || receipt.readSetDefinitionSha256 !== readSet.definitionSha256
    || receipt.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
    || receipt.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256) {
    return fail('breeding.initial-progress.invalid-authority', 'Operation requires one current authorized receipt bound to the exact complete read set and security policy.')
  }
  return Object.freeze({ readSet, receipt })
}
const clockMatches = (
  readSet: BreedingOperationReadSetV1,
  clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null },
): boolean => resourceMatches({
  readSet,
  kind: 'campaign-clock',
  id: 'campaign-clock',
  revision: clock.revision,
  definitionSha256: sha256({
    schemaVersion: 1,
    revision: clock.revision,
    campaignMinute: clock.campaignMinute,
    lastOperationId: clock.lastOperationId,
  }),
  purpose: 'campaign-time',
  observedCampaignMinute: clock.campaignMinute,
})
const audienceTargets = (project: BreedingProjectDocumentV1) => {
  const participatingOwners = [...new Set(project.parentRefs
    .map(parent => parent.ownerTrainerSlug)
    .filter(owner => owner !== project.ownerTrainerSlug))].sort()
  return Object.freeze([
    { audience: 'diagnostic' as const, trainerSheetSlug: null },
    { audience: 'gm' as const, trainerSheetSlug: null },
    { audience: 'owner' as const, trainerSheetSlug: project.ownerTrainerSlug },
    ...participatingOwners.map(trainerSheetSlug => ({
      audience: 'participating-owner' as const,
      trainerSheetSlug,
    })),
    { audience: 'public' as const, trainerSheetSlug: null },
  ])
}
const appendProjectRefresh = (input: {
  readonly project: BreedingProjectDocumentV1
  readonly commandKind: BreedingOperationCommandV1['commandKind']
  readonly context: Parameters<Parameters<BreedingTransactionCoordinator['execute']>[0]['execute']>[2]
  readonly options: BreedingProjectInitialTimeOptions
}): void => {
  input.context.appendRealtime(breedingRealtimeRefreshAppendInputs({
    aggregateKind: 'breeding-project',
    aggregateId: input.project.projectId,
    revision: input.project.revision,
    operationKind: input.commandKind,
    audienceTargets: audienceTargets(input.project),
    campaignProjectionKey: input.options.campaignProjectionKey,
    timestamp: input.options.realtimeTimestamp,
  }))
}
const coordinatorFor = (
  options: BreedingProjectInitialTimeOptions,
): { readonly database: RotomDatabase, readonly coordinator: BreedingTransactionCoordinator } => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.initial-progress.repository-mismatch', 'Coordinator and use case must share one database connection.')
  }
  return Object.freeze({
    database,
    coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }),
  })
}
const requireExactPersistedOperationEvidence = (input: {
  readonly database: RotomDatabase
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
}): void => {
  const operation = createSqliteBreedingOperationRepository(input.database).get(input.command.operationId)
  const evidence = createSqliteBreedingOperationEvidenceRepository(input.database).get(input.command.operationId)
  if (evidence && (stableJsonStringify(evidence.readSet) !== stableJsonStringify(input.readSet)
    || stableJsonStringify(evidence.authorizationReceipt) !== stableJsonStringify(input.receipt))) {
    fail('breeding.initial-progress.invalid-authority', 'An existing operation identity is bound to different immutable authority evidence.')
  }
  if (operation && operation.status !== 'pending' && !evidence) {
    fail('breeding.initial-progress.invalid-authority', 'A terminal initial-progress operation is missing its immutable authority evidence.')
  }
}
const resultAfterExecution = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly projectId: string
  readonly audience: 'gm' | 'owner'
}): BreedingProjectInitialTimeExecutionResultV1 => {
  const project = createSqliteBreedingProjectRepository(input.database).get(input.projectId)
  return Object.freeze({
    execution: input.execution,
    project,
    projection: project && (project.status === 'awaiting-parent-consent'
      || project.status === 'initial-time-in-progress' || project.status === 'check-ready')
      ? projectBreedingInitialProgressV1({ project, audience: input.audience })
      : null,
  })
}

export const createBreedingProjectFromValidatedSetup = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly setupValidation: unknown
  readonly parentControls: readonly [unknown, unknown]
  readonly audience: 'gm' | 'owner'
}, options: BreedingProjectInitialTimeOptions): BreedingProjectInitialTimeExecutionResultV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'create-breeding-project') {
    return fail('breeding.initial-progress.wrong-command', 'Creation use case accepts only create-breeding-project.')
  }
  const authority = operationAuthority({
    command,
    readSetValue: input.readSet,
    receiptValue: input.authorizationReceipt,
  })
  const setup = parseAuthoritativeBreedingProjectSetupValidationV1(input.setupValidation)
  const parentControls = input.parentControls.map((value, index) => (
    parseAuthoritativeBreedingParentControlEvidenceV1(value, `parentControls[${index}]`)
  )) as unknown as readonly [BreedingParentControlEvidenceV1, BreedingParentControlEvidenceV1]
  if (setup.authorizationReceiptDefinitionSha256 !== authority.receipt.definitionSha256
    || parentControls.some(control => !authority.receipt.evidenceDefinitionHashes.includes(control.definitionSha256))) {
    return fail('breeding.initial-progress.invalid-authority', 'Creation setup and both parent controls must belong to the exact authorization receipt.')
  }
  const clockResource = readResource(authority.readSet, 'campaign-clock', 'campaign-clock')
  if (clockResource?.revision === null || clockResource?.revision === undefined) {
    return fail('breeding.initial-progress.stale-reference', 'Creation requires the exact current campaign clock revision.')
  }
  const proposed = createBreedingProjectFromSetupValidationV1({
    command,
    setupValidation: setup,
    parentControls,
    campaignClockRevision: clockResource.revision,
  })
  const { database, coordinator } = coordinatorFor(options)
  requireExactPersistedOperationEvidence({
    database,
    command,
    readSet: authority.readSet,
    receipt: authority.receipt,
  })
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
    ...(options.resumePending === true ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      context.repositories.operationEvidence.insert({
        command: canonical,
        readSet: authority.readSet,
        authorizationReceipt: authority.receipt,
      })
      const clock = context.repositories.campaignClock.get()
      const commandSha256 = createBreedingOperationCommandHash(canonical)
      if (!clockMatches(authority.readSet, clock)
        || clock.revision !== clockResource.revision
        || clock.campaignMinute !== authority.readSet.capturedAtCampaignMinute) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [],
          conflictingScopes: canonical.scopes,
        })
      }
      const existing = context.repositories.projects.get(proposed.projectId)
      if (existing) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.conflict',
          currentAggregateRefs: [{ kind: 'breeding-project', id: existing.projectId, revision: existing.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const project = context.repositories.projects.insert(proposed)
      appendProjectRefresh({ project, commandKind: canonical.commandKind, context, options })
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: commandSha256,
        commandKind: canonical.commandKind,
        outcomeKind: 'project-created',
        aggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  requireExactPersistedOperationEvidence({
    database,
    command,
    readSet: authority.readSet,
    receipt: authority.receipt,
  })
  return resultAfterExecution({ database, execution, projectId: proposed.projectId, audience: input.audience })
}

export const advanceBreedingProjectInitialTime = (input: {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly segmentAuthority: unknown
  readonly audience: 'gm' | 'owner'
}, options: BreedingProjectInitialTimeOptions): BreedingProjectInitialTimeExecutionResultV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'advance-breeding-project-time') {
    return fail('breeding.initial-progress.wrong-command', 'Progress use case accepts only advance-breeding-project-time.')
  }
  const authority = operationAuthority({
    command,
    readSetValue: input.readSet,
    receiptValue: input.authorizationReceipt,
  })
  const segment = parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1(input.segmentAuthority)
  const segmentDependency = authority.readSet.dependencyEvidence.find(value => (
    value.providerKind === 'system'
    && value.providerId === BREEDING_INITIAL_PROGRESS_SEGMENT_PROVIDER_ID
    && value.subjectKind === 'project'
    && value.subjectId === segment.projectId
    && value.subjectRevision === segment.projectRevision
    && value.checkpoint === 'campaign-clock-segment'
  ))
  if (!segmentDependency
    || segmentDependency.providerDefinitionSha256 !== BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION_SHA256
    || segmentDependency.effectiveEvidenceSha256 !== segment.definitionSha256
    || !authority.receipt.evidenceDefinitionHashes.includes(segment.definitionSha256)) {
    return fail('breeding.initial-progress.invalid-authority', 'Progress segment must be bound into both the complete read set and authorization receipt.')
  }
  const { database, coordinator } = coordinatorFor(options)
  requireExactPersistedOperationEvidence({
    database,
    command,
    readSet: authority.readSet,
    receipt: authority.receipt,
  })
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
    ...(options.resumePending === true ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      context.repositories.operationEvidence.insert({
        command: canonical,
        readSet: authority.readSet,
        authorizationReceipt: authority.receipt,
      })
      const commandSha256 = createBreedingOperationCommandHash(canonical)
      const project = context.repositories.projects.get(segment.projectId)
      if (!project) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.not-found',
          currentAggregateRefs: [],
          conflictingScopes: canonical.scopes,
        })
      }
      const projectResourceValid = resourceMatches({
        readSet: authority.readSet,
        kind: 'breeding-project',
        id: project.projectId,
        revision: segment.projectRevision,
        definitionSha256: segment.projectDefinitionSha256,
        purpose: 'mechanics',
      }) && segment.projectDefinitionSha256 === breedingProjectDocumentDefinitionSha256(project)
      const clock = context.repositories.campaignClock.get()
      if (!projectResourceValid || project.revision !== segment.projectRevision
        || !clockMatches(authority.readSet, clock)
        || clock.revision !== segment.throughClockRevision
        || clock.campaignMinute !== segment.throughCampaignMinute) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      if (segment.parentRefs.some(parent => !resourceMatches({
        readSet: authority.readSet,
        kind: 'pokemon-sheet',
        id: parent.pokemonSheetSlug,
        revision: parent.expectedSheetRevision,
        definitionSha256: readResource(authority.readSet, 'pokemon-sheet', parent.pokemonSheetSlug)?.definitionSha256 ?? '',
        purpose: 'snapshot',
      }))) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.unavailable',
          currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let planned
      try { planned = planBreedingInitialProgressSegmentV1({ project, command: canonical, segmentAuthority: segment }) }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error
          && (error as { readonly code: unknown }).code === 'breeding.initial-progress.unavailable') {
          return createBreedingOperationRejectedV1({
            operationId: canonical.operationId,
            commandHash: commandSha256,
            commandKind: canonical.commandKind,
            reasonId: 'breeding.operation.unavailable',
            currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
            conflictingScopes: canonical.scopes,
          })
        }
        throw error
      }
      let committed = planned.project
      let changedScopes: BreedingOperationCommandV1['scopes'] = Object.freeze([])
      if (planned.kind === 'updated') {
        const replacement = context.repositories.projects.replace({
          expectedRevision: project.revision,
          document: planned.project,
        })
        if (replacement.kind !== 'applied') {
          const current = context.repositories.projects.get(project.projectId)
          return createBreedingOperationRejectedV1({
            operationId: canonical.operationId,
            commandHash: commandSha256,
            commandKind: canonical.commandKind,
            reasonId: 'breeding.operation.conflict',
            currentAggregateRefs: current
              ? [{ kind: 'breeding-project', id: current.projectId, revision: current.revision }]
              : [],
            conflictingScopes: canonical.scopes,
          })
        }
        committed = replacement.document
        changedScopes = canonical.scopes
        appendProjectRefresh({ project: committed, commandKind: canonical.commandKind, context, options })
      }
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: commandSha256,
        commandKind: canonical.commandKind,
        outcomeKind: 'project-progressed',
        aggregateRefs: [{ kind: 'breeding-project', id: committed.projectId, revision: committed.revision }],
        changedScopes,
        committedAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  requireExactPersistedOperationEvidence({
    database,
    command,
    readSet: authority.readSet,
    receipt: authority.receipt,
  })
  return resultAfterExecution({ database, execution, projectId: segment.projectId, audience: input.audience })
}

export const parseBreedingProjectInitialTimeReadSet = (
  value: unknown,
): BreedingOperationReadSetV1 => parseAuthoritativeBreedingOperationReadSetV1(value)
