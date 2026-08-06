import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingActorAuthorityV1,
  BreedingAuthorizationReceiptV1,
  BreedingTrainerControlEvidenceV1,
} from '#shared/breeding/authorization'
import type { PokemonEggTransferProjectionV1 } from '#shared/breeding/eggTransfer'
import { parseBreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
  authorizePokemonEggTransferV1,
  pokemonEggTransferConsentDefinitionSha256,
  pokemonEggTransferEffectiveEvidenceSha256,
  projectPokemonEggTransferV1,
  resolvePokemonEggTransferAgreementV1,
  settlePokemonEggTransferConsentV1,
} from '../domain/breeding/eggTransfer'
import {
  PokemonEggLifecyclePolicyError,
  planPokemonEggOwnershipTransferV1,
} from '../domain/breeding/eggLifecyclePolicy'
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
import { createSqlitePokemonEggTransferConsentRepository } from '../storage/pokemonEggTransferConsentRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface TransferPokemonEggOwnershipInputV1 {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly actorAuthority: unknown
  readonly audience: 'source-owner' | 'recipient'
}

export interface TransferPokemonEggOwnershipOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
  readonly resolveCurrentTrainerControl: (input: {
    readonly trainerSlug: string
    readonly campaignMinute: number
  }) => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}

export interface TransferPokemonEggOwnershipResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly projection: PokemonEggTransferProjectionV1 | null
}

export type TransferPokemonEggOwnershipErrorCode =
  | 'breeding.egg-transfer-use-case.invalid-request'
  | 'breeding.egg-transfer-use-case.invalid-authority'
  | 'breeding.egg-transfer-use-case.repository-mismatch'
  | 'breeding.egg-transfer-use-case.wrong-command'

export class TransferPokemonEggOwnershipError extends Error {
  readonly code: TransferPokemonEggOwnershipErrorCode

  constructor(code: TransferPokemonEggOwnershipErrorCode, message: string) {
    super(message)
    this.name = 'TransferPokemonEggOwnershipError'
    this.code = code
  }
}

const fail = (code: TransferPokemonEggOwnershipErrorCode, message: string): never => {
  throw new TransferPokemonEggOwnershipError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
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
    return fail('breeding.egg-transfer-use-case.invalid-request', `${label} must be one plain data object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.egg-transfer-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.egg-transfer-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
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
  return resource?.existence === 'present'
    && resource.revision === clock.revision
    && resource.observedCampaignMinute === clock.campaignMinute
    && resource.definitionSha256 === clockDefinition(clock)
    && resource.purposes.includes('campaign-time')
    && readSet.capturedAtCampaignMinute === clock.campaignMinute
}
const trainerFactFromSheet = (sheet: {
  readonly slug: string
  readonly revision: number
  readonly document: unknown
} | null): {
  readonly slug: string
  readonly revision: number
  readonly definitionSha256: string
} | null => sheet ? Object.freeze({
  slug: sheet.slug,
  revision: sheet.revision,
  definitionSha256: sha256(sheet.document),
}) : null
const currentTrainerFact = (database: RotomDatabase, slug: string) => trainerFactFromSheet(
  createSqliteSheetRepository(database).get('trainer', slug),
)
const resolveControl = (
  options: TransferPokemonEggOwnershipOptions,
  trainerSlug: string,
  campaignMinute: number,
): BreedingTrainerControlEvidenceV1 => {
  let result: unknown
  try {
    result = options.resolveCurrentTrainerControl({ trainerSlug, campaignMinute })
  }
  catch {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Current Trainer-control resolution failed closed.')
  }
  if (promiseLike(result)) {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Current Trainer-control resolution must be synchronous.')
  }
  return parseAuthoritativeBreedingTrainerControlEvidenceV1(result, `currentTrainerControl.${trainerSlug}`)
}
const verifyGm = (
  options: TransferPokemonEggOwnershipOptions,
  actor: BreedingActorAuthorityV1,
): boolean => {
  if (actor.role !== 'gm') return false
  let result: unknown
  try {
    result = options.validateCurrentGmAuthority?.(actor) ?? false
  }
  catch {
    return false
  }
  return !promiseLike(result) && result === true
}
const controlMatches = (
  control: BreedingTrainerControlEvidenceV1,
  fact: NonNullable<ReturnType<typeof currentTrainerFact>>,
  campaignMinute: number,
): boolean => control.trainerSheetSlug === fact.slug
  && control.trainerSheetRevision === fact.revision
  && control.trainerSheetDefinitionSha256 === fact.definitionSha256
  && control.evaluatedAtCampaignMinute === campaignMinute
const dependencyMatches = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly egg: Parameters<typeof pokemonEggTransferEffectiveEvidenceSha256>[0]['egg']
  readonly agreement: Parameters<typeof pokemonEggTransferEffectiveEvidenceSha256>[0]['agreement']
  readonly sourceControl: BreedingTrainerControlEvidenceV1
  readonly destinationControl: BreedingTrainerControlEvidenceV1
}): boolean => {
  const effective = input.readSet.dependencyEvidence.filter(value => value.providerId !== 'breeding-effective-dependency-set-v1')
  const attestations = input.readSet.dependencyEvidence.filter(value => value.providerId === 'breeding-effective-dependency-set-v1')
  const dependency = effective[0]
  return attestations.length === 1 && effective.length === 1
    && dependency?.providerKind === 'system'
    && dependency.providerId === 'breeding.egg-transfer-policy-v1'
    && dependency.subjectKind === 'pokemon-egg'
    && dependency.subjectId === input.egg.eggId
    && dependency.subjectRevision === input.egg.revision
    && dependency.checkpoint === 'authorization'
    && dependency.providerDefinitionSha256 === POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256
    && dependency.effectiveEvidenceSha256 === pokemonEggTransferEffectiveEvidenceSha256(input)
    && attestations[0]?.providerKind === 'system'
    && attestations[0].subjectKind === 'campaign'
    && attestations[0].subjectId === 'campaign'
    && attestations[0].subjectRevision === null
    && attestations[0].checkpoint === 'authorization'
    && attestations[0].effectiveEvidenceSha256 === sha256(effective)
}
const coordinatorFor = (options: TransferPokemonEggOwnershipOptions): {
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
} => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.egg-transfer-use-case.repository-mismatch', 'Coordinator and transfer use case must share one database connection.')
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
    fail('breeding.egg-transfer-use-case.invalid-authority', 'Operation identity is already bound to different transfer authority evidence.')
  }
  if (operation && operation.status !== 'pending' && !evidence) {
    fail('breeding.egg-transfer-use-case.invalid-authority', 'Terminal transfer operation is missing immutable authority evidence.')
  }
}
const resultAfterExecution = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly audience: 'source-owner' | 'recipient'
}): TransferPokemonEggOwnershipResultV1 => {
  const result = input.execution.record.result
  if (!result || !result.ok) return Object.freeze({ execution: input.execution, projection: null })
  const command = input.execution.record.command
  if (command.commandKind !== 'transfer-egg' || result.commandKind !== 'transfer-egg'
    || result.outcomeKind !== 'egg-transferred') {
    return fail('breeding.egg-transfer-use-case.repository-mismatch', 'Accepted transfer operation has an incompatible result.')
  }
  const repository = createSqlitePokemonEggTransferConsentRepository(input.database)
  const consents = command.payload.consentEvidenceIds.map(id => repository.get(id))
  const source = consents.find(value => value?.role === 'source-gift')
  const recipient = consents.find(value => value?.role === 'recipient-acceptance')
  if (!source || !recipient || source.status !== 'consumed' || recipient.status !== 'consumed') {
    return fail('breeding.egg-transfer-use-case.repository-mismatch', 'Accepted transfer must retain both consumed consent records.')
  }
  return Object.freeze({
    execution: input.execution,
    projection: projectPokemonEggTransferV1({
      sourceConsent: source,
      recipientConsent: recipient,
      audience: input.audience,
      generatedAtCampaignMinute: result.committedAtCampaignMinute,
    }),
  })
}

export const transferPokemonEggOwnership = (
  input: TransferPokemonEggOwnershipInputV1,
  options: TransferPokemonEggOwnershipOptions,
): TransferPokemonEggOwnershipResultV1 => {
  strictObject(input, [
    'command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'audience',
  ], 'transferPokemonEggOwnershipInput')
  if (input.audience !== 'source-owner' && input.audience !== 'recipient') {
    return fail('breeding.egg-transfer-use-case.invalid-request', 'audience must be source-owner or recipient.')
  }
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'transfer-egg') {
    return fail('breeding.egg-transfer-use-case.wrong-command', 'Egg ownership transfer accepts transfer-egg only.')
  }
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const commandHash = createBreedingOperationCommandHash(command)
  if (!receipt.authorized || receipt.reasonId !== 'breeding.authorization.authorized'
    || receipt.operationId !== command.operationId || receipt.commandSha256 !== commandHash
    || receipt.commandKind !== command.commandKind
    || receipt.readSetDefinitionSha256 !== readSet.definitionSha256
    || receipt.actorAuthorityDefinitionSha256 !== actor.definitionSha256
    || receipt.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
    || receipt.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256
    || receipt.gmOverrideIds.length !== 0) {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Transfer receipt must bind the exact current command, actor, read set, campaign minute, and security policy without an override.')
  }
  const { database, coordinator } = coordinatorFor(options)
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  const operationRepository = createSqliteBreedingOperationRepository(database)
  const existing = operationRepository.get(command.operationId)
  if (existing && existing.status !== 'pending') {
    const exact = coordinator.execute({
      command,
      createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
      settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
      execute: () => fail('breeding.egg-transfer-use-case.invalid-request', 'Exact retry must not re-enter transfer mechanics.'),
    })
    return resultAfterExecution({ database, execution: exact, audience: input.audience })
  }
  const transferConsentRepository = coordinator.database === database
    ? createSqlitePokemonEggTransferConsentRepository(database)
    : fail('breeding.egg-transfer-use-case.repository-mismatch', 'Transfer database changed unexpectedly.')
  const currentEgg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.egg-transfer-use-case.invalid-authority', 'Transfer requires the current Egg.')
  const consents = command.payload.consentEvidenceIds.map(id => transferConsentRepository.get(id))
  if (consents.some(value => value === null)) {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Transfer requires both current durable consent records.')
  }
  const agreement = resolvePokemonEggTransferAgreementV1({
    egg: currentEgg,
    destinationTrainerSlug: command.payload.destinationTrainerSlug,
    consents,
    atCampaignMinute: readSet.capturedAtCampaignMinute,
  })
  const sourceFact = currentTrainerFact(database, currentEgg.ownerTrainerSlug)
  const destinationFact = currentTrainerFact(database, command.payload.destinationTrainerSlug)
  if (!sourceFact || !destinationFact) {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Both current Trainer documents are required.')
  }
  const sourceControl = resolveControl(options, sourceFact.slug, readSet.capturedAtCampaignMinute)
  const destinationControl = resolveControl(options, destinationFact.slug, readSet.capturedAtCampaignMinute)
  const gmVerified = verifyGm(options, actor)
  const expectedReceipt = authorizePokemonEggTransferV1({
    command,
    readSet,
    actorAuthority: actor,
    egg: currentEgg,
    agreement,
    sourceControl,
    destinationControl,
    gmAuthorityVerified: gmVerified,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!expectedReceipt.authorized || !same(expectedReceipt, receipt)
    || !controlMatches(sourceControl, sourceFact, readSet.capturedAtCampaignMinute)
    || !controlMatches(destinationControl, destinationFact, readSet.capturedAtCampaignMinute)
    || !dependencyMatches({ readSet, egg: currentEgg, agreement, sourceControl, destinationControl })) {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Transfer requires exact current owner, recipient, consent, Profile-control, dependency, clock, and read-set authority.')
  }
  const evidenceRepository = createSqliteBreedingOperationEvidenceRepository(database)
  if (existing?.status === 'pending' && !evidenceRepository.get(command.operationId)) {
    return fail('breeding.egg-transfer-use-case.invalid-authority', 'Pending transfer operation is missing immutable phase-one authority evidence.')
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
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
    execute: (canonical, _operation, context) => {
      if (canonical.commandKind !== 'transfer-egg') {
        return fail('breeding.egg-transfer-use-case.wrong-command', 'Reserved operation changed command kind before transfer execution.')
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
      const currentConsents = canonical.payload.consentEvidenceIds.map(id => context.repositories.transferConsents.get(id))
      const currentSourceFact = trainerFactFromSheet(
        context.repositories.sheets.get('trainer', egg.ownerTrainerSlug),
      )
      const currentDestinationFact = trainerFactFromSheet(
        context.repositories.sheets.get('trainer', canonical.payload.destinationTrainerSlug),
      )
      let currentAgreement: ReturnType<typeof resolvePokemonEggTransferAgreementV1>
      let currentSourceControl: BreedingTrainerControlEvidenceV1
      let currentDestinationControl: BreedingTrainerControlEvidenceV1
      try {
        if (currentConsents.some(value => value === null) || !currentSourceFact || !currentDestinationFact) throw new Error('missing')
        currentAgreement = resolvePokemonEggTransferAgreementV1({
          egg,
          destinationTrainerSlug: canonical.payload.destinationTrainerSlug,
          consents: currentConsents,
          atCampaignMinute: clock.campaignMinute,
        })
        currentSourceControl = resolveControl(options, currentSourceFact.slug, clock.campaignMinute)
        currentDestinationControl = resolveControl(options, currentDestinationFact.slug, clock.campaignMinute)
      }
      catch {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const currentExpected = authorizePokemonEggTransferV1({
        command: canonical,
        readSet,
        actorAuthority: actor,
        egg,
        agreement: currentAgreement,
        sourceControl: currentSourceControl,
        destinationControl: currentDestinationControl,
        gmAuthorityVerified: verifyGm(options, actor),
        securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
      })
      const eggResource = readResource(readSet, 'pokemon-egg', egg.eggId)
      const sourceResource = readResource(readSet, 'trainer-sheet', egg.ownerTrainerSlug)
      const destinationResource = readResource(readSet, 'trainer-sheet', canonical.payload.destinationTrainerSlug)
      const consentResourcesMatch = [currentAgreement.sourceConsent, currentAgreement.recipientConsent].every(consent => {
        const resource = readResource(readSet, 'egg-transfer-consent', consent.consentId)
        return resource?.existence === 'present' && resource.revision === consent.revision
          && resource.definitionSha256 === pokemonEggTransferConsentDefinitionSha256(consent)
          && resource.purposes.includes('consent') && resource.purposes.includes('conflict')
      })
      const currentEvidence = context.repositories.operationEvidence.get(canonical.operationId)
      if (!currentEvidence || !same(currentEvidence.readSet, readSet)
        || !same(currentEvidence.authorizationReceipt, receipt)
        || !same(currentExpected, receipt) || !clockMatches(readSet, clock)
        || eggResource?.existence !== 'present' || eggResource.revision !== egg.revision
        || eggResource.definitionSha256 !== sha256(egg)
        || !eggResource.purposes.includes('mechanics') || !eggResource.purposes.includes('conflict')
        || !controlMatches(currentSourceControl, currentSourceFact, clock.campaignMinute)
        || !controlMatches(currentDestinationControl, currentDestinationFact, clock.campaignMinute)
        || sourceResource?.existence !== 'present' || sourceResource.revision !== currentSourceFact.revision
        || sourceResource.definitionSha256 !== currentSourceFact.definitionSha256
        || !sourceResource.purposes.includes('authorization')
        || destinationResource?.existence !== 'present' || destinationResource.revision !== currentDestinationFact.revision
        || destinationResource.definitionSha256 !== currentDestinationFact.definitionSha256
        || !destinationResource.purposes.includes('authorization')
        || !destinationResource.purposes.includes('write-destination')
        || !consentResourcesMatch
        || !dependencyMatches({
          readSet,
          egg,
          agreement: currentAgreement,
          sourceControl: currentSourceControl,
          destinationControl: currentDestinationControl,
        })) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let successor
      try {
        successor = planPokemonEggOwnershipTransferV1({
          egg,
          command: canonical,
          atCampaignMinute: clock.campaignMinute,
        })
      }
      catch (error) {
        if (!(error instanceof PokemonEggLifecyclePolicyError)) throw error
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId,
          commandHash: hash,
          commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.unavailable',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: egg.eggId, revision: egg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const sourceSettled = settlePokemonEggTransferConsentV1({
        consent: currentAgreement.sourceConsent,
        status: 'consumed',
        operationId: canonical.operationId,
        settledAtCampaignMinute: clock.campaignMinute,
      })
      const recipientSettled = settlePokemonEggTransferConsentV1({
        consent: currentAgreement.recipientConsent,
        status: 'consumed',
        operationId: canonical.operationId,
        settledAtCampaignMinute: clock.campaignMinute,
      })
      const sourceReplace = context.repositories.transferConsents.replace({
        expectedRevision: currentAgreement.sourceConsent.revision,
        consent: sourceSettled,
      })
      const recipientReplace = context.repositories.transferConsents.replace({
        expectedRevision: currentAgreement.recipientConsent.revision,
        consent: recipientSettled,
      })
      const eggReplace = context.repositories.eggs.replace({ expectedRevision: egg.revision, document: successor })
      if (sourceReplace.kind !== 'applied' || recipientReplace.kind !== 'applied' || eggReplace.kind !== 'applied') {
        return fail('breeding.egg-transfer-use-case.repository-mismatch', 'Atomic transfer compare-and-swap failed after current authority validation.')
      }
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg',
        aggregateId: eggReplace.document.eggId,
        revision: eggReplace.document.revision,
        operationKind: canonical.commandKind,
        audienceTargets: [
          { audience: 'diagnostic', trainerSheetSlug: null },
          { audience: 'gm', trainerSheetSlug: null },
          { audience: 'owner', trainerSheetSlug: egg.ownerTrainerSlug },
          { audience: 'owner', trainerSheetSlug: eggReplace.document.ownerTrainerSlug },
          { audience: 'public', trainerSheetSlug: null },
        ],
        campaignProjectionKey: options.campaignProjectionKey,
        timestamp: options.realtimeTimestamp,
      }))
      const consentRefs = [sourceReplace.document, recipientReplace.document]
        .sort((left, right) => left.consentId < right.consentId ? -1 : left.consentId > right.consentId ? 1 : 0)
        .map(consent => ({ kind: 'egg-transfer-consent' as const, id: consent.consentId, revision: consent.revision }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: hash,
        commandKind: canonical.commandKind,
        outcomeKind: 'egg-transferred',
        aggregateRefs: [...consentRefs, {
          kind: 'pokemon-egg', id: eggReplace.document.eggId, revision: eggReplace.document.revision,
        }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: clock.campaignMinute,
      })
    },
  })
  return resultAfterExecution({ database, execution, audience: input.audience })
}
