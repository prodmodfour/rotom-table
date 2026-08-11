import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1, BreedingCrossOwnerConsentEvidenceV1 } from '#shared/breeding/authorization'
import type { BreedingCheckRecordV1, BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import type { BreedingOperationCommandV1, BreedingOperationResultV1 } from '#shared/breeding/operations'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingAdditionalProgressProjectionV1, BreedingAdditionalProgressSegmentAuthorityV1 } from '#shared/breeding/projectAdditionalProgress'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1,
} from '../domain/breeding/authorization'
import {
  BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION_SHA256,
  BREEDING_ADDITIONAL_PROGRESS_SEGMENT_PROVIDER_ID,
  BreedingAdditionalProgressAuthorityError,
  parseAuthoritativeBreedingAdditionalProgressSegmentAuthorityV1,
  planBreedingAdditionalProgressSegmentV1,
  projectBreedingAdditionalProgressV1,
} from '../domain/breeding/projectAdditionalProgress'
import { breedingProjectDocumentDefinitionSha256 } from '../domain/breeding/projectInitialProgress'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingCheckLedgerRepository } from '../storage/breedingCheckLedgerRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface AdvanceBreedingProjectAdditionalTimeResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly project: BreedingProjectDocumentV1 | null
  readonly check: BreedingCheckRecordV1 | null
  readonly projection: BreedingAdditionalProgressProjectionV1 | null
}
export interface AdvanceBreedingProjectAdditionalTimeOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type AdvanceBreedingProjectAdditionalTimeErrorCode =
  | 'breeding.additional-progress.invalid-request'
  | 'breeding.additional-progress.invalid-authority'
  | 'breeding.additional-progress.repository-mismatch'
  | 'breeding.additional-progress.wrong-command'
export class AdvanceBreedingProjectAdditionalTimeError extends Error {
  readonly code: AdvanceBreedingProjectAdditionalTimeErrorCode
  constructor(code: AdvanceBreedingProjectAdditionalTimeErrorCode, message: string) {
    super(message)
    this.name = 'AdvanceBreedingProjectAdditionalTimeError'
    this.code = code
  }
}
const fail = (code: AdvanceBreedingProjectAdditionalTimeErrorCode, message: string): never => {
  throw new AdvanceBreedingProjectAdditionalTimeError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const strictArray = <Value>(value: unknown, parse: (entry: unknown, index: number) => Value): readonly Value[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 2
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.additional-progress.invalid-request', 'Consent evidence must be one plain bounded array.')
  }
  return Object.freeze(value.map(parse))
}
const strictInput = (value: unknown): {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly segmentAuthority: unknown
  readonly consentEvidence: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly audience: 'gm' | 'owner'
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.additional-progress.invalid-request', 'Additional-progress input must be a plain exact object.')
  }
  const row = value as Record<string, unknown>
  const fields = ['command', 'readSet', 'authorizationReceipt', 'segmentAuthority', 'consentEvidence', 'audience']
  for (const key of Object.getOwnPropertyNames(row)) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.additional-progress.invalid-request', 'Additional-progress input cannot contain accessors or hidden fields.')
    }
  }
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !fields.includes(field))
    || (row.audience !== 'gm' && row.audience !== 'owner')) {
    return fail('breeding.additional-progress.invalid-request', 'Additional-progress input must contain exactly command, read set, receipt, segment, consent evidence, and audience.')
  }
  return Object.freeze({
    command: row.command,
    readSet: row.readSet,
    authorizationReceipt: row.authorizationReceipt,
    segmentAuthority: row.segmentAuthority,
    consentEvidence: strictArray(row.consentEvidence, (entry, index) => (
      parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1(entry, `consentEvidence[${index}]`)
    )),
    audience: row.audience,
  })
}
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
  readonly revision: number | null
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
    return fail('breeding.additional-progress.invalid-authority', 'Additional progress requires one current authorized receipt bound to the exact complete read set and security policy.')
  }
  return Object.freeze({ readSet, receipt })
}
const currentContinuityStart = (input: {
  readonly project: BreedingProjectDocumentV1
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly segment: BreedingAdditionalProgressSegmentAuthorityV1
  readonly consents: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly getConsent: (consentId: string) => BreedingConsentRecordV1 | null
}): number | null => {
  const previous = input.project.timeline.lastAppliedClockMinute
  if (previous === null || input.project.parentRefs.some(parent => !resourceMatches({
    readSet: input.readSet,
    kind: 'pokemon-sheet',
    id: parent.pokemonSheetSlug,
    revision: parent.expectedSheetRevision,
    definitionSha256: readResource(input.readSet, 'pokemon-sheet', parent.pokemonSheetSlug)?.definitionSha256 ?? '',
    purpose: 'snapshot',
  }))) return null
  const crossOwnerParents = input.project.parentRefs.filter(parent => (
    parent.ownerTrainerSlug !== input.project.ownerTrainerSlug
  ))
  if ((crossOwnerParents.length > 0) !== (input.project.consentPolicy === 'cross-owner-current-revision-consent')
    || input.consents.length !== crossOwnerParents.length) return null
  let creditedFrom = previous
  const commandSha256 = createBreedingOperationCommandHash(input.command)
  for (let index = 0; index < crossOwnerParents.length; index += 1) {
    const parent = crossOwnerParents[index]!
    const evidence = input.consents[index]
    if (!evidence || evidence.projectId !== input.project.projectId
      || evidence.parentSheetSlug !== parent.pokemonSheetSlug
      || evidence.parentSheetRevision !== parent.expectedSheetRevision
      || evidence.ownerTrainerSlug !== parent.ownerTrainerSlug
      || evidence.validationOperationId !== input.command.operationId
      || evidence.validationCommandSha256 !== commandSha256
      || evidence.validatedAtCampaignMinute !== input.segment.throughCampaignMinute
      || (evidence.expiresAtCampaignMinute !== null
        && input.segment.throughCampaignMinute >= evidence.expiresAtCampaignMinute)
      || !input.receipt.evidenceDefinitionHashes.includes(evidence.definitionSha256)) return null
    const resource = readResource(input.readSet, 'parent-consent', evidence.consentId)
    const current = input.getConsent(evidence.consentId)
    if (resource?.existence !== 'present' || resource.revision !== evidence.consentRevision
      || resource.definitionSha256 !== evidence.consentRecordDefinitionSha256
      || !resource.purposes.includes('consent') || !current
      || current.definitionSha256 !== evidence.consentRecordDefinitionSha256
      || current.revision !== evidence.consentRevision || current.status !== 'active'
      || current.projectId !== evidence.projectId || current.parentSheetSlug !== evidence.parentSheetSlug
      || current.parentSheetRevision !== evidence.parentSheetRevision
      || current.ownerTrainerSlug !== evidence.ownerTrainerSlug
      || current.consentingProfileId !== evidence.consentingProfileId
      || current.expiresAtCampaignMinute !== evidence.expiresAtCampaignMinute
      || (current.expiresAtCampaignMinute !== null
        && input.segment.throughCampaignMinute >= current.expiresAtCampaignMinute)) return null
    creditedFrom = Math.max(creditedFrom, current.grantedAtCampaignMinute)
  }
  return creditedFrom
}
const coordinatorFor = (
  options: AdvanceBreedingProjectAdditionalTimeOptions,
): { readonly database: RotomDatabase, readonly coordinator: BreedingTransactionCoordinator } => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.additional-progress.repository-mismatch', 'Coordinator and additional-progress use case must share one database connection.')
  }
  return Object.freeze({
    database,
    coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }),
  })
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
const exactEvidence = (input: {
  readonly database: RotomDatabase
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
}): boolean => {
  const evidence = createSqliteBreedingOperationEvidenceRepository(input.database).get(input.command.operationId)
  return Boolean(evidence
    && stableJsonStringify(evidence.readSet) === stableJsonStringify(input.readSet)
    && stableJsonStringify(evidence.authorizationReceipt) === stableJsonStringify(input.receipt))
}
const audienceTargets = (project: BreedingProjectDocumentV1) => {
  const participatingOwners = [...new Set(project.parentRefs
    .map(parent => parent.ownerTrainerSlug)
    .filter(owner => owner !== project.ownerTrainerSlug))].sort()
  return Object.freeze([
    { audience: 'diagnostic' as const, trainerSheetSlug: null },
    { audience: 'gm' as const, trainerSheetSlug: null },
    { audience: 'owner' as const, trainerSheetSlug: project.ownerTrainerSlug },
    ...participatingOwners.map(trainerSheetSlug => ({ audience: 'participating-owner' as const, trainerSheetSlug })),
    { audience: 'public' as const, trainerSheetSlug: null },
  ])
}
const resultProjection = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly projectId: string
  readonly audience: 'gm' | 'owner'
}): AdvanceBreedingProjectAdditionalTimeResultV1 => {
  const project = createSqliteBreedingProjectRepository(input.database).get(input.projectId)
  const check = createSqliteBreedingCheckLedgerRepository(input.database).getCheckByProject(input.projectId)
  const projection = project && check
    && (project.status === 'additional-time-in-progress' || project.status === 'ready-to-produce')
    ? projectBreedingAdditionalProgressV1({ project, check, audience: input.audience })
    : null
  return Object.freeze({ execution: input.execution, project, check, projection })
}

export const advanceBreedingProjectAdditionalTime = (
  inputValue: unknown,
  options: AdvanceBreedingProjectAdditionalTimeOptions,
): AdvanceBreedingProjectAdditionalTimeResultV1 => {
  const input = strictInput(inputValue)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'advance-breeding-project-time') {
    return fail('breeding.additional-progress.wrong-command', 'Additional-progress use case accepts only advance-breeding-project-time.')
  }
  const authority = operationAuthority({
    command,
    readSetValue: input.readSet,
    receiptValue: input.authorizationReceipt,
  })
  if (authority.receipt.gmOverrideIds.length !== 0) {
    return fail('breeding.additional-progress.invalid-authority', 'Additional progress does not accept unpersisted GM overrides.')
  }
  const segment = parseAuthoritativeBreedingAdditionalProgressSegmentAuthorityV1(input.segmentAuthority)
  const dependency = authority.readSet.dependencyEvidence.find(value => (
    value.providerKind === 'system'
    && value.providerId === BREEDING_ADDITIONAL_PROGRESS_SEGMENT_PROVIDER_ID
    && value.subjectKind === 'project' && value.subjectId === segment.projectId
    && value.subjectRevision === segment.projectRevision
    && value.checkpoint === 'campaign-clock-segment'
  ))
  if (!dependency
    || dependency.providerDefinitionSha256 !== BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION_SHA256
    || dependency.effectiveEvidenceSha256 !== segment.definitionSha256
    || !authority.receipt.evidenceDefinitionHashes.includes(segment.definitionSha256)) {
    return fail('breeding.additional-progress.invalid-authority', 'Additional segment must be bound into both the complete read set and authorization receipt.')
  }
  const { database, coordinator } = coordinatorFor(options)
  const operation = createSqliteBreedingOperationRepository(database).get(command.operationId)
  if (operation && operation.status !== 'pending'
    && !exactEvidence({ database, command, readSet: authority.readSet, receipt: authority.receipt })) {
    return fail('breeding.additional-progress.invalid-authority', 'Terminal additional-progress operation is missing or disagrees with its immutable authority evidence.')
  }
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
      const check = context.repositories.checkLedger.getCheckByProject(project.projectId)
      const clock = context.repositories.campaignClock.get()
      const projectCurrent = resourceMatches({
        readSet: authority.readSet,
        kind: 'breeding-project',
        id: project.projectId,
        revision: project.revision,
        definitionSha256: breedingProjectDocumentDefinitionSha256(project),
        purpose: 'mechanics',
      })
      const checkCurrent = check !== null && resourceMatches({
        readSet: authority.readSet,
        kind: 'breeding-check',
        id: check.checkRecordId,
        revision: null,
        definitionSha256: check.definitionSha256,
        purpose: 'mechanics',
      })
      if (!projectCurrent || !checkCurrent || !clockMatches(authority.readSet, clock)
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
      const creditedFrom = currentContinuityStart({
        project,
        command: canonical,
        readSet: authority.readSet,
        receipt: authority.receipt,
        segment,
        consents: input.consentEvidence,
        getConsent: consentId => context.repositories.consents.get(consentId),
      })
      if (creditedFrom === null || creditedFrom !== segment.creditedFromCampaignMinute) {
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
      try {
        planned = planBreedingAdditionalProgressSegmentV1({
          project,
          check,
          command: canonical,
          segmentAuthority: segment,
        })
      }
      catch (error) {
        if (error instanceof BreedingAdditionalProgressAuthorityError) {
          const reasonId = error.code === 'breeding.additional-progress.unavailable'
            ? 'breeding.operation.unavailable' as const
            : error.code === 'breeding.additional-progress.stale-authority'
              ? 'breeding.operation.stale-revision' as const
              : 'breeding.operation.unauthorized' as const
          return createBreedingOperationRejectedV1({
            operationId: canonical.operationId,
            commandHash: commandSha256,
            commandKind: canonical.commandKind,
            reasonId,
            currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
            conflictingScopes: canonical.scopes,
          })
        }
        throw error
      }
      let committed = planned.project
      let changedScopes: BreedingOperationCommandV1['scopes'] = Object.freeze([])
      if (planned.kind === 'updated') {
        const replacement = context.repositories.projects.replace({ expectedRevision: project.revision, document: planned.project })
        if (replacement.kind !== 'applied') {
          return createBreedingOperationRejectedV1({
            operationId: canonical.operationId,
            commandHash: commandSha256,
            commandKind: canonical.commandKind,
            reasonId: 'breeding.operation.conflict',
            currentAggregateRefs: [],
            conflictingScopes: canonical.scopes,
          })
        }
        committed = replacement.document
        changedScopes = canonical.scopes
        context.appendRealtime(breedingRealtimeRefreshAppendInputs({
          aggregateKind: 'breeding-project',
          aggregateId: committed.projectId,
          revision: committed.revision,
          operationKind: canonical.commandKind,
          audienceTargets: audienceTargets(committed),
          campaignProjectionKey: options.campaignProjectionKey,
          timestamp: options.realtimeTimestamp,
        }))
      }
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: commandSha256,
        commandKind: canonical.commandKind,
        outcomeKind: 'project-progressed',
        aggregateRefs: [{ kind: 'breeding-project', id: committed.projectId, revision: committed.revision }],
        changedScopes,
        committedAtCampaignMinute: clock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending'
    && !exactEvidence({ database, command, readSet: authority.readSet, receipt: authority.receipt })) {
    return fail('breeding.additional-progress.invalid-authority', 'Terminal additional-progress operation lost its immutable authority evidence.')
  }
  return resultProjection({ database, execution, projectId: segment.projectId, audience: input.audience })
}
