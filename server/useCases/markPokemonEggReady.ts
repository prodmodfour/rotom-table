import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingActorAuthorityV1,
  BreedingAuthorizationReceiptV1,
} from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseBreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingEggReadyCorrectionProjectionV1 } from '#shared/breeding/readinessCorrection'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  authorizeBreedingEggReadinessCorrectionV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
} from '../domain/breeding/authorization'
import {
  BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256,
  BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256,
  BREEDING_READINESS_CORRECTION_PROVIDER_ID,
  BreedingReadinessCorrectionAuthorityError,
  planBreedingEggReadinessCorrectionV1,
  projectBreedingEggReadinessCorrectionV1,
} from '../domain/breeding/readinessCorrection'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface MarkPokemonEggReadyInputV1 {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly actorAuthority: unknown
  readonly gmOverrides: readonly unknown[]
}

export interface MarkPokemonEggReadyOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}

export interface MarkPokemonEggReadyResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly projection: BreedingEggReadyCorrectionProjectionV1 | null
}

export type MarkPokemonEggReadyErrorCode =
  | 'breeding.readiness-correction-use-case.invalid-authority'
  | 'breeding.readiness-correction-use-case.invalid-request'
  | 'breeding.readiness-correction-use-case.repository-mismatch'
  | 'breeding.readiness-correction-use-case.wrong-command'

export class MarkPokemonEggReadyError extends Error {
  readonly code: MarkPokemonEggReadyErrorCode

  constructor(code: MarkPokemonEggReadyErrorCode, message: string) {
    super(message)
    this.name = 'MarkPokemonEggReadyError'
    this.code = code
  }
}

const fail = (code: MarkPokemonEggReadyErrorCode, message: string): never => {
  throw new MarkPokemonEggReadyError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const same = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(left) === stableJsonStringify(right)
)
const strictObject = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.readiness-correction-use-case.invalid-request', `${label} must be a plain data object without symbols.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.readiness-correction-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.readiness-correction-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.readiness-correction-use-case.invalid-request', `${label} must be a strict array of at most ${maximum} entries.`)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1
    || names.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) {
    return fail('breeding.readiness-correction-use-case.invalid-request', `${label} must be a strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.readiness-correction-use-case.invalid-request', `${label} must not be sparse or accessor-backed.`)
    }
  }
  return value
}
const readResource = (
  readSet: BreedingOperationReadSetV1,
  kind: BreedingReadResourceV1['resourceKind'],
  id: string,
): BreedingReadResourceV1 | null => readSet.resources.find(resource => (
  resource.resourceKind === kind && resource.resourceId === id
)) ?? null
const clockDefinition = (clock: {
  readonly revision: number
  readonly campaignMinute: number
  readonly lastOperationId: string | null
}): string => sha256({
  schemaVersion: 1,
  revision: clock.revision,
  campaignMinute: clock.campaignMinute,
  lastOperationId: clock.lastOperationId,
})
const clockMatches = (
  readSet: BreedingOperationReadSetV1,
  clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null },
): boolean => {
  const resource = readResource(readSet, 'campaign-clock', 'campaign-clock')
  return resource?.existence === 'present' && resource.revision === clock.revision
    && resource.observedCampaignMinute === clock.campaignMinute
    && resource.definitionSha256 === clockDefinition(clock)
    && resource.purposes.includes('campaign-time')
    && readSet.capturedAtCampaignMinute === clock.campaignMinute
}
const hasExactCorrectionDependency = (
  readSet: BreedingOperationReadSetV1,
  egg: PokemonEggDocumentV1,
): boolean => {
  const attestations = readSet.dependencyEvidence.filter(value => (
    value.providerKind === 'system'
    && value.providerId === 'breeding-effective-dependency-set-v1'
    && value.subjectKind === 'campaign'
    && value.subjectId === 'campaign'
    && value.subjectRevision === null
    && value.checkpoint === 'authorization'
  ))
  const effectiveDependencies = readSet.dependencyEvidence.filter(value => value !== attestations[0])
  const dependency = effectiveDependencies[0]
  return attestations.length === 1 && effectiveDependencies.length === 1
    && dependency?.providerKind === 'system'
    && dependency.providerId === BREEDING_READINESS_CORRECTION_PROVIDER_ID
    && dependency.subjectKind === 'pokemon-egg'
    && dependency.subjectId === egg.eggId
    && dependency.subjectRevision === egg.revision
    && dependency.checkpoint === 'incubation-operation'
    && dependency.providerDefinitionSha256 === BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256
    && dependency.effectiveEvidenceSha256 === BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256
}
const audienceTargets = (egg: PokemonEggDocumentV1) => Object.freeze([
  { audience: 'diagnostic' as const, trainerSheetSlug: null },
  { audience: 'gm' as const, trainerSheetSlug: null },
  { audience: 'owner' as const, trainerSheetSlug: egg.ownerTrainerSlug },
  { audience: 'public' as const, trainerSheetSlug: null },
])
const coordinatorFor = (options: MarkPokemonEggReadyOptions): {
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
} => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.readiness-correction-use-case.repository-mismatch', 'Coordinator and readiness use case must share one database connection.')
  }
  return Object.freeze({
    database,
    coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }),
  })
}
const requireEvidenceReplay = (input: {
  readonly database: RotomDatabase
  readonly operationId: string
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
}): void => {
  const operation = createSqliteBreedingOperationRepository(input.database).get(input.operationId)
  const evidence = createSqliteBreedingOperationEvidenceRepository(input.database).get(input.operationId)
  if (evidence && (!same(evidence.readSet, input.readSet)
    || !same(evidence.authorizationReceipt, input.receipt))) {
    fail('breeding.readiness-correction-use-case.invalid-authority', 'Operation identity is already bound to different readiness authority evidence.')
  }
  if (operation && operation.status !== 'pending' && !evidence) {
    fail('breeding.readiness-correction-use-case.invalid-authority', 'Terminal readiness operation is missing immutable authority evidence.')
  }
}
const expectedAuthorization = (input: {
  readonly command: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly readSet: BreedingOperationReadSetV1
  readonly actor: BreedingActorAuthorityV1
  readonly egg: PokemonEggDocumentV1
  readonly gmOverrides: readonly unknown[]
}): BreedingAuthorizationReceiptV1 => authorizeBreedingEggReadinessCorrectionV1({
  command: input.command,
  readSet: input.readSet,
  actorAuthority: input.actor,
  egg: input.egg,
  gmOverrides: input.gmOverrides,
  securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
})
const resultAfterExecution = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
}): MarkPokemonEggReadyResultV1 => {
  const result = input.execution.record.result
  if (!result || !result.ok) {
    return Object.freeze({ execution: input.execution, egg: null, projection: null })
  }
  const command = input.execution.record.command
  if (command.commandKind !== 'mark-egg-ready' || result.commandKind !== 'mark-egg-ready'
    || result.outcomeKind !== 'egg-ready') {
    return fail('breeding.readiness-correction-use-case.repository-mismatch', 'Accepted readiness operation has an incompatible terminal result.')
  }
  const acceptedRef = result.aggregateRefs.find(reference => (
    reference.kind === 'pokemon-egg' && reference.id === command.payload.eggId
  ))
  const egg = createSqlitePokemonEggRepository(input.database).get(command.payload.eggId)
  if (!acceptedRef || !egg) {
    return fail('breeding.readiness-correction-use-case.repository-mismatch', 'Accepted readiness operation must retain its current Egg and accepted revision.')
  }
  return Object.freeze({
    execution: input.execution,
    egg,
    projection: projectBreedingEggReadinessCorrectionV1({
      egg,
      operationId: command.operationId,
      acceptedEggRevision: acceptedRef.revision,
      reasonId: command.payload.reasonId,
      committedAtCampaignMinute: result.committedAtCampaignMinute,
    }),
  })
}

export const markPokemonEggReady = (
  input: MarkPokemonEggReadyInputV1,
  options: MarkPokemonEggReadyOptions,
): MarkPokemonEggReadyResultV1 => {
  strictObject(input, [
    'command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'gmOverrides',
  ], 'readinessCorrectionInput')
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'mark-egg-ready') {
    return fail('breeding.readiness-correction-use-case.wrong-command', 'Readiness correction accepts mark-egg-ready only.')
  }
  strictArray(input.gmOverrides, 1, 'gmOverrides')
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const commandSha256 = createBreedingOperationCommandHash(command)
  if (actor.role !== 'gm' || !receipt.authorized
    || receipt.reasonId !== 'breeding.authorization.authorized'
    || receipt.operationId !== command.operationId
    || receipt.commandSha256 !== commandSha256
    || receipt.commandKind !== 'mark-egg-ready'
    || receipt.readSetDefinitionSha256 !== readSet.definitionSha256
    || receipt.actorAuthorityDefinitionSha256 !== actor.definitionSha256
    || receipt.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
    || receipt.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256
    || !receipt.evidenceDefinitionHashes.includes(actor.definitionSha256)) {
    return fail('breeding.readiness-correction-use-case.invalid-authority', 'Readiness correction receipt must bind the exact current GM, command, read set, campaign minute, and security policy.')
  }
  const { database, coordinator } = coordinatorFor(options)
  const operationRepository = createSqliteBreedingOperationRepository(database)
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  const existing = operationRepository.get(command.operationId)
  if (existing && existing.status !== 'pending') {
    const exact = coordinator.execute({
      command,
      createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
      settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
      execute: () => fail('breeding.readiness-correction-use-case.invalid-request', 'Exact retry must not re-enter readiness mechanics.'),
    })
    return resultAfterExecution({ database, execution: exact })
  }
  const initialEgg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.readiness-correction-use-case.invalid-authority', 'Readiness correction requires the current Egg.')
  const expected = expectedAuthorization({
    command,
    readSet,
    actor,
    egg: initialEgg,
    gmOverrides: input.gmOverrides,
  })
  if (!expected.authorized || !same(expected, receipt)
    || !hasExactCorrectionDependency(readSet, initialEgg)) {
    return fail('breeding.readiness-correction-use-case.invalid-authority', 'Readiness correction requires exact current GM override and policy authority.')
  }
  const evidenceRepository = createSqliteBreedingOperationEvidenceRepository(database)
  if (existing?.status === 'pending' && !evidenceRepository.get(command.operationId)) {
    return fail('breeding.readiness-correction-use-case.invalid-authority', 'Pending readiness operation is missing immutable phase-one authority evidence.')
  }
  database.withTransaction(() => {
    operationRepository.reserve(command, readSet.capturedAtCampaignMinute)
    evidenceRepository.insert({ command, readSet, authorizationReceipt: receipt })
  })
  const shouldResume = existing === null || options.resumePending === true
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...(shouldResume ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      if (canonical.commandKind !== 'mark-egg-ready') {
        return fail('breeding.readiness-correction-use-case.wrong-command', 'Reserved operation changed command kind before readiness execution.')
      }
      const hash = createBreedingOperationCommandHash(canonical)
      const egg = context.repositories.eggs.get(canonical.payload.eggId)
      if (!egg) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.not-found',
          currentAggregateRefs: [],
          conflictingScopes: canonical.scopes,
        })
      }
      const clock = context.repositories.campaignClock.get()
      const operationEvidence = context.repositories.operationEvidence.get(canonical.operationId)
      const currentExpected = expectedAuthorization({
        command: canonical,
        readSet,
        actor,
        egg,
        gmOverrides: input.gmOverrides,
      })
      const eggResource = readResource(readSet, 'pokemon-egg', egg.eggId)
      if (!operationEvidence || !same(operationEvidence.readSet, readSet)
        || !same(operationEvidence.authorizationReceipt, receipt)
        || !clockMatches(readSet, clock)
        || eggResource?.existence !== 'present' || eggResource.revision !== egg.revision
        || eggResource.definitionSha256 !== sha256(egg)
        || !eggResource.purposes.includes('mechanics') || !eggResource.purposes.includes('conflict')
        || !same(currentExpected, receipt)
        || !hasExactCorrectionDependency(readSet, egg)) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let successor: PokemonEggDocumentV1
      try {
        successor = planBreedingEggReadinessCorrectionV1({ egg, command: canonical, campaignClock: clock })
      }
      catch (error) {
        if (!(error instanceof BreedingReadinessCorrectionAuthorityError)) throw error
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: error.code === 'breeding.readiness-correction.stale-authority'
            ? 'breeding.operation.stale-revision'
            : 'breeding.operation.unavailable',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const replacement = context.repositories.eggs.replace({
        expectedRevision: egg.revision,
        document: successor,
      })
      if (replacement.kind !== 'applied') {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: replacement.kind === 'stale'
            ? [{ kind: 'pokemon-egg', id: egg.eggId, revision: replacement.currentRevision }]
            : [],
          conflictingScopes: canonical.scopes,
        })
      }
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg',
        aggregateId: replacement.document.eggId,
        revision: replacement.document.revision,
        operationKind: canonical.commandKind,
        audienceTargets: audienceTargets(replacement.document),
        campaignProjectionKey: options.campaignProjectionKey,
        timestamp: options.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: hash,
        commandKind: canonical.commandKind,
        outcomeKind: 'egg-ready',
        aggregateRefs: [{
          kind: 'pokemon-egg',
          id: replacement.document.eggId,
          revision: replacement.document.revision,
        }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: clock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  return resultAfterExecution({ database, execution })
}
