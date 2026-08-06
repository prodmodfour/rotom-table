import { createHash, randomInt } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingAuthorizationReceiptV1,
  BreedingBreederAuthorityEvidenceV1,
  BreedingCrossOwnerConsentEvidenceV1,
} from '#shared/breeding/authorization'
import type {
  BreedingCheckRecordV1,
  BreedingConsentRecordV1,
  BreedingRollRecordV1,
} from '#shared/breeding/ledgers'
import type { BreedingOperationCommandV1, BreedingOperationResultV1 } from '#shared/breeding/operations'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingProjectCheckProjectionV1 } from '#shared/breeding/projectCheck'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingBreederAuthorityEvidenceV1,
  parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1,
} from '../domain/breeding/authorization'
import { createBreedingRollRecordFromInjectedValues } from '../domain/breeding/ledgers'
import {
  breedingProjectCheckRollSourceDefinitionHashes,
  planBreedingProjectCheckV1,
  projectBreedingProjectCheckV1,
  BreedingProjectCheckAuthorityError,
} from '../domain/breeding/projectCheck'
import { breedingProjectDocumentDefinitionSha256 } from '../domain/breeding/projectInitialProgress'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingCheckLedgerRepository } from '../storage/breedingCheckLedgerRepository'
import { createSqliteBreedingConsentRepository } from '../storage/breedingConsentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface ResolveBreedingProjectCheckResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly project: BreedingProjectDocumentV1 | null
  readonly check: BreedingCheckRecordV1 | null
  readonly projection: BreedingProjectCheckProjectionV1 | null
}
export interface ResolveBreedingProjectCheckOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly drawBreederCheckD20?: () => number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type ResolveBreedingProjectCheckErrorCode =
  | 'breeding.project-check.invalid-request'
  | 'breeding.project-check.invalid-authority'
  | 'breeding.project-check.invalid-random-source'
  | 'breeding.project-check.repository-mismatch'
  | 'breeding.project-check.wrong-command'
export class ResolveBreedingProjectCheckError extends Error {
  readonly code: ResolveBreedingProjectCheckErrorCode
  constructor(code: ResolveBreedingProjectCheckErrorCode, message: string) {
    super(message)
    this.name = 'ResolveBreedingProjectCheckError'
    this.code = code
  }
}
const fail = (code: ResolveBreedingProjectCheckErrorCode, message: string): never => {
  throw new ResolveBreedingProjectCheckError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const strictInput = (value: unknown): {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly breederAuthority: unknown
  readonly consentEvidence: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly audience: 'gm' | 'owner'
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project-check.invalid-request', 'Project check input must be a plain exact object.')
  }
  const row = value as Record<string, unknown>
  const fields = ['command', 'readSet', 'authorizationReceipt', 'breederAuthority', 'consentEvidence', 'audience']
  for (const key of Object.getOwnPropertyNames(row)) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project-check.invalid-request', 'Project check input cannot contain accessors or hidden fields.')
    }
  }
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !fields.includes(field))
    || (row.audience !== 'gm' && row.audience !== 'owner')) {
    return fail('breeding.project-check.invalid-request', 'Project check input must contain exactly command, read set, authorization, Breeder authority, consent evidence, and audience.')
  }
  if (!Array.isArray(row.consentEvidence) || Object.getPrototypeOf(row.consentEvidence) !== Array.prototype
    || row.consentEvidence.length > 2 || Object.getOwnPropertySymbols(row.consentEvidence).length > 0
    || Object.getOwnPropertyNames(row.consentEvidence).length !== row.consentEvidence.length + 1) {
    return fail('breeding.project-check.invalid-request', 'Consent evidence must be one plain bounded array.')
  }
  const consentEvidence = row.consentEvidence.map((value, index) => (
    parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1(value, `consentEvidence[${index}]`)
  ))
  return Object.freeze({
    command: row.command,
    readSet: row.readSet,
    authorizationReceipt: row.authorizationReceipt,
    breederAuthority: row.breederAuthority,
    consentEvidence: Object.freeze(consentEvidence),
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
    return fail('breeding.project-check.invalid-authority', 'Check requires one current authorized receipt bound to the exact complete read set and security policy.')
  }
  return Object.freeze({ readSet, receipt })
}
const validateBreederAuthority = (input: {
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly breederValue: unknown
}): BreedingBreederAuthorityEvidenceV1 => {
  const breeder = parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.breederValue)
  const edgeDependency = input.readSet.dependencyEvidence.find(value => (
    value.providerKind === 'edge' && value.providerId === 'Breeder'
    && value.subjectKind === 'trainer-sheet' && value.subjectId === breeder.breederTrainerSlug
    && value.subjectRevision === breeder.breederTrainerRevision
    && value.checkpoint === 'project-check'
  ))
  if (breeder.evaluatedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute
    || !resourceMatches({
      readSet: input.readSet,
      kind: 'trainer-sheet',
      id: breeder.breederTrainerSlug,
      revision: breeder.breederTrainerRevision,
      definitionSha256: breeder.breederTrainerDefinitionSha256,
      purpose: 'mechanics',
    })
    || !edgeDependency
    || edgeDependency.providerDefinitionSha256 !== breeder.edgeRecordSha256
    || edgeDependency.effectiveEvidenceSha256 !== breeder.effectiveEdgeProjectionSha256
    || !input.receipt.evidenceDefinitionHashes.includes(breeder.definitionSha256)) {
    return fail('breeding.project-check.invalid-authority', 'Current Breeder Trainer, effective Edge, skill total, read set, and receipt evidence must match exactly.')
  }
  return breeder
}
const hasCurrentProjectContinuity = (input: {
  readonly project: BreedingProjectDocumentV1
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly consentEvidence: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly getConsent: (consentId: string) => BreedingConsentRecordV1 | null
}): boolean => {
  const commandSha256 = createBreedingOperationCommandHash(input.command)
  if (input.project.parentRefs.some(parent => !resourceMatches({
    readSet: input.readSet,
    kind: 'pokemon-sheet',
    id: parent.pokemonSheetSlug,
    revision: parent.expectedSheetRevision,
    definitionSha256: readResource(input.readSet, 'pokemon-sheet', parent.pokemonSheetSlug)?.definitionSha256 ?? '',
    purpose: 'snapshot',
  }))) return false
  const crossOwnerParents = input.project.parentRefs.filter(parent => (
    parent.ownerTrainerSlug !== input.project.ownerTrainerSlug
  ))
  if ((crossOwnerParents.length > 0) !== (input.project.consentPolicy === 'cross-owner-current-revision-consent')
    || input.consentEvidence.length !== crossOwnerParents.length) return false
  return crossOwnerParents.every((parent, index) => {
    const evidence = input.consentEvidence[index]
    if (!evidence || evidence.projectId !== input.project.projectId
      || evidence.parentSheetSlug !== parent.pokemonSheetSlug
      || evidence.parentSheetRevision !== parent.expectedSheetRevision
      || evidence.ownerTrainerSlug !== parent.ownerTrainerSlug
      || evidence.validationOperationId !== input.command.operationId
      || evidence.validationCommandSha256 !== commandSha256
      || evidence.validatedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute
      || (evidence.expiresAtCampaignMinute !== null
        && input.readSet.capturedAtCampaignMinute >= evidence.expiresAtCampaignMinute)
      || !input.receipt.evidenceDefinitionHashes.includes(evidence.definitionSha256)) return false
    const resource = readResource(input.readSet, 'parent-consent', evidence.consentId)
    const current = input.getConsent(evidence.consentId)
    return resource?.existence === 'present' && resource.revision === evidence.consentRevision
      && resource.definitionSha256 === evidence.consentRecordDefinitionSha256
      && resource.purposes.includes('consent') && current !== null
      && current.definitionSha256 === evidence.consentRecordDefinitionSha256
      && current.revision === evidence.consentRevision && current.status === 'active'
      && current.projectId === evidence.projectId
      && current.parentSheetSlug === evidence.parentSheetSlug
      && current.parentSheetRevision === evidence.parentSheetRevision
      && current.ownerTrainerSlug === evidence.ownerTrainerSlug
      && current.consentingProfileId === evidence.consentingProfileId
      && current.expiresAtCampaignMinute === evidence.expiresAtCampaignMinute
      && (current.expiresAtCampaignMinute === null
        || input.readSet.capturedAtCampaignMinute < current.expiresAtCampaignMinute)
  })
}
const coordinatorFor = (
  options: ResolveBreedingProjectCheckOptions,
): { readonly database: RotomDatabase, readonly coordinator: BreedingTransactionCoordinator } => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.project-check.repository-mismatch', 'Coordinator and check use case must share one database connection.')
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
const rollRecordId = (operationId: string): `breeding-roll:v1:${string}` => (
  `breeding-roll:v1:${createHash('sha256').update(`breeding-project-check-roll-v1\0${operationId}`).digest('hex').slice(0, 32)}`
)
const drawD20 = (draw: () => number): number => {
  let value: unknown
  try { value = draw() }
  catch { return fail('breeding.project-check.invalid-random-source', 'Server d20 source threw before a roll could be persisted.') }
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 20) {
    return fail('breeding.project-check.invalid-random-source', 'Server d20 source must return one integer from 1 through 20.')
  }
  return Number(value)
}
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
const prepareAuthorityAndRoll = (input: {
  readonly database: RotomDatabase
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly breeder: BreedingBreederAuthorityEvidenceV1
  readonly consentEvidence: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly draw: () => number
}): BreedingRollRecordV1 | null => input.database.withTransaction(() => {
  createSqliteBreedingOperationEvidenceRepository(input.database).insert({
    command: input.command,
    readSet: input.readSet,
    authorizationReceipt: input.receipt,
  })
  const ledger = createSqliteBreedingCheckLedgerRepository(input.database)
  const existing = ledger.getRollByOperation(input.command.operationId)
  if (existing) return existing
  const scope = input.command.scopes[0]
  if (scope?.kind !== 'breeding-project' || scope.expectedRevision === null) {
    return fail('breeding.project-check.invalid-authority', 'Check command must bind one current Project revision before rolling.')
  }
  const project = createSqliteBreedingProjectRepository(input.database).get(scope.projectId)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const projectResource = readResource(input.readSet, 'breeding-project', scope.projectId)
  if (!project || project.revision !== scope.expectedRevision || project.status !== 'check-ready'
    || project.check !== null || project.breederTrainerSlug !== input.breeder.breederTrainerSlug
    || project.ruleset.rulesetId !== input.command.ruleset.rulesetId
    || project.ruleset.definitionSha256 !== input.command.ruleset.definitionSha256
    || projectResource?.existence !== 'present' || projectResource.revision !== project.revision
    || projectResource.definitionSha256 !== breedingProjectDocumentDefinitionSha256(project)
    || ledger.getCheckByProject(project.projectId) !== null || !clockMatches(input.readSet, clock)
    || !hasCurrentProjectContinuity({
      project,
      command: input.command,
      readSet: input.readSet,
      receipt: input.receipt,
      consentEvidence: input.consentEvidence,
      getConsent: consentId => createSqliteBreedingConsentRepository(input.database).get(consentId),
    })) {
    return null
  }
  const roll = createBreedingRollRecordFromInjectedValues({
    schemaVersion: 1,
    rollRecordId: rollRecordId(input.command.operationId),
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    operationRollOrdinal: 0,
    purpose: 'breeder-check-d20',
    target: { kind: 'breeding-project', projectId: scope.projectId, revision: scope.expectedRevision },
    formula: '1d20',
    dieCount: 1,
    dieSides: 20,
    ordered: false,
    modifier: 0,
    values: [drawD20(input.draw)],
    generatorId: 'server-rng-v1',
    sourceDefinitionHashes: breedingProjectCheckRollSourceDefinitionHashes(
      input.breeder,
      input.command.ruleset.definitionSha256,
    ),
    generatedAtCampaignMinute: input.readSet.capturedAtCampaignMinute,
  })
  return ledger.insertRoll({ command: input.command, roll })
})
const resultProjection = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly projectId: string
  readonly audience: 'gm' | 'owner'
  readonly mandatedSkillId: 'pokemon-education' | 'general-education' | 'perception'
}): ResolveBreedingProjectCheckResultV1 => {
  const project = createSqliteBreedingProjectRepository(input.database).get(input.projectId)
  const check = createSqliteBreedingCheckLedgerRepository(input.database).getCheckByProject(input.projectId)
  let projection: BreedingProjectCheckProjectionV1 | null = null
  if (project && check && (project.status === 'additional-time-in-progress' || project.status === 'check-failed')) {
    projection = projectBreedingProjectCheckV1({ project, check, audience: input.audience, mandatedSkillId: input.mandatedSkillId })
  }
  return Object.freeze({ execution: input.execution, project, check, projection })
}

export const resolveBreedingProjectCheck = (
  inputValue: unknown,
  options: ResolveBreedingProjectCheckOptions,
): ResolveBreedingProjectCheckResultV1 => {
  const input = strictInput(inputValue)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'resolve-breeding-check') {
    return fail('breeding.project-check.wrong-command', 'Check use case accepts only resolve-breeding-check.')
  }
  const authority = operationAuthority({
    command,
    readSetValue: input.readSet,
    receiptValue: input.authorizationReceipt,
  })
  const breeder = validateBreederAuthority({
    command,
    readSet: authority.readSet,
    receipt: authority.receipt,
    breederValue: input.breederAuthority,
  })
  const { database, coordinator } = coordinatorFor(options)
  const operations = createSqliteBreedingOperationRepository(database)
  const reservation = database.withTransaction(() => operations.reserve(
    command,
    authority.readSet.capturedAtCampaignMinute,
  ))
  if (reservation.kind === 'exact-retry') {
    if (!exactEvidence({ database, command, readSet: authority.readSet, receipt: authority.receipt })) {
      return fail('breeding.project-check.invalid-authority', 'Terminal check operation is missing or disagrees with its immutable authority evidence.')
    }
  }
  else if (reservation.kind === 'reserved' || options.resumePending === true) {
    prepareAuthorityAndRoll({
      database,
      command,
      readSet: authority.readSet,
      receipt: authority.receipt,
      breeder,
      consentEvidence: input.consentEvidence,
      draw: options.drawBreederCheckD20 ?? (() => randomInt(1, 21)),
    })
  }

  const shouldResume = reservation.kind === 'reserved' || options.resumePending === true
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: authority.readSet.capturedAtCampaignMinute,
    ...(shouldResume ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      const commandSha256 = createBreedingOperationCommandHash(canonical)
      const project = context.repositories.projects.get(canonical.payload.projectId)
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
      const projectResource = readResource(authority.readSet, 'breeding-project', project.projectId)
      const clock = context.repositories.campaignClock.get()
      const existingCheck = context.repositories.checkLedger.getCheckByProject(project.projectId)
      if (projectResource?.existence !== 'present' || projectResource.revision !== project.revision
        || projectResource.definitionSha256 !== breedingProjectDocumentDefinitionSha256(project)
        || !projectResource.purposes.includes('mechanics')
        || !clockMatches(authority.readSet, clock)
        || existingCheck !== null) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      if (project.status !== 'check-ready' || project.check !== null
        || !hasCurrentProjectContinuity({
          project,
          command: canonical,
          readSet: authority.readSet,
          receipt: authority.receipt,
          consentEvidence: input.consentEvidence,
          getConsent: consentId => context.repositories.consents.get(consentId),
        })) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.unavailable',
          currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const persistedEvidence = context.repositories.operationEvidence.get(canonical.operationId)
      const persistedRoll = context.repositories.checkLedger.getRollByOperation(canonical.operationId)
      if (!persistedEvidence || !persistedRoll
        || stableJsonStringify(persistedEvidence.readSet) !== stableJsonStringify(authority.readSet)
        || stableJsonStringify(persistedEvidence.authorizationReceipt) !== stableJsonStringify(authority.receipt)) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: commandSha256,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.unauthorized',
          currentAggregateRefs: [{ kind: 'breeding-project', id: project.projectId, revision: project.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let planned
      try {
        planned = planBreedingProjectCheckV1({
          project,
          command: canonical,
          breederAuthority: breeder,
          persistedRoll,
          campaignClockRevision: clock.revision,
          resolvedAtCampaignMinute: clock.campaignMinute,
        })
      }
      catch (error) {
        if (error instanceof BreedingProjectCheckAuthorityError) {
          const reasonId = error.code === 'breeding.project-check.unavailable'
            ? 'breeding.operation.unavailable' as const
            : error.code === 'breeding.project-check.stale-authority'
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
      const replacement = context.repositories.projects.replace({
        expectedRevision: project.revision,
        document: planned.project,
      })
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
      context.repositories.checkLedger.insertCheck({
        command: canonical,
        check: planned.check,
        roll: persistedRoll,
      })
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'breeding-project',
        aggregateId: planned.project.projectId,
        revision: planned.project.revision,
        operationKind: canonical.commandKind,
        audienceTargets: audienceTargets(planned.project),
        campaignProjectionKey: options.campaignProjectionKey,
        timestamp: options.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: commandSha256,
        commandKind: canonical.commandKind,
        outcomeKind: 'check-resolved',
        aggregateRefs: [{ kind: 'breeding-project', id: planned.project.projectId, revision: planned.project.revision }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: clock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending') {
    if (!exactEvidence({ database, command, readSet: authority.readSet, receipt: authority.receipt })) {
      return fail('breeding.project-check.invalid-authority', 'Terminal check operation lost its immutable authority evidence.')
    }
    const ledger = createSqliteBreedingCheckLedgerRepository(database)
    if (execution.record.result?.ok === true) {
      const persistedRoll = ledger.getRollByOperation(command.operationId)
      const persistedCheck = ledger.getCheck(command.payload.checkRecordId)
      if (!persistedRoll || !persistedCheck || persistedCheck.operationId !== command.operationId
        || persistedCheck.rollRecordId !== persistedRoll.rollRecordId) {
        return fail('breeding.project-check.invalid-authority', 'Accepted check operation lost its immutable check-to-roll link.')
      }
    }
  }
  return resultProjection({
    database,
    execution,
    projectId: command.payload.projectId,
    audience: input.audience,
    mandatedSkillId: breeder.mandatedSkillId ?? 'pokemon-education',
  })
}
