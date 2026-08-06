import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingActorAuthorityV1,
  BreedingAuthorizationReceiptV1,
  BreedingTrainerControlEvidenceV1,
} from '#shared/breeding/authorization'
import type {
  BreedingIncubationProgressProjectionV1,
  BreedingIncubationSegmentResultV1,
} from '#shared/breeding/incubation'
import { parsePokemonEggIdSyntax } from '#shared/breeding/ids'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseBreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  authorizeBreedingEggIncubationV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
  BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
  BreedingIncubationAuthorityError,
  planBreedingIncubationAdvanceV1,
  planBreedingIncubationPauseV1,
  pokemonEggIncubationDocumentDefinitionSha256,
  projectBreedingIncubationProgressV1,
  resolveBreedingIncubationModifierContributionsV1,
  type ResolvedBreedingIncubationModifierContributionsV1,
} from '../domain/breeding/incubation'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingIncubationSegmentRepository } from '../storage/breedingIncubationSegmentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface ManagePokemonEggIncubationInputV1 {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly gmOverrides: readonly unknown[]
  readonly audience: 'gm' | 'owner'
}

export interface ManagePokemonEggIncubationOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
  readonly resolveCurrentModifierContributions?: (input: {
    readonly egg: PokemonEggDocumentV1
    readonly campaignClock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }
    readonly readSet: BreedingOperationReadSetV1
  }) => unknown
}

export interface ManagePokemonEggIncubationResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly segment: BreedingIncubationSegmentResultV1 | null
  readonly projection: BreedingIncubationProgressProjectionV1 | null
}

export interface QueryPokemonEggIncubationInputV1 {
  readonly eggId: unknown
  readonly actorAuthority: unknown
  readonly trainerControl: unknown | null
  readonly audience: 'gm' | 'owner'
}

export interface QueryPokemonEggIncubationOptions {
  readonly database?: RotomDatabase
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}

export type ManagePokemonEggIncubationErrorCode =
  | 'breeding.incubation-use-case.invalid-authority'
  | 'breeding.incubation-use-case.invalid-request'
  | 'breeding.incubation-use-case.repository-mismatch'
  | 'breeding.incubation-use-case.wrong-command'

export class ManagePokemonEggIncubationError extends Error {
  readonly code: ManagePokemonEggIncubationErrorCode

  constructor(code: ManagePokemonEggIncubationErrorCode, message: string) {
    super(message)
    this.name = 'ManagePokemonEggIncubationError'
    this.code = code
  }
}

const fail = (code: ManagePokemonEggIncubationErrorCode, message: string): never => {
  throw new ManagePokemonEggIncubationError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const same = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(left) === stableJsonStringify(right)
)
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const strictObject = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.incubation-use-case.invalid-request', `${label} must be a plain data object without symbols.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.incubation-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.incubation-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.incubation-use-case.invalid-request', `${label} must be a strict array of at most ${maximum} entries.`)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1
    || names.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) {
    return fail('breeding.incubation-use-case.invalid-request', `${label} must be a strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.incubation-use-case.invalid-request', `${label} must not be sparse or accessor-backed.`)
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
const resourceMatches = (resource: BreedingReadResourceV1 | null, input: {
  readonly revision: number
  readonly definitionSha256: string
}): boolean => resource?.existence === 'present'
  && resource.revision === input.revision
  && resource.definitionSha256 === input.definitionSha256
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
const hasExactModifierDependencies = (
  readSet: BreedingOperationReadSetV1,
  egg: PokemonEggDocumentV1,
  modifiers: ResolvedBreedingIncubationModifierContributionsV1,
): boolean => {
  const resolverAttestations = readSet.dependencyEvidence.filter(value => (
    value.providerKind === 'system'
    && value.providerId === 'breeding-effective-dependency-set-v1'
    && value.subjectKind === 'campaign'
    && value.subjectId === 'campaign'
    && value.subjectRevision === null
    && value.checkpoint === 'authorization'
  ))
  const effectiveDependencies = readSet.dependencyEvidence.filter(value => value !== resolverAttestations[0])
  const baseRate: BreedingOperationReadSetV1['dependencyEvidence'][number] = Object.freeze({
    providerKind: 'system',
    providerId: BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
    subjectKind: 'pokemon-egg',
    subjectId: egg.eggId,
    subjectRevision: egg.revision,
    checkpoint: 'incubation-operation',
    providerDefinitionSha256: BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  })
  const key = (value: BreedingOperationReadSetV1['dependencyEvidence'][number]): string => (
    `${value.providerKind}\u0000${value.providerId}\u0000${value.subjectKind}\u0000${value.subjectId}`
  )
  const expected = [baseRate, ...modifiers.dependencyEvidence].sort((left, right) => key(left).localeCompare(key(right), 'en-US'))
  const actual = [...effectiveDependencies].sort((left, right) => key(left).localeCompare(key(right), 'en-US'))
  return resolverAttestations.length === 1 && same(actual, expected)
}
const currentTrainerControlMatches = (
  database: RotomDatabase,
  control: BreedingTrainerControlEvidenceV1 | null,
): boolean => {
  if (!control) return true
  const sheet = createSqliteSheetRepository(database).get('trainer', control.trainerSheetSlug)
  return sheet?.revision === control.trainerSheetRevision
    && sha256(sheet.document) === control.trainerSheetDefinitionSha256
}
const audienceTargets = (egg: PokemonEggDocumentV1) => Object.freeze([
  { audience: 'diagnostic' as const, trainerSheetSlug: null },
  { audience: 'gm' as const, trainerSheetSlug: null },
  { audience: 'owner' as const, trainerSheetSlug: egg.ownerTrainerSlug },
  { audience: 'public' as const, trainerSheetSlug: null },
])
const coordinatorFor = (options: ManagePokemonEggIncubationOptions): {
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
} => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.incubation-use-case.repository-mismatch', 'Coordinator and incubation use case must share one database connection.')
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
    fail('breeding.incubation-use-case.invalid-authority', 'Operation identity is already bound to different incubation authority evidence.')
  }
  if (operation && operation.status !== 'pending' && !evidence) {
    fail('breeding.incubation-use-case.invalid-authority', 'Terminal incubation operation is missing immutable authority evidence.')
  }
}
const expectedAuthorization = (input: {
  readonly command: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly readSet: BreedingOperationReadSetV1
  readonly actor: BreedingActorAuthorityV1
  readonly control: BreedingTrainerControlEvidenceV1 | null
  readonly egg: PokemonEggDocumentV1
  readonly gmOverrides: readonly unknown[]
}): BreedingAuthorizationReceiptV1 => authorizeBreedingEggIncubationV1({
  command: input.command,
  readSet: input.readSet,
  actorAuthority: input.actor,
  trainerControl: input.control,
  egg: input.egg,
  gmOverrides: input.gmOverrides,
  securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
})
const resultAfterExecution = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly eggId: string
  readonly operationId: string
  readonly audience: 'gm' | 'owner'
}): ManagePokemonEggIncubationResultV1 => {
  const egg = createSqlitePokemonEggRepository(input.database).get(input.eggId)
  const segment = createSqliteBreedingIncubationSegmentRepository(input.database).get(input.operationId)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  return Object.freeze({
    execution: input.execution,
    egg,
    segment,
    projection: egg
      ? projectBreedingIncubationProgressV1({
          egg,
          audience: input.audience,
          generatedAtCampaignMinute: clock.campaignMinute,
        })
      : null,
  })
}

export const managePokemonEggIncubation = (
  input: ManagePokemonEggIncubationInputV1,
  options: ManagePokemonEggIncubationOptions,
): ManagePokemonEggIncubationResultV1 => {
  strictObject(input, [
    'command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'trainerControl', 'gmOverrides', 'audience',
  ], 'incubationInput')
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'advance-egg-incubation' && command.commandKind !== 'set-egg-incubation-pause') {
    return fail('breeding.incubation-use-case.wrong-command', 'Incubation use case accepts only progress and pause commands.')
  }
  if (input.audience !== 'gm' && input.audience !== 'owner') {
    return fail('breeding.incubation-use-case.invalid-request', 'Incubation response audience must be owner or GM.')
  }
  strictArray(input.gmOverrides, 1, 'gmOverrides')
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = input.trainerControl === null
    ? null
    : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  if ((actor.role === 'gm') !== (input.audience === 'gm')) {
    return fail('breeding.incubation-use-case.invalid-authority', 'Response audience must match the authenticated actor role.')
  }
  const commandSha256 = createBreedingOperationCommandHash(command)
  const staticReceiptMatches = receipt.authorized
    && receipt.reasonId === 'breeding.authorization.authorized'
    && receipt.operationId === command.operationId
    && receipt.commandSha256 === commandSha256
    && receipt.commandKind === command.commandKind
    && receipt.readSetDefinitionSha256 === readSet.definitionSha256
    && receipt.actorAuthorityDefinitionSha256 === actor.definitionSha256
    && receipt.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
    && receipt.securityPolicyDefinitionSha256 === securityPolicyJson.definitionSha256
    && (control === null || receipt.evidenceDefinitionHashes.includes(control.definitionSha256))
  if (!staticReceiptMatches) {
    return fail('breeding.incubation-use-case.invalid-authority', 'Incubation receipt must bind the exact command, actor, read set, campaign minute, and security policy.')
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
      execute: () => fail('breeding.incubation-use-case.invalid-request', 'Exact retry must not re-enter incubation mechanics.'),
    })
    return resultAfterExecution({
      database,
      execution: exact,
      eggId: command.payload.eggId,
      operationId: command.operationId,
      audience: input.audience,
    })
  }
  const initialEgg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.incubation-use-case.invalid-authority', 'Incubation authority requires the current Egg.')
  const expected = expectedAuthorization({
    command,
    readSet,
    actor,
    control,
    egg: initialEgg,
    gmOverrides: input.gmOverrides,
  })
  const initialClock = createSqliteCampaignClockRepository(database).get()
  let initialModifierValue: unknown = []
  if (options.resolveCurrentModifierContributions) {
    initialModifierValue = options.resolveCurrentModifierContributions({ egg: initialEgg, campaignClock: initialClock, readSet })
    if (promiseLike(initialModifierValue)) return fail('breeding.incubation-use-case.invalid-request', 'Modifier resolution must be synchronous and server-owned.')
  }
  let initialModifiers: ResolvedBreedingIncubationModifierContributionsV1
  try {
    initialModifiers = resolveBreedingIncubationModifierContributionsV1({ egg: initialEgg, contributions: initialModifierValue })
  }
  catch (error) {
    if (!(error instanceof BreedingIncubationAuthorityError)) throw error
    // Preserve a durable rejected operation for unavailable current providers;
    // no unverified contribution is ever treated as authority or applied.
    initialModifiers = resolveBreedingIncubationModifierContributionsV1({ egg: initialEgg, contributions: [] })
  }
  if (!expected.authorized || !same(expected, receipt) || !hasExactModifierDependencies(readSet, initialEgg, initialModifiers)
    || !currentTrainerControlMatches(database, control)) {
    return fail('breeding.incubation-use-case.invalid-authority', 'Incubation requires exact current owner or GM authority and the complete current modifier checkpoint.')
  }
  const evidenceRepository = createSqliteBreedingOperationEvidenceRepository(database)
  if (existing?.status === 'pending' && !evidenceRepository.get(command.operationId)) {
    return fail('breeding.incubation-use-case.invalid-authority', 'Pending incubation operation is missing its immutable phase-one authority evidence.')
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
      if (canonical.commandKind !== 'advance-egg-incubation'
        && canonical.commandKind !== 'set-egg-incubation-pause') {
        return fail('breeding.incubation-use-case.wrong-command', 'Reserved operation changed command kind before incubation execution.')
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
        control,
        egg,
        gmOverrides: input.gmOverrides,
      })
      const eggResource = readResource(readSet, 'pokemon-egg', egg.eggId)
      if (!operationEvidence || !same(operationEvidence.readSet, readSet)
        || !same(operationEvidence.authorizationReceipt, receipt)
        || !clockMatches(readSet, clock)
        || !resourceMatches(eggResource, {
          revision: egg.revision,
          definitionSha256: pokemonEggIncubationDocumentDefinitionSha256(egg),
        })
        || !same(currentExpected, receipt)
        || !currentTrainerControlMatches(database, control)) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let modifierValue: unknown = []
      if (options.resolveCurrentModifierContributions) {
        modifierValue = options.resolveCurrentModifierContributions({ egg, campaignClock: clock, readSet })
        if (promiseLike(modifierValue)) {
          return fail('breeding.incubation-use-case.invalid-request', 'Modifier resolution must be synchronous and server-owned.')
        }
      }
      let planned
      try {
        const modifierContributions = resolveBreedingIncubationModifierContributionsV1({ egg, contributions: modifierValue })
        if (!hasExactModifierDependencies(readSet, egg, modifierContributions)
          || !same(modifierContributions.dependencyEvidence, initialModifiers.dependencyEvidence)) {
          throw new BreedingIncubationAuthorityError('breeding.incubation.stale-authority', 'modifierContributions', 'Current modifiers changed after authorization.')
        }
        planned = canonical.commandKind === 'advance-egg-incubation'
          ? planBreedingIncubationAdvanceV1({ egg, command: canonical, campaignClock: clock, modifierContributions: modifierValue })
          : planBreedingIncubationPauseV1({ egg, command: canonical, campaignClock: clock, modifierContributions: modifierValue })
      }
      catch (error) {
        if (!(error instanceof BreedingIncubationAuthorityError)) throw error
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: error.code === 'breeding.incubation.stale-authority'
            ? 'breeding.operation.stale-revision'
            : 'breeding.operation.unavailable',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const replacement = context.repositories.eggs.replace({
        expectedRevision: egg.revision,
        document: planned.egg,
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
      context.repositories.incubationSegments.insert({ command: canonical, segment: planned.segment })
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
        outcomeKind: canonical.commandKind === 'advance-egg-incubation' ? 'egg-progressed' : 'egg-pause-set',
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
  return resultAfterExecution({
    database,
    execution,
    eggId: command.payload.eggId,
    operationId: command.operationId,
    audience: input.audience,
  })
}

const denyIncubationQuery = (): never => fail(
  'breeding.incubation-use-case.invalid-authority',
  'Incubation query is unavailable for this viewer.',
)

export const queryPokemonEggIncubation = (
  input: QueryPokemonEggIncubationInputV1,
  options: QueryPokemonEggIncubationOptions = {},
): BreedingIncubationProgressProjectionV1 => {
  strictObject(input, ['eggId', 'actorAuthority', 'trainerControl', 'audience'], 'incubationQuery')
  const eggId = parsePokemonEggIdSyntax(input.eggId)
    ?? fail('breeding.incubation-use-case.invalid-request', 'incubationQuery.eggId must be a Pokémon Egg ID.')
  if (input.audience !== 'gm' && input.audience !== 'owner') {
    return fail('breeding.incubation-use-case.invalid-request', 'Incubation query audience must be owner or GM.')
  }
  const database = options.database ?? getRotomDatabase()
  const clock = createSqliteCampaignClockRepository(database).get()
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = input.trainerControl === null
    ? null
    : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const egg = createSqlitePokemonEggRepository(database).get(eggId)
    ?? denyIncubationQuery()
  if (actor.evaluatedAtCampaignMinute !== clock.campaignMinute
    || (actor.role === 'gm') !== (input.audience === 'gm')) {
    return denyIncubationQuery()
  }
  if (actor.role === 'gm') {
    if (input.trainerControl !== null || !options.validateCurrentGmAuthority) {
      return denyIncubationQuery()
    }
    let authorized: unknown
    try {
      authorized = options.validateCurrentGmAuthority(actor)
    }
    catch {
      return denyIncubationQuery()
    }
    if (promiseLike(authorized) || authorized !== true) {
      return denyIncubationQuery()
    }
  }
  else {
    if (!control || actor.authenticatedProfileId !== control.profileId
      || actor.profileDefinitionSha256 !== control.profileDefinitionSha256
      || actor.selectedTrainerSlug !== egg.ownerTrainerSlug
      || control.trainerSheetSlug !== egg.ownerTrainerSlug
      || control.evaluatedAtCampaignMinute !== clock.campaignMinute
      || !currentTrainerControlMatches(database, control)) {
      return denyIncubationQuery()
    }
  }
  return projectBreedingIncubationProgressV1({
    egg,
    audience: input.audience,
    generatedAtCampaignMinute: clock.campaignMinute,
  })
}
