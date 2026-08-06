import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import type { BreedingProjectLifecycleControlAudience, BreedingProjectLifecycleControlProjectionV1 } from '#shared/breeding/lifecycleRecovery'
import type { BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  authorizeBreedingLifecycleControlV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  BreedingLifecycleRecoveryAuthorityError,
  planBreedingConsentSettlementV1,
  planBreedingProjectConsentCheckpointV1,
  planBreedingProjectTerminationV1,
  projectBreedingLifecycleControlV1,
} from '../domain/breeding/lifecycleRecovery'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash, createBreedingOperationRejectedV1 } from '../domain/breeding/operations'
import { breedingProjectDocumentDefinitionSha256 } from '../domain/breeding/projectInitialProgress'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingConsentRepository } from '../storage/breedingConsentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { createBreedingTransactionCoordinator, type BreedingTransactionCoordinator, type BreedingTransactionExecutionDecision } from './executeBreedingTransaction'

export interface ManageBreedingLifecycleInputV1 {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly gmOverrides: readonly unknown[]
  readonly audience: BreedingProjectLifecycleControlAudience
}
export interface ManageBreedingLifecycleOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export interface ManageBreedingLifecycleResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly project: BreedingProjectDocumentV1 | null
  readonly consent: BreedingConsentRecordV1 | null
  readonly projection: BreedingProjectLifecycleControlProjectionV1 | null
}
export type ManageBreedingLifecycleErrorCode =
  | 'breeding.lifecycle-recovery.invalid-authority'
  | 'breeding.lifecycle-recovery.invalid-request'
  | 'breeding.lifecycle-recovery.repository-mismatch'
  | 'breeding.lifecycle-recovery.wrong-command'
export class ManageBreedingLifecycleError extends Error {
  readonly code: ManageBreedingLifecycleErrorCode
  constructor(code: ManageBreedingLifecycleErrorCode, message: string) { super(message); this.name = 'ManageBreedingLifecycleError'; this.code = code }
}
const fail = (code: ManageBreedingLifecycleErrorCode, message: string): never => { throw new ManageBreedingLifecycleError(code, message) }
const assertStrictInput = (value: unknown): asserts value is ManageBreedingLifecycleInputV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.lifecycle-recovery.invalid-request', 'Lifecycle input must be a plain data object without symbols.')
  const fields = ['command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'trainerControl', 'gmOverrides', 'audience']
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) return fail('breeding.lifecycle-recovery.invalid-request', 'Lifecycle input must contain exactly the declared fields.')
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.lifecycle-recovery.invalid-request', `Lifecycle input ${field} must be an enumerable data field.`) }
}
const assertStrictArray = (value: unknown, maximum: number, label: string): asserts value is readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) return fail('breeding.lifecycle-recovery.invalid-request', `${label} must be a strict array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.lifecycle-recovery.invalid-request', `${label} must not be sparse or accessor-backed.`) }
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const readResource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string): BreedingReadResourceV1 | null => readSet.resources.find(value => value.resourceKind === kind && value.resourceId === id) ?? null
const resourceMatches = (resource: BreedingReadResourceV1 | null, input: { readonly revision: number, readonly definitionSha256: string }): boolean => resource?.existence === 'present' && resource.revision === input.revision && resource.definitionSha256 === input.definitionSha256
const clockDefinition = (clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): string => sha256({ schemaVersion: 1, revision: clock.revision, campaignMinute: clock.campaignMinute, lastOperationId: clock.lastOperationId })
const clockMatches = (readSet: BreedingOperationReadSetV1, clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): boolean => {
  const resource = readResource(readSet, 'campaign-clock', 'campaign-clock')
  return resource?.existence === 'present' && resource.revision === clock.revision && resource.observedCampaignMinute === clock.campaignMinute && resource.definitionSha256 === clockDefinition(clock) && readSet.capturedAtCampaignMinute === clock.campaignMinute
}
const audienceTargets = (project: BreedingProjectDocumentV1) => {
  const participants = [...new Set(project.parentRefs.map(parent => parent.ownerTrainerSlug).filter(value => value !== project.ownerTrainerSlug))].sort()
  return Object.freeze([{ audience: 'diagnostic' as const, trainerSheetSlug: null }, { audience: 'gm' as const, trainerSheetSlug: null }, { audience: 'owner' as const, trainerSheetSlug: project.ownerTrainerSlug }, ...participants.map(trainerSheetSlug => ({ audience: 'participating-owner' as const, trainerSheetSlug })), { audience: 'public' as const, trainerSheetSlug: null }])
}
const appendProjectRefresh = (input: { readonly project: BreedingProjectDocumentV1, readonly commandKind: 'cancel-breeding-project' | 'revoke-breeding-consent', readonly context: Parameters<Parameters<BreedingTransactionCoordinator['execute']>[0]['execute']>[2], readonly options: ManageBreedingLifecycleOptions }): void => {
  input.context.appendRealtime(breedingRealtimeRefreshAppendInputs({ aggregateKind: 'breeding-project', aggregateId: input.project.projectId, revision: input.project.revision, operationKind: input.commandKind, audienceTargets: audienceTargets(input.project), campaignProjectionKey: input.options.campaignProjectionKey, timestamp: input.options.realtimeTimestamp }))
}
const coordinatorFor = (options: ManageBreedingLifecycleOptions): { readonly database: RotomDatabase, readonly coordinator: BreedingTransactionCoordinator } => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) return fail('breeding.lifecycle-recovery.repository-mismatch', 'Coordinator and lifecycle manager must use one database connection.')
  return Object.freeze({ database, coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }) })
}
const requireEvidenceReplay = (input: { readonly database: RotomDatabase, readonly operationId: string, readonly readSet: BreedingOperationReadSetV1, readonly receipt: BreedingAuthorizationReceiptV1 }): void => {
  const operation = createSqliteBreedingOperationRepository(input.database).get(input.operationId)
  const evidence = createSqliteBreedingOperationEvidenceRepository(input.database).get(input.operationId)
  if (evidence && (!same(evidence.readSet, input.readSet) || !same(evidence.authorizationReceipt, input.receipt))) return fail('breeding.lifecycle-recovery.invalid-authority', 'Operation identity is already bound to different lifecycle authority evidence.')
  if (operation && operation.status !== 'pending' && !evidence) return fail('breeding.lifecycle-recovery.invalid-authority', 'Terminal lifecycle operation is missing immutable authority evidence.')
}
const currentTrainerControlMatches = (database: RotomDatabase, control: BreedingTrainerControlEvidenceV1 | null): boolean => {
  if (!control) return true
  const sheet = createSqliteSheetRepository(database).get('trainer', control.trainerSheetSlug)
  return sheet?.revision === control.trainerSheetRevision && sha256(sheet.document) === control.trainerSheetDefinitionSha256
}
const expectedAuthorization = (input: { readonly command: ReturnType<typeof parseBreedingOperationCommandV1>, readonly readSet: BreedingOperationReadSetV1, readonly actorAuthority: BreedingActorAuthorityV1, readonly trainerControl: BreedingTrainerControlEvidenceV1 | null, readonly project: BreedingProjectDocumentV1, readonly consent: BreedingConsentRecordV1 | null, readonly gmOverrides: readonly unknown[] }): BreedingAuthorizationReceiptV1 => authorizeBreedingLifecycleControlV1({ command: input.command, readSet: input.readSet, actorAuthority: input.actorAuthority, trainerControl: input.trainerControl, project: input.project, consent: input.consent, gmOverrides: input.gmOverrides, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })

export const manageBreedingLifecycle = (input: ManageBreedingLifecycleInputV1, options: ManageBreedingLifecycleOptions): ManageBreedingLifecycleResultV1 => {
  assertStrictInput(input)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'cancel-breeding-project' && command.commandKind !== 'revoke-breeding-consent') return fail('breeding.lifecycle-recovery.wrong-command', 'Lifecycle manager accepts only cancel-breeding-project or revoke-breeding-consent.')
  if ((command.commandKind === 'cancel-breeding-project' && input.audience === 'participating-owner') || (command.commandKind === 'revoke-breeding-consent' && input.audience === 'owner')) return fail('breeding.lifecycle-recovery.invalid-request', 'Requested audience is not a lifecycle-command response audience.')
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = input.trainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  assertStrictArray(input.gmOverrides, 1, 'gmOverrides')
  const { database, coordinator } = coordinatorFor(options)
  const projectRepository = createSqliteBreedingProjectRepository(database)
  const consentRepository = createSqliteBreedingConsentRepository(database)
  const operationRepository = createSqliteBreedingOperationRepository(database)
  const projectId = command.payload.projectId
  const commandSha256 = createBreedingOperationCommandHash(command)
  const staticReceiptMatches = receipt.authorized && receipt.reasonId === 'breeding.authorization.authorized' && receipt.operationId === command.operationId && receipt.commandSha256 === commandSha256 && receipt.commandKind === command.commandKind && receipt.readSetDefinitionSha256 === readSet.definitionSha256 && receipt.actorAuthorityDefinitionSha256 === actor.definitionSha256 && receipt.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute && receipt.securityPolicyDefinitionSha256 === securityPolicyJson.definitionSha256 && (control === null || receipt.evidenceDefinitionHashes.includes(control.definitionSha256))
  if (!staticReceiptMatches) return fail('breeding.lifecycle-recovery.invalid-authority', 'Lifecycle receipt must bind the exact command, actor, evidence, read set, campaign minute, and current security policy.')
  const existing = operationRepository.get(command.operationId)
  if (existing && existing.status !== 'pending') {
    requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
    const exact = coordinator.execute({ command, createdAtCampaignMinute: readSet.capturedAtCampaignMinute, settledAtCampaignMinute: readSet.capturedAtCampaignMinute, execute: () => fail('breeding.lifecycle-recovery.invalid-request', 'Exact retry must not re-enter lifecycle mechanics.') })
    const exactProject = projectRepository.get(projectId)
    const exactConsent = command.commandKind === 'revoke-breeding-consent' ? consentRepository.get(command.payload.consentId) : null
    const accepted = exact.record.result?.ok === true ? exact.record.result : null
    const projectRef = accepted?.aggregateRefs.find(value => value.kind === 'breeding-project' && value.id === projectId)
    const exactProjection = accepted && exactProject && projectRef ? projectBreedingLifecycleControlV1({ command, project: exactProject, projectRevision: projectRef.revision, consentStatus: command.commandKind === 'revoke-breeding-consent' && exactConsent && exactConsent.status !== 'active' && exactConsent.status !== 'superseded' ? exactConsent.status : null, audience: input.audience, completedAtCampaignMinute: accepted.committedAtCampaignMinute! }) : null
    return Object.freeze({ execution: exact, project: exactProject, consent: exactConsent, projection: exactProjection })
  }
  const initialProject = projectRepository.get(projectId) ?? fail('breeding.lifecycle-recovery.invalid-authority', 'Lifecycle authority requires the current Project.')
  const initialConsent = command.commandKind === 'revoke-breeding-consent' ? consentRepository.get(command.payload.consentId) : null
  const expected = expectedAuthorization({ command, readSet, actorAuthority: actor, trainerControl: control, project: initialProject, consent: initialConsent, gmOverrides: input.gmOverrides })
  if (!expected.authorized || !same(expected, receipt) || !currentTrainerControlMatches(database, control)) return fail('breeding.lifecycle-recovery.invalid-authority', 'Lifecycle operation requires exact current actor authority, Trainer control or GM override, read set, and security-policy receipt.')
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...(options.resumePending === true ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      context.repositories.operationEvidence.insert({ command: canonical, readSet, authorizationReceipt: receipt })
      const hash = createBreedingOperationCommandHash(canonical)
      const clock = context.repositories.campaignClock.get()
      const project = context.repositories.projects.get(projectId)
      if (!project) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.not-found', currentAggregateRefs: [], conflictingScopes: canonical.scopes })
      const projectResource = readResource(readSet, 'breeding-project', project.projectId)
      const currentConsent = canonical.commandKind === 'revoke-breeding-consent' ? context.repositories.consents.get(canonical.payload.consentId) : null
      const consentResource = currentConsent ? readResource(readSet, 'parent-consent', currentConsent.consentId) : null
      const currentExpected = expectedAuthorization({ command: canonical, readSet, actorAuthority: actor, trainerControl: control, project, consent: currentConsent, gmOverrides: input.gmOverrides })
      if (!clockMatches(readSet, clock) || !resourceMatches(projectResource, { revision: project.revision, definitionSha256: breedingProjectDocumentDefinitionSha256(project) }) || !same(currentExpected, receipt) || !currentTrainerControlMatches(database, control) || (currentConsent !== null && !resourceMatches(consentResource, { revision: currentConsent.revision, definitionSha256: currentConsent.definitionSha256 }))) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }], conflictingScopes: canonical.scopes })
      if (canonical.commandKind === 'cancel-breeding-project') {
        const expiredConsentEvidence = context.repositories.consents.listByProject(project.projectId, 10).filter(consent => consent.status === 'active' && consent.expiresAtCampaignMinute !== null && clock.campaignMinute >= consent.expiresAtCampaignMinute && resourceMatches(readResource(readSet, 'parent-consent', consent.consentId), { revision: consent.revision, definitionSha256: consent.definitionSha256 }))
        let next: BreedingProjectDocumentV1
        try { next = planBreedingProjectTerminationV1({ command: canonical, project, campaignMinute: clock.campaignMinute, expiredConsentEvidence }) }
        catch (error) {
          if (!(error instanceof BreedingLifecycleRecoveryAuthorityError)) throw error
          return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: error.code === 'breeding.lifecycle-recovery.stale-authority' ? 'breeding.operation.stale-revision' : 'breeding.operation.unavailable', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }], conflictingScopes: canonical.scopes })
        }
        const replaced = context.repositories.projects.replace({ expectedRevision: project.revision, document: next })
        if (replaced.kind !== 'applied') return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: replaced.currentRevision ?? project.revision }], conflictingScopes: canonical.scopes })
        appendProjectRefresh({ project: replaced.document, commandKind: canonical.commandKind, context, options })
        return createBreedingOperationAcceptedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, outcomeKind: 'project-cancelled', aggregateRefs: [{ kind: 'breeding-project', id: replaced.document.projectId, revision: replaced.document.revision }], changedScopes: canonical.scopes, committedAtCampaignMinute: clock.campaignMinute })
      }
      if (!currentConsent) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.not-found', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }], conflictingScopes: canonical.scopes })
      let consent: BreedingConsentRecordV1
      let nextProject: BreedingProjectDocumentV1
      try {
        consent = planBreedingConsentSettlementV1({ command: canonical, project, consent: currentConsent, campaignMinute: clock.campaignMinute })
        nextProject = planBreedingProjectConsentCheckpointV1({ command: canonical, project, campaignMinute: clock.campaignMinute })
      } catch (error) {
        if (!(error instanceof BreedingLifecycleRecoveryAuthorityError)) throw error
        return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: error.code === 'breeding.lifecycle-recovery.stale-authority' ? 'breeding.operation.stale-revision' : 'breeding.operation.unavailable', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }], conflictingScopes: canonical.scopes })
      }
      let settledProject = project
      const projectChanged = nextProject.revision !== project.revision
      if (projectChanged) {
        const projectReplace = context.repositories.projects.replace({ expectedRevision: project.revision, document: nextProject })
        if (projectReplace.kind !== 'applied') return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: projectReplace.currentRevision ?? project.revision }], conflictingScopes: canonical.scopes })
        settledProject = projectReplace.document
      }
      const consentReplace = context.repositories.consents.replace({ expectedRevision: currentConsent.revision, record: consent })
      if (consentReplace.kind !== 'applied') {
        if (projectChanged) throw new BreedingLifecycleRecoveryAuthorityError('breeding.lifecycle-recovery.stale-authority', 'consent', 'Consent changed after the Project checkpoint; roll back the entire phase.')
        return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }], conflictingScopes: canonical.scopes })
      }
      if (projectChanged) appendProjectRefresh({ project: settledProject, commandKind: canonical.commandKind, context, options })
      return createBreedingOperationAcceptedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, outcomeKind: 'consent-revoked', aggregateRefs: [{ kind: 'breeding-project', id: settledProject.projectId, revision: settledProject.revision }, { kind: 'parent-consent', id: consent.consentId, revision: consent.revision }], changedScopes: projectChanged ? canonical.scopes : canonical.scopes.filter(scope => scope.kind === 'parent-consent'), committedAtCampaignMinute: clock.campaignMinute })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  const currentProject = projectRepository.get(projectId)
  const currentConsent = command.commandKind === 'revoke-breeding-consent' ? consentRepository.get(command.payload.consentId) : null
  const accepted = execution.record.result?.ok === true ? execution.record.result : null
  const projectRef = accepted?.aggregateRefs.find(value => value.kind === 'breeding-project' && value.id === projectId)
  const projection = accepted && currentProject && projectRef ? projectBreedingLifecycleControlV1({ command, project: currentProject, projectRevision: projectRef.revision, consentStatus: command.commandKind === 'revoke-breeding-consent' && currentConsent && currentConsent.status !== 'active' && currentConsent.status !== 'superseded' ? currentConsent.status : null, audience: input.audience, completedAtCampaignMinute: accepted.committedAtCampaignMinute! }) : null
  return Object.freeze({ execution, project: currentProject, consent: currentConsent, projection })
}
