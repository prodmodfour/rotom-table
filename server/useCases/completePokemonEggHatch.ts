import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import initializedSheetContractJson from '../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import type { PokemonEggHatchCompletionAudienceV1, PokemonEggHatchCompletionProjectionV1 } from '#shared/breeding/hatchCompletion'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { parseCapabilityCampaignState, type CapabilityMarsupialPouchState } from '#shared/capabilityAutomation/campaignState'
import type { EffectiveCapabilitySet } from '#shared/capabilityAutomation/effective'
import type { CharacterSheet } from '~/types/characterSheet'
import { pokemonHasActiveBabyTemplate } from '~/utils/sheets/pokemonDerived'
import type { PersistedSheet, StoredSheetDocument } from '../storage/sheetRepository'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  assertPokemonEggChildSheetConstructionExactReplayV1,
  planPokemonEggChildSheetConstructionV1,
  type PokemonEggChildSheetConstructionPlanV1,
} from '../domain/breeding/childSheetConstruction'
import {
  authorizeBreedingCompleteHatchV1,
  planPokemonEggHatchSettlementV1,
  projectPokemonEggHatchCompletionV1,
} from '../domain/breeding/hatchCompletion'
import { createPokemonEggHatchOwnerTrainerFactV1 } from '../domain/breeding/hatchOffers'
import { validatePokemonHatchSpeciesAcquisitionSettlementV1 } from '../domain/breeding/hatchSpeciesAcquisition'
import { createPokemonBreedingOriginFromHatchedEgg } from '../domain/breeding/lineage'
import {
  createBreedingMarsupialHandoffV1,
  createBreedingParentalBondHandoffV1,
} from '../domain/breeding/modifierProviderHandoff'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from '../domain/breeding/eggLifecyclePolicy'
import { resolveMarsupialRelationship } from '../domain/capabilityAutomation/marsupialRelationship'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import {
  parseAuthoritativeBreedingReferenceVersionSnapshotV1,
  validateBreedingOperationReadSetCompleteness,
} from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  sheetDocumentUpdatedRealtimeAppendInput,
} from '../realtime/sheetDocumentRealtime'
import { createSqliteBreedingLineageRepository } from '../storage/breedingLineageRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../storage/trainerSpeciesAcquisitionRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface CompletePokemonEggHatchResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly childSheet: PersistedSheet | null
  readonly ownerTrainerSheet: PersistedSheet | null
  readonly childPlan: PokemonEggChildSheetConstructionPlanV1 | null
  readonly projection: PokemonEggHatchCompletionProjectionV1 | null
}
export interface CompletePokemonEggHatchOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly sheetUpdatedAt: number
  readonly resolveCurrentReferenceVersions: () => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
  readonly resolveEffectiveCapabilities?: (input: { readonly sourcePokemonSheetSlug: string, readonly sourcePokemonSheet: CharacterSheet }) => EffectiveCapabilitySet
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type CompletePokemonEggHatchErrorCode =
  | 'breeding.hatch-completion-use-case.invalid-request'
  | 'breeding.hatch-completion-use-case.invalid-authority'
  | 'breeding.hatch-completion-use-case.repository-mismatch'
  | 'breeding.hatch-completion-use-case.stale-authority'
  | 'breeding.hatch-completion-use-case.unavailable'
  | 'breeding.hatch-completion-use-case.wrong-command'
export class CompletePokemonEggHatchError extends Error {
  readonly code: CompletePokemonEggHatchErrorCode
  constructor(code: CompletePokemonEggHatchErrorCode, message: string) {
    super(message); this.name = 'CompletePokemonEggHatchError'; this.code = code
  }
}
const fail = (code: CompletePokemonEggHatchErrorCode, message: string): never => { throw new CompletePokemonEggHatchError(code, message) }
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function'
const strict = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.hatch-completion-use-case.invalid-request', `${label} must be one plain exact object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.hatch-completion-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.hatch-completion-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
  }
  return row
}
const integer = (value: unknown, label: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail('breeding.hatch-completion-use-case.invalid-request', `${label} must be a safe nonnegative integer.`)
const currentReferences = (value: unknown, options: CompletePokemonEggHatchOptions) => {
  if (typeof options.resolveCurrentReferenceVersions !== 'function') return fail('breeding.hatch-completion-use-case.invalid-request', 'A synchronous server-owned reference resolver is required.')
  let resolved: unknown
  try { resolved = options.resolveCurrentReferenceVersions() }
  catch { return fail('breeding.hatch-completion-use-case.stale-authority', 'Current reference resolution failed closed.') }
  if (promiseLike(resolved)) return fail('breeding.hatch-completion-use-case.stale-authority', 'Current reference resolution must be synchronous.')
  const supplied = parseAuthoritativeBreedingReferenceVersionSnapshotV1(value)
  const current = parseAuthoritativeBreedingReferenceVersionSnapshotV1(resolved)
  if (!same(supplied, current)) return fail('breeding.hatch-completion-use-case.stale-authority', 'Supplied references must exactly match the current app-owned snapshot.')
  return supplied
}
const verifyGm = (actor: BreedingActorAuthorityV1, options: CompletePokemonEggHatchOptions): void => {
  if (actor.role !== 'gm' || typeof options.validateCurrentGmAuthority !== 'function') return fail('breeding.hatch-completion-use-case.invalid-authority', 'Current authenticated GM campaign authority is required.')
  let verified: unknown
  try { verified = options.validateCurrentGmAuthority(actor) }
  catch { return fail('breeding.hatch-completion-use-case.invalid-authority', 'Current GM authority verifier failed closed.') }
  if (promiseLike(verified) || verified !== true) return fail('breeding.hatch-completion-use-case.invalid-authority', 'GM authority verifier must synchronously return exact true.')
}
const exactReceipt = (submittedValue: unknown, expected: BreedingAuthorizationReceiptV1): BreedingAuthorizationReceiptV1 => {
  const submitted = parseAuthoritativeBreedingAuthorizationReceiptV1(submittedValue)
  if (!same(submitted, expected) || !submitted.authorized || submitted.reasonId !== 'breeding.authorization.authorized') return fail('breeding.hatch-completion-use-case.invalid-authority', 'Authorization receipt must exactly equal current server-rebuilt hatch-completion authority.')
  return submitted
}
const resource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string) => readSet.resources.find(entry => entry.resourceKind === kind && entry.resourceId === id) ?? null
const assertPlainData = (value: unknown, path: string, seen = new Set<object>()): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('breeding.hatch-completion-use-case.invalid-request', `${path} must contain finite JSON numbers.`); return }
  if (typeof value !== 'object' || seen.has(value)) return fail('breeding.hatch-completion-use-case.invalid-request', `${path} must contain acyclic plain JSON data.`)
  if (Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.hatch-completion-use-case.invalid-request', `${path} cannot contain symbol fields.`)
  seen.add(value)
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.hatch-completion-use-case.invalid-request', `${path} must be one dense plain array.`)
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.hatch-completion-use-case.invalid-request', `${path}[${index}] must be an enumerable data entry.`)
      assertPlainData(descriptor.value, `${path}[${index}]`, seen)
    }
  }
  else {
    if (prototype !== Object.prototype && prototype !== null) return fail('breeding.hatch-completion-use-case.invalid-request', `${path} must contain only plain objects.`)
    for (const field of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.hatch-completion-use-case.invalid-request', `${path}.${field} must be an enumerable data field.`)
      assertPlainData(descriptor.value, `${path}.${field}`, seen)
    }
  }
  seen.delete(value)
}
const submittedPlanHash = (value: unknown, command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'complete-hatch' }>): string => {
  assertPlainData(value, 'childPlan')
  const row = strict(value, ['schemaVersion', 'eggId', 'sourceEggRevision', 'operationId', 'originId', 'ownerTrainerSlug', 'destination', 'baseSlug', 'folder', 'document', 'documentDefinitionSha256', 'sourceDefinitionHashes', 'definitionSha256'], 'childPlan')
  if (typeof row.definitionSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(row.definitionSha256)) return fail('breeding.hatch-completion-use-case.invalid-request', 'Child plan must carry a lowercase definition hash.')
  const { definitionSha256: _hash, ...definition } = row
  if (sha256(definition) !== row.definitionSha256 || row.operationId !== command.operationId || row.eggId !== command.payload.eggId
    || row.originId !== command.payload.originId || !same(row.destination, command.payload.destination)) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Child plan must be the exact self-hashed plan for this complete-hatch command.')
  return row.definitionSha256
}
const coordinatorFor = (options: CompletePokemonEggHatchOptions) => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) return fail('breeding.hatch-completion-use-case.repository-mismatch', 'Coordinator and hatch-completion use case must share one database connection.')
  return Object.freeze({ database, coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }) })
}
const exactEvidence = (database: RotomDatabase, operationId: string, readSet: BreedingOperationReadSetV1, receipt: BreedingAuthorizationReceiptV1): boolean => {
  const evidence = createSqliteBreedingOperationEvidenceRepository(database).get(operationId)
  return !!evidence && same(evidence.readSet, readSet) && same(evidence.authorizationReceipt, receipt)
}
const exactRetryExecution = (record: BreedingOperationLedgerRecord): BreedingTransactionExecutionDecision => Object.freeze({
  kind: 'exact-retry', record, committedRealtimeEvents: Object.freeze([]), publicationFailureCount: 0,
})
const assertStoredCommand = (record: BreedingOperationLedgerRecord, command: BreedingOperationCommandV1): void => {
  if (!same(record.command, command) || record.commandHash !== createBreedingOperationCommandHash(command)) return fail('breeding.hatch-completion-use-case.invalid-request', 'Operation identity is bound to another immutable command.')
}
const aggregateRevision = (record: BreedingOperationLedgerRecord, kind: 'pokemon-egg' | 'pokemon-sheet' | 'trainer-sheet', id: string): number | null => {
  if (record.status !== 'accepted' || !record.result || record.result.ok !== true) return null
  return record.result.aggregateRefs.find(entry => entry.kind === kind && entry.id === id)?.revision ?? null
}
const resultFromRecord = (input: {
  readonly database: RotomDatabase, readonly execution: BreedingTransactionExecutionDecision,
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'complete-hatch' }>, readonly audience: PokemonEggHatchCompletionAudienceV1,
  readonly childPlan: PokemonEggChildSheetConstructionPlanV1 | null,
}): CompletePokemonEggHatchResultV1 => {
  const record = input.execution.record
  if (record.status !== 'accepted' || !record.result || record.result.ok !== true) return Object.freeze({ execution: input.execution, egg: null, childSheet: null, ownerTrainerSheet: null, childPlan: input.childPlan, projection: null })
  const egg = createSqlitePokemonEggRepository(input.database).get(input.command.payload.eggId)
  const childSlug = egg?.childSheetSlug ?? null
  const child = childSlug ? createSqliteSheetRepository(input.database).getByRef('pokemon', childSlug) : null
  const trainer = egg ? createSqliteSheetRepository(input.database).getByRef('trainer', egg.ownerTrainerSlug) : null
  const origin = createSqliteBreedingLineageRepository(input.database).findOriginByEgg(input.command.payload.eggId)
  const eggRevision = egg ? aggregateRevision(record, 'pokemon-egg', egg.eggId) : null
  const childRevision = childSlug ? aggregateRevision(record, 'pokemon-sheet', childSlug) : null
  const trainerRevision = egg ? aggregateRevision(record, 'trainer-sheet', egg.ownerTrainerSlug) : null
  if (!egg || egg.status !== 'hatched' || !child || !trainer || !origin || origin.childSheetSlug !== child.slug
    || eggRevision !== egg.revision || childRevision !== child.revision || trainerRevision === null) return fail('breeding.hatch-completion-use-case.unavailable', 'Accepted hatch settlement lost its exact Egg, child, Trainer, lineage, or operation links.')
  const projection = projectPokemonEggHatchCompletionV1({
    audience: input.audience, egg, childSheetRevision: childRevision, ownerTrainerRevision: trainerRevision,
    destinationKind: input.command.payload.destination.kind,
  })
  return Object.freeze({ execution: input.execution, egg, childSheet: child, ownerTrainerSheet: trainer, childPlan: input.childPlan, projection })
}
const sheetEvents = (sheet: PersistedSheet, operationId: string, timestamp: number) => {
  const update = normalizeAuthoritativeSheetDocumentUpdate({ kind: sheet.kind, slug: sheet.slug, sheet: sheet.sheet }, `hatch ${sheet.kind} sheet`)
  return (['specific', 'global'] as const).map(destination => ({
    ...sheetDocumentUpdatedRealtimeAppendInput({
      update, destination,
      dedupeKey: `breeding:hatch:${operationId}:${sheet.kind}:${sheet.slug}:${sheet.revision}:${destination}`,
    }),
    timestamp,
  }))
}
const ownerControlCurrent = (input: {
  readonly actor: BreedingActorAuthorityV1, readonly control: BreedingTrainerControlEvidenceV1 | null,
  readonly trainer: { readonly slug: string, readonly revision: number, readonly document: unknown }, readonly campaignMinute: number,
}): boolean => {
  const fact = createPokemonEggHatchOwnerTrainerFactV1({ trainerSheetSlug: input.trainer.slug, trainerSheetRevision: input.trainer.revision, trainerSheetDocument: input.trainer.document })
  return !!input.control && input.actor.role === 'player' && input.actor.authenticatedProfileId === input.control.profileId
    && input.actor.profileDefinitionSha256 === input.control.profileDefinitionSha256 && input.actor.selectedTrainerSlug === input.trainer.slug
    && input.control.trainerSheetSlug === input.trainer.slug && input.control.trainerSheetRevision === fact.trainerSheetRevision
    && input.control.trainerSheetDefinitionSha256 === fact.trainerSheetDefinitionSha256 && input.control.evaluatedAtCampaignMinute === input.campaignMinute
}

interface MarsupialHatchAuthority {
  readonly mother: StoredSheetDocument<Record<string, unknown>>
  readonly marsupialHandoff: ReturnType<typeof createBreedingMarsupialHandoffV1>
  readonly parentalBondHandoff: ReturnType<typeof createBreedingParentalBondHandoffV1> | null
}
const normalizedProviderName = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[’‘]/gu, "'").trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
const rebuildMarsupialHatchAuthority = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'complete-hatch' }>
  readonly readSet: BreedingOperationReadSetV1
  readonly campaignMinute: number
  readonly ownerTrainerDocument: unknown
  readonly getPokemonSheet: (slug: string) => StoredSheetDocument<Record<string, unknown>> | null
  readonly listPokemonSheets: () => readonly StoredSheetDocument<Record<string, unknown>>[]
  readonly options: CompletePokemonEggHatchOptions
}): MarsupialHatchAuthority | null => {
  const trait = input.egg.offspring.providerTraits.marsupial ?? null
  const scopes = input.command.scopes.filter(scope => scope.kind === 'pokemon-sheet' && scope.fields.length === 1 && scope.fields[0] === 'marsupial-pouch')
  if (!trait) {
    if (scopes.length !== 0 || input.options.resolveEffectiveCapabilities !== undefined) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Non-Marsupial hatch completion rejects pouch scope and provider callbacks.')
    return null
  }
  const scope = scopes.length === 1 ? scopes[0]! : null
  if (!scope || scope.kind !== 'pokemon-sheet' || typeof input.options.resolveEffectiveCapabilities !== 'function') {
    return fail('breeding.hatch-completion-use-case.invalid-authority', 'Marsupial hatch completion requires exactly one mother-pouch scope and one server-owned effective-Capability resolver.')
  }
  const mother = input.getPokemonSheet(scope.sheetSlug) ?? fail('breeding.hatch-completion-use-case.unavailable', 'The Marsupial mother sheet is unavailable.')
  const ownerTrainer = input.ownerTrainerDocument as Record<string, unknown>
  const currentTeam = Array.isArray(ownerTrainer?.currentTeam) ? ownerTrainer.currentTeam : []
  const boxedPokemon = Array.isArray(ownerTrainer?.boxedPokemon) ? ownerTrainer.boxedPokemon : []
  const motherRosterClaims = [...currentTeam, ...boxedPokemon].filter(value => value === mother.slug).length
  if (motherRosterClaims !== 1) {
    return fail('breeding.hatch-completion-use-case.invalid-authority', 'The Marsupial mother must belong exactly once to the hatching Egg owner Trainer roster.')
  }
  const motherDocument = mother.document as CharacterSheet
  if (mother.revision !== scope.expectedRevision || motherDocument.slug !== mother.slug || motherDocument.species !== 'Kangaskhan'
    || !Number.isSafeInteger(motherDocument.level) || Number(motherDocument.level) < 25 || pokemonHasActiveBabyTemplate(motherDocument)
    || parseCapabilityCampaignState(motherDocument.capabilityCampaignState).marsupialPouch !== null) {
    return fail('breeding.hatch-completion-use-case.stale-authority', 'The scoped Marsupial mother must be one current unlinked adult Kangaskhan outside Baby Template recovery.')
  }
  const existingRelationship = resolveMarsupialRelationship({
    subjectSlug: mother.slug,
    pokemonBySlug: new Map(input.listPokemonSheets().map(sheet => [sheet.slug, sheet.document as CharacterSheet])),
  })
  if (existingRelationship.status !== 'absent') {
    return fail(
      'breeding.hatch-completion-use-case.stale-authority',
      existingRelationship.status === 'corrupt'
        ? existingRelationship.message
        : 'The scoped Marsupial mother already belongs to an authoritative pouch relationship.',
    )
  }
  const motherRead = resource(input.readSet, 'pokemon-sheet', mother.slug)
  if (motherRead?.existence !== 'present' || motherRead.revision !== mother.revision || motherRead.definitionSha256 !== sha256(mother.document)
    || !motherRead.purposes.includes('conflict') || !motherRead.purposes.includes('mechanics')) {
    return fail('breeding.hatch-completion-use-case.stale-authority', 'Marsupial mother read authority must bind its exact current storage document and mechanics checkpoint.')
  }
  const marsupialHandoff = createBreedingMarsupialHandoffV1({
    sourcePokemonSheet: { slug: mother.slug, revision: mother.revision, document: mother.document },
    capturedAtCampaignMinute: input.campaignMinute,
  }, { resolveEffectiveCapabilities: input.options.resolveEffectiveCapabilities })
  const contributionIds = marsupialHandoff.evidence.map(entry => entry.contribution.contributionId).sort()
  if (!same(contributionIds, ['kangaskhan-forced-baby-template-minus-5','level-25-template-removal','mother-pouch-link'])
    || marsupialHandoff.checkpoint !== 'hatch-transaction') {
    return fail('breeding.hatch-completion-use-case.invalid-authority', 'Marsupial handoff must carry exactly the reviewed forced-template, pouch, and Level 25 contributions.')
  }
  const abilities = Array.isArray(motherDocument.abilities) ? motherDocument.abilities : []
  const hasParentalBondIdentity = abilities.some(entry => typeof entry?.name === 'string' && normalizedProviderName(entry.name) === normalizedProviderName('Parental Bond'))
  const parentalBondHandoff = hasParentalBondIdentity
    ? createBreedingParentalBondHandoffV1({ sourcePokemonSheet: { slug: mother.slug, revision: mother.revision, document: mother.document }, capturedAtCampaignMinute: input.campaignMinute })
    : null
  const expectedDependencies = [...marsupialHandoff.dependencyEvidence, ...(parentalBondHandoff?.dependencyEvidence ?? [])]
  const actualDependencies = input.readSet.dependencyEvidence.filter(entry => entry.providerId === 'capability.marsupial' || entry.providerId === 'ability.parental-bond')
  if (expectedDependencies.length !== actualDependencies.length
    || expectedDependencies.some(expected => !actualDependencies.some(actual => same(actual, expected)))) {
    return fail('breeding.hatch-completion-use-case.invalid-authority', 'Marsupial and optional Parental Bond handoffs must exactly match the immutable hatch read set.')
  }
  return Object.freeze({ mother, marsupialHandoff, parentalBondHandoff })
}

export const completePokemonEggHatch = (inputValue: unknown, options: CompletePokemonEggHatchOptions): CompletePokemonEggHatchResultV1 => {
  const input = strict(inputValue, ['command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'ownerTrainerControl', 'currentOwnerTrainerControl', 'referenceVersions', 'childPlan', 'audience'], 'completePokemonEggHatchInput')
  if (input.audience !== 'owner' && input.audience !== 'gm') return fail('breeding.hatch-completion-use-case.invalid-request', 'Hatch-completion audience must be owner or GM.')
  const audience = input.audience
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'complete-hatch') return fail('breeding.hatch-completion-use-case.wrong-command', 'Hatch completion accepts complete-hatch only.')
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  if ((audience === 'gm') !== (actor.role === 'gm')) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Projection audience must match the authenticated actor role.')
  const references = currentReferences(input.referenceVersions, options)
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  if (!same(readSet.referenceVersions, references)) return fail('breeding.hatch-completion-use-case.stale-authority', 'Read set must use the exact current app-owned reference snapshot.')
  integer(options.realtimeTimestamp, 'realtimeTimestamp'); integer(options.sheetUpdatedAt, 'sheetUpdatedAt')
  const originalControl = input.ownerTrainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.ownerTrainerControl)
  const currentControl = input.currentOwnerTrainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.currentOwnerTrainerControl)
  const submittedReceipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const { database, coordinator } = coordinatorFor(options)
  const operations = createSqliteBreedingOperationRepository(database)
  const existing = operations.get(command.operationId)
  if (existing && existing.status !== 'pending') {
    assertStoredCommand(existing, command)
    if (!exactEvidence(database, command.operationId, readSet, submittedReceipt)) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Terminal hatch completion is missing or disagrees with immutable authority evidence.')
    const clock = createSqliteCampaignClockRepository(database).get()
    const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    const trainer = egg ? createSqliteSheetRepository(database).get('trainer', egg.ownerTrainerSlug) : null
    const planHash = submittedPlanHash(input.childPlan, command)
    if (actor.evaluatedAtCampaignMinute !== clock.campaignMinute || submittedReceipt.actorAuthorityDefinitionSha256 !== actor.definitionSha256
      || !submittedReceipt.evidenceDefinitionHashes.includes(planHash) || !egg || !trainer) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Exact retry requires its original actor, child plan, and current campaign and settled owner authority.')
    if (actor.role === 'gm') {
      if (currentControl !== null || originalControl !== null) return fail('breeding.hatch-completion-use-case.invalid-authority', 'GM exact retry rejects Trainer-control evidence.')
      verifyGm(actor, options)
    }
    else {
      if (!originalControl || !submittedReceipt.evidenceDefinitionHashes.includes(originalControl.definitionSha256)
        || options.validateCurrentGmAuthority !== undefined || !ownerControlCurrent({ actor, control: currentControl, trainer, campaignMinute: clock.campaignMinute })) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Owner exact retry requires its original control evidence plus current Profile control of the unchanged Egg owner Trainer.')
    }
    return resultFromRecord({ database, execution: exactRetryExecution(existing), command, audience, childPlan: null })
  }
  if (existing?.status === 'pending') {
    assertStoredCommand(existing, command)
    if (!exactEvidence(database, command.operationId, readSet, submittedReceipt)) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Pending hatch completion is missing or disagrees with immutable authority evidence.')
    const pendingClock = createSqliteCampaignClockRepository(database).get()
    const pendingEgg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    const pendingTrainer = createSqliteSheetRepository(database).get('trainer', command.payload.destination.trainerSheetSlug)
    const pendingAcquisition = pendingEgg && pendingTrainer
      ? createSqliteTrainerSpeciesAcquisitionRepository(database).get(pendingTrainer.slug, pendingEgg.offspring.speciesId) : null
    const eggRead = resource(readSet, 'pokemon-egg', command.payload.eggId)
    const trainerRead = resource(readSet, 'trainer-sheet', command.payload.destination.trainerSheetSlug)
    const clockRead = resource(readSet, 'campaign-clock', 'campaign-clock')
    const acquisitionRead = pendingEgg && pendingTrainer
      ? resource(readSet, 'species-acquisition', `${pendingTrainer.slug}/${pendingEgg.offspring.speciesId}`) : null
    const authorityStillCurrent = !!pendingEgg && !!pendingTrainer && pendingEgg.status === 'hatching'
      && eggRead?.revision === pendingEgg.revision && eggRead.definitionSha256 === pokemonEggLifecycleDocumentDefinitionSha256(pendingEgg)
      && trainerRead?.revision === pendingTrainer.revision && trainerRead.definitionSha256 === sha256(pendingTrainer.document)
      && clockRead?.revision === pendingClock.revision && clockRead.definitionSha256 === sha256(pendingClock)
      && (pendingAcquisition ? acquisitionRead?.existence === 'present' && acquisitionRead.definitionSha256 === pendingAcquisition.definitionSha256
        : acquisitionRead?.existence === 'absent' && acquisitionRead.definitionSha256 === null)
    if (!authorityStillCurrent) {
      const planHash = submittedPlanHash(input.childPlan, command)
      if (!pendingTrainer || actor.evaluatedAtCampaignMinute !== pendingClock.campaignMinute
        || submittedReceipt.actorAuthorityDefinitionSha256 !== actor.definitionSha256
        || !submittedReceipt.evidenceDefinitionHashes.includes(planHash)) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Stale pending recovery requires its original actor and child-plan evidence plus current campaign authority.')
      if (actor.role === 'gm') {
        if (originalControl !== null || currentControl !== null) return fail('breeding.hatch-completion-use-case.invalid-authority', 'GM pending recovery rejects Trainer-control evidence.')
        verifyGm(actor, options)
      }
      else if (!originalControl || !submittedReceipt.evidenceDefinitionHashes.includes(originalControl.definitionSha256)
        || options.validateCurrentGmAuthority !== undefined
        || !ownerControlCurrent({ actor, control: currentControl, trainer: pendingTrainer, campaignMinute: pendingClock.campaignMinute })) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Owner pending recovery requires original evidence and current destination-Trainer control.')
      if (options.resumePending !== true) {
        const pendingExecution: BreedingTransactionExecutionDecision = Object.freeze({ kind: 'pending', record: existing, committedRealtimeEvents: Object.freeze([]), publicationFailureCount: 0 })
        return resultFromRecord({ database, execution: pendingExecution, command, audience, childPlan: null })
      }
      const staleExecution = coordinator.execute({
        command,
        createdAtCampaignMinute: existing.createdAtCampaignMinute,
        settledAtCampaignMinute: pendingClock.campaignMinute,
        resumePending: true,
        execute: (canonical, _operation, context) => {
          const currentEgg = context.repositories.eggs.get(canonical.payload.eggId)
          return createBreedingOperationRejectedV1({
            operationId: canonical.operationId,
            commandHash: createBreedingOperationCommandHash(canonical),
            commandKind: canonical.commandKind,
            reasonId: 'breeding.operation.stale-revision',
            currentAggregateRefs: currentEgg ? [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }] : [],
            conflictingScopes: canonical.scopes,
          })
        },
        ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
      })
      return resultFromRecord({ database, execution: staleExecution, command, audience, childPlan: null })
    }
  }
  if (actor.role === 'gm') {
    if (originalControl !== null || currentControl !== null) return fail('breeding.hatch-completion-use-case.invalid-authority', 'GM hatch completion rejects Trainer-control evidence.')
    verifyGm(actor, options)
  }
  else {
    if (options.validateCurrentGmAuthority !== undefined || !originalControl || !currentControl || !same(originalControl, currentControl)) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Owner hatch completion requires one exact current Trainer-control proof and rejects GM callbacks.')
  }
  const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId) ?? fail('breeding.hatch-completion-use-case.unavailable', 'Hatching Egg is unavailable.')
  const trainer = createSqliteSheetRepository(database).get('trainer', egg.ownerTrainerSlug) ?? fail('breeding.hatch-completion-use-case.unavailable', 'Owner Trainer destination is unavailable.')
  const clock = createSqliteCampaignClockRepository(database).get()
  const begin = egg.hatchOperationId ? operations.get(egg.hatchOperationId) : null
  if (!begin || begin.status !== 'accepted' || begin.command.commandKind !== 'begin-hatch') return fail('breeding.hatch-completion-use-case.unavailable', 'Egg begin-hatch authority is unavailable or unsettled.')
  const acquisition = createSqliteTrainerSpeciesAcquisitionRepository(database).get(trainer.slug, egg.offspring.speciesId)
  const marsupialAuthority = rebuildMarsupialHatchAuthority({
    egg, command, readSet, campaignMinute: clock.campaignMinute, ownerTrainerDocument: trainer.document,
    getPokemonSheet: slug => createSqliteSheetRepository(database).get('pokemon', slug) as StoredSheetDocument<Record<string, unknown>> | null,
    listPokemonSheets: () => createSqliteSheetRepository<Record<string, unknown>>(database).list('pokemon'),
    options,
  })
  const fact = createPokemonEggHatchOwnerTrainerFactV1({ trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDocument: trainer.document })
  const planHash = submittedPlanHash(input.childPlan, command)
  const childPlan = assertPokemonEggChildSheetConstructionExactReplayV1({ plan: input.childPlan, egg, command })
  if (childPlan.definitionSha256 !== planHash) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Child construction plan hash changed during exact replay validation.')
  const expectedReceipt = authorizeBreedingCompleteHatchV1({
    command, readSet, actorAuthority: actor, ownerTrainerControl: originalControl, egg, ownerTrainerFact: fact,
    currentClock: clock, beginHatchCommand: begin.command,
    currentSpeciesAcquisitionDefinitionSha256: acquisition?.definitionSha256 ?? null,
    childPlanDefinitionSha256: childPlan.definitionSha256,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const receipt = exactReceipt(input.authorizationReceipt, expectedReceipt)
  const reservation = database.withTransaction(() => {
    const decision = operations.reserve(command, clock.campaignMinute)
    if (decision.kind === 'reserved' || options.resumePending === true) createSqliteBreedingOperationEvidenceRepository(database).insert({ command, readSet, authorizationReceipt: receipt })
    return decision
  })
  if (reservation.kind === 'exact-retry') return resultFromRecord({ database, execution: exactRetryExecution(reservation.record), command, audience, childPlan: null })
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...((reservation.kind === 'reserved' || options.resumePending === true) ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      const commandHash = createBreedingOperationCommandHash(canonical)
      const currentEgg = context.repositories.eggs.get(canonical.payload.eggId)
      const currentClock = context.repositories.campaignClock.get()
      const currentTrainer = context.repositories.sheets.get('trainer', canonical.payload.destination.trainerSheetSlug)
      const currentBegin = currentEgg?.hatchOperationId === begin.operationId ? begin : null
      const currentAcquisition = currentEgg && currentTrainer ? context.repositories.speciesAcquisitions.get(currentTrainer.slug, currentEgg.offspring.speciesId) : null
      let currentMarsupialAuthority: MarsupialHatchAuthority | null | undefined
      try {
        currentMarsupialAuthority = currentEgg && currentTrainer ? rebuildMarsupialHatchAuthority({
          egg: currentEgg, command: canonical, readSet, campaignMinute: currentClock.campaignMinute,
          ownerTrainerDocument: currentTrainer.document,
          getPokemonSheet: slug => context.repositories.sheets.get('pokemon', slug) as StoredSheetDocument<Record<string, unknown>> | null,
          listPokemonSheets: () => context.repositories.sheets.list('pokemon') as readonly StoredSheetDocument<Record<string, unknown>>[],
          options,
        }) : undefined
      }
      catch { currentMarsupialAuthority = undefined }
      const evidence = context.repositories.operationEvidence.get(canonical.operationId)
      const eggRead = currentEgg ? resource(readSet, 'pokemon-egg', currentEgg.eggId) : null
      const trainerRead = currentTrainer ? resource(readSet, 'trainer-sheet', currentTrainer.slug) : null
      const clockRead = resource(readSet, 'campaign-clock', 'campaign-clock')
      const acquisitionRead = currentEgg && currentTrainer ? resource(readSet, 'species-acquisition', `${currentTrainer.slug}/${currentEgg.offspring.speciesId}`) : null
      const allocationRead = resource(readSet, 'pokemon-sheet-allocation', 'pokemon')
      const beginRead = currentBegin ? resource(readSet, 'breeding-operation', currentBegin.operationId) : null
      const stale = !currentEgg || !currentTrainer || !currentBegin || currentBegin.status !== 'accepted' || currentBegin.command.commandKind !== 'begin-hatch'
        || currentClock.campaignMinute !== readSet.capturedAtCampaignMinute || currentClock.revision !== clockRead?.revision || sha256(currentClock) !== clockRead.definitionSha256
        || eggRead?.revision !== currentEgg.revision || eggRead.definitionSha256 !== pokemonEggLifecycleDocumentDefinitionSha256(currentEgg)
        || trainerRead?.revision !== currentTrainer.revision || trainerRead.definitionSha256 !== sha256(currentTrainer.document)
        || allocationRead?.existence !== 'present' || allocationRead.revision !== 0 || allocationRead.definitionSha256 !== initializedSheetContractJson.definitionSha256
        || beginRead?.existence !== 'present' || beginRead.revision !== null || beginRead.definitionSha256 !== createBreedingOperationCommandHash(currentBegin.command)
        || (currentAcquisition ? acquisitionRead?.existence !== 'present' || acquisitionRead.definitionSha256 !== currentAcquisition.definitionSha256
          : acquisitionRead?.existence !== 'absent' || acquisitionRead.definitionSha256 !== null)
        || currentMarsupialAuthority === undefined || !same(currentMarsupialAuthority, marsupialAuthority)
        || !evidence || !same(evidence.readSet, readSet) || !same(evidence.authorizationReceipt, receipt)
      if (stale) return createBreedingOperationRejectedV1({
        operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
        reasonId: 'breeding.operation.stale-revision',
        currentAggregateRefs: currentEgg ? [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }] : [],
        conflictingScopes: canonical.scopes,
      })
      const rebuiltPlan = planPokemonEggChildSheetConstructionV1({ egg: currentEgg, command: canonical })
      if (!same(rebuiltPlan, childPlan)) throw new Error('Atomic hatch child plan no longer matches immutable phase-1 authority.')
      let child = context.repositories.initializedPokemonSheets.create({
        baseSlug: rebuiltPlan.baseSlug, folder: rebuiltPlan.folder, updatedAt: options.sheetUpdatedAt, document: rebuiltPlan.document,
      })
      let linkedMother: PersistedSheet | null = null
      if (currentMarsupialAuthority) {
        const pouch: CapabilityMarsupialPouchState = Object.freeze({
          motherSheetSlug: currentMarsupialAuthority.mother.slug,
          babySheetSlug: child.slug,
          experienceSharePercent: 0,
          establishedAt: currentClock.campaignMinute,
          sourceOperationId: canonical.operationId,
        })
        const motherState = parseCapabilityCampaignState((currentMarsupialAuthority.mother.document as CharacterSheet).capabilityCampaignState)
        const childState = parseCapabilityCampaignState((child.sheet as CharacterSheet).capabilityCampaignState)
        const childPrivate = (child.sheet as CharacterSheet).serverPrivate
        const childTraits = childPrivate?.breedingProviderTraits
        const childMarsupial = childTraits?.marsupial
        if (motherState.marsupialPouch !== null || childState.marsupialPouch !== null || !childPrivate || !childTraits || !childMarsupial) {
          throw new Error('Atomic Marsupial linkage requires one clean mother, one clean baby, and frozen private provider authority.')
        }
        const motherResult = context.repositories.sheets.applyLivePlayUpdate({
          kind: 'pokemon', slug: currentMarsupialAuthority.mother.slug, expectedRevision: currentMarsupialAuthority.mother.revision,
          nextSheet: { ...currentMarsupialAuthority.mother.document, updatedAt: options.sheetUpdatedAt,
            capabilityCampaignState: { ...motherState, marsupialPouch: pouch } }, sourceOperationId: canonical.operationId,
        })
        const childResult = context.repositories.sheets.applyLivePlayUpdate({
          kind: 'pokemon', slug: child.slug, expectedRevision: child.revision,
          nextSheet: { ...child.sheet, updatedAt: options.sheetUpdatedAt,
            capabilityCampaignState: { ...childState, marsupialPouch: pouch },
            serverPrivate: { ...childPrivate, breedingProviderTraits: { ...childTraits, marsupial: {
              ...childMarsupial,
              motherSheetSlug: currentMarsupialAuthority.mother.slug,
              hatchHandoffDefinitionSha256: currentMarsupialAuthority.marsupialHandoff.definitionSha256,
              parentalBondHandoffDefinitionSha256: currentMarsupialAuthority.parentalBondHandoff?.definitionSha256 ?? null,
            } } },
          }, sourceOperationId: canonical.operationId,
        })
        if (motherResult !== 'applied' || childResult !== 'applied') throw new Error('Atomic mirrored Marsupial pouch linkage unexpectedly conflicted.')
        linkedMother = context.repositories.sheets.getByRef('pokemon', currentMarsupialAuthority.mother.slug)
        const linkedChild = context.repositories.sheets.getByRef('pokemon', child.slug)
        if (!linkedMother || !linkedChild) throw new Error('Atomic mirrored Marsupial pouch linkage removed a participant unexpectedly.')
        const relationship = resolveMarsupialRelationship({
          subjectSlug: linkedChild.slug,
          pokemonBySlug: new Map(context.repositories.sheets.list('pokemon').map(sheet => [
            sheet.slug,
            sheet.document as CharacterSheet,
          ])),
        })
        if (relationship.status !== 'valid' || relationship.subjectRole !== 'baby') throw new Error('Atomic mirrored Marsupial pouch linkage failed authoritative reciprocal validation.')
        child = linkedChild
      }
      const trainerDocument = currentTrainer.document as Record<string, unknown>
      const trainerDexExpBefore = trainerDocument.dexExp ?? 0
      const reward = context.repositories.speciesAcquisitionRewards.record({
        schemaVersion: 1, trainerSheetSlug: currentTrainer.slug, expectedTrainerRevision: currentTrainer.revision,
        speciesId: currentEgg.offspring.speciesId, sourceKind: 'hatch', sourceEggId: currentEgg.eggId,
        acquiredAtCampaignMinute: currentClock.campaignMinute, operationId: canonical.operationId, sheetUpdatedAt: options.sheetUpdatedAt,
      })
      validatePokemonHatchSpeciesAcquisitionSettlementV1({
        egg: currentEgg, command: canonical, existingAcquisition: currentAcquisition, reward,
        trainerRevisionBefore: currentTrainer.revision, trainerDexExpBefore,
        campaignMinute: currentClock.campaignMinute, sheetUpdatedAt: options.sheetUpdatedAt,
      })
      const rewardedTrainer = context.repositories.sheets.getByRef('trainer', currentTrainer.slug)
      if (!rewardedTrainer) throw new Error('Atomic hatch reward removed the owner Trainer unexpectedly.')
      const rosterField = canonical.payload.destination.kind === 'team' ? 'currentTeam' : 'boxedPokemon'
      const currentRoster = rewardedTrainer.sheet[rosterField] ?? []
      if (!Array.isArray(currentRoster) || currentRoster.some(value => typeof value !== 'string') || currentRoster.includes(child.slug)
        || (rosterField === 'currentTeam' && currentRoster.length >= 6)) throw new Error('Atomic hatch destination roster became unavailable.')
      const trainerReplacement = context.repositories.sheets.replaceSetupSheet({
        kind: 'trainer', slug: rewardedTrainer.slug, expectedRevision: rewardedTrainer.revision,
        sheet: { ...rewardedTrainer.sheet, [rosterField]: [...currentRoster, child.slug] }, now: options.sheetUpdatedAt,
      })
      if (!trainerReplacement?.changed) throw new Error('Atomic hatch Trainer linkage did not apply exactly once.')
      const hatched = planPokemonEggHatchSettlementV1({ egg: currentEgg, command: canonical, childSheetSlug: child.slug, atCampaignMinute: currentClock.campaignMinute })
      const eggReplacement = context.repositories.eggs.replace({ expectedRevision: currentEgg.revision, document: hatched })
      if (eggReplacement.kind !== 'applied') throw new Error('Atomic hatch Egg settlement unexpectedly conflicted.')
      const origin = createPokemonBreedingOriginFromHatchedEgg({ originId: canonical.payload.originId, egg: hatched })
      context.repositories.lineage.insertOrigin(origin)
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg', aggregateId: hatched.eggId, revision: hatched.revision,
        operationKind: canonical.commandKind,
        audienceTargets: [{ audience: 'owner', trainerSheetSlug: hatched.ownerTrainerSlug }, { audience: 'gm', trainerSheetSlug: null }],
        campaignProjectionKey: options.campaignProjectionKey, timestamp: options.realtimeTimestamp,
      }))
      context.appendRealtime([
        ...sheetEvents({ kind: child.kind, slug: child.slug, sheet: child.sheet, revision: child.revision, updatedAt: child.updatedAt }, canonical.operationId, options.realtimeTimestamp),
        ...(linkedMother ? sheetEvents(linkedMother, canonical.operationId, options.realtimeTimestamp) : []),
        ...sheetEvents(trainerReplacement.sheet, canonical.operationId, options.realtimeTimestamp),
      ])
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind, outcomeKind: 'hatched',
        aggregateRefs: [
          { kind: 'pokemon-egg', id: hatched.eggId, revision: hatched.revision },
          { kind: 'pokemon-sheet', id: child.slug, revision: child.revision },
          ...(linkedMother ? [{ kind: 'pokemon-sheet' as const, id: linkedMother.slug, revision: linkedMother.revision }] : []),
          { kind: 'trainer-sheet', id: trainerReplacement.sheet.slug, revision: trainerReplacement.sheet.revision },
        ],
        changedScopes: canonical.scopes, committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending' && !exactEvidence(database, command.operationId, readSet, receipt)) return fail('breeding.hatch-completion-use-case.invalid-authority', 'Terminal hatch completion lost immutable authority evidence.')
  return resultFromRecord({ database, execution, command, audience, childPlan: execution.kind === 'executed' ? childPlan : null })
}
