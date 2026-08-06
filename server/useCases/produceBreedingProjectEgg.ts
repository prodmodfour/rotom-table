import { createHash, randomInt } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1, BreedingCrossOwnerConsentEvidenceV1 } from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import type { BreedingEggProductionProjectionV1 } from '#shared/breeding/eggProduction'
import type { BreedingConsentRecordV1, BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1, type BreedingOperationResultV1, type BreedingRollRequestKind } from '#shared/breeding/operations'
import type { BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1,
} from '../domain/breeding/authorization'
import { createBreedingRollRecordFromInjectedValues } from '../domain/breeding/ledgers'
import {
  planBreedingEggProductionV1,
  projectBreedingEggProductionV1,
  BreedingEggProductionAuthorityError,
} from '../domain/breeding/eggProduction'
import {
  breedingOffspringRollSourceDefinitionHashes,
  planBreedingOffspringResolutionV1,
  resolveBreedingOffspringRollRequirementsV1,
  BreedingOffspringProductionAuthorityError,
} from '../domain/breeding/offspringProduction'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import {
  createBreedingProductionSnapshotV1,
  BreedingProductionSnapshotAuthorityError,
  type CreateBreedingProductionSnapshotInputV1,
} from '../domain/breeding/productionSnapshots'
import { breedingProjectDocumentDefinitionSha256 } from '../domain/breeding/projectInitialProgress'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingCheckLedgerRepository } from '../storage/breedingCheckLedgerRepository'
import { createSqliteBreedingConsentRepository } from '../storage/breedingConsentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../storage/breedingOptionOfferRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { createSqliteBreedingRollRepository } from '../storage/breedingRollRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

interface StrictProductionInput {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly campaignOptionSnapshot: unknown
  readonly parents: CreateBreedingProductionSnapshotInputV1['parents']
  readonly breeder: CreateBreedingProductionSnapshotInputV1['breeder']
  readonly breederAuthority: CreateBreedingProductionSnapshotInputV1['breederAuthority']
  readonly providerSnapshot: CreateBreedingProductionSnapshotInputV1['providerSnapshot']
  readonly consentEvidence: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly roleOverride: CreateBreedingProductionSnapshotInputV1['roleOverride']
  readonly roleOverrideEvidenceDefinitionSha256: string | null
  readonly audience: 'gm'|'owner'
}
export interface ProduceBreedingProjectEggResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly project: BreedingProjectDocumentV1 | null
  readonly egg: PokemonEggDocumentV1 | null
  readonly projection: BreedingEggProductionProjectionV1 | null
}
export interface ProduceBreedingProjectEggOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer|string
  readonly realtimeTimestamp: number
  readonly drawOffspringFamilyD20?: () => number
  readonly drawNatureD6?: () => number
  readonly drawAbilityIndex?: (maximum: number) => number
  readonly drawGenderD100?: () => number
  readonly drawHatchDurationPercentage?: () => number
  readonly drawProviderIndex?: (maximum: number) => number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type ProduceBreedingProjectEggErrorCode =
  | 'breeding.egg-production.invalid-request'
  | 'breeding.egg-production.invalid-authority'
  | 'breeding.egg-production.invalid-random-source'
  | 'breeding.egg-production.repository-mismatch'
  | 'breeding.egg-production.wrong-command'
export class ProduceBreedingProjectEggError extends Error {
  readonly code: ProduceBreedingProjectEggErrorCode
  constructor(code: ProduceBreedingProjectEggErrorCode, message: string) {
    super(message)
    this.name = 'ProduceBreedingProjectEggError'
    this.code = code
  }
}
const fail = (code: ProduceBreedingProjectEggErrorCode, message: string): never => { throw new ProduceBreedingProjectEggError(code, message) }
const strictInput = (value: unknown): StrictProductionInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.egg-production.invalid-request', 'Egg-production input must be a plain exact object.')
  const row = value as Record<string, unknown>
  const fields = ['command','readSet','authorizationReceipt','campaignOptionSnapshot','parents','breeder','breederAuthority','providerSnapshot','consentEvidence','roleOverride','roleOverrideEvidenceDefinitionSha256','audience']
  for (const key of Object.getOwnPropertyNames(row)) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.egg-production.invalid-request', 'Egg-production input cannot contain accessors or hidden fields.')
  }
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !fields.includes(field))
    || (row.audience !== 'gm' && row.audience !== 'owner')
    || (row.roleOverrideEvidenceDefinitionSha256 !== null
      && (typeof row.roleOverrideEvidenceDefinitionSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(row.roleOverrideEvidenceDefinitionSha256)))) {
    return fail('breeding.egg-production.invalid-request', 'Egg-production input must contain exactly the declared authority fields and bounded audience.')
  }
  if (!Array.isArray(row.parents) || Object.getPrototypeOf(row.parents) !== Array.prototype || row.parents.length !== 2
    || Object.getOwnPropertySymbols(row.parents).length > 0 || Object.getOwnPropertyNames(row.parents).length !== 3
    || !Array.isArray(row.consentEvidence) || Object.getPrototypeOf(row.consentEvidence) !== Array.prototype
    || row.consentEvidence.length > 2 || Object.getOwnPropertySymbols(row.consentEvidence).length > 0
    || Object.getOwnPropertyNames(row.consentEvidence).length !== row.consentEvidence.length + 1) {
    return fail('breeding.egg-production.invalid-request', 'Parents and consent evidence must be plain bounded arrays.')
  }
  return Object.freeze({
    command: row.command,
    readSet: row.readSet,
    authorizationReceipt: row.authorizationReceipt,
    campaignOptionSnapshot: row.campaignOptionSnapshot,
    parents: row.parents as unknown as StrictProductionInput['parents'],
    breeder: row.breeder as StrictProductionInput['breeder'],
    breederAuthority: row.breederAuthority as StrictProductionInput['breederAuthority'],
    providerSnapshot: row.providerSnapshot as StrictProductionInput['providerSnapshot'],
    consentEvidence: Object.freeze(row.consentEvidence.map((entry, index) => parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1(entry, `consentEvidence[${index}]`))),
    roleOverride: row.roleOverride as StrictProductionInput['roleOverride'],
    roleOverrideEvidenceDefinitionSha256: row.roleOverrideEvidenceDefinitionSha256 as string|null,
    audience: row.audience,
  })
}
const readResource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string): BreedingReadResourceV1|null => readSet.resources.find(resource => resource.resourceKind === kind && resource.resourceId === id) ?? null
const clockHash = (clock: { readonly revision:number, readonly campaignMinute:number, readonly lastOperationId:string|null }): string => createHash('sha256').update(stableJsonStringify({ schemaVersion:1, revision:clock.revision, campaignMinute:clock.campaignMinute, lastOperationId:clock.lastOperationId })).digest('hex')
const clockMatches = (readSet: BreedingOperationReadSetV1, clock: { readonly revision:number, readonly campaignMinute:number, readonly lastOperationId:string|null }): boolean => {
  const resource = readResource(readSet, 'campaign-clock', 'campaign-clock')
  return resource?.existence === 'present' && resource.revision === clock.revision
    && resource.definitionSha256 === clockHash(clock) && resource.observedCampaignMinute === clock.campaignMinute
    && resource.purposes.includes('campaign-time')
}
const exactEvidence = (database: RotomDatabase, command: BreedingOperationCommandV1, readSet: BreedingOperationReadSetV1, receipt: BreedingAuthorizationReceiptV1): boolean => {
  const evidence = createSqliteBreedingOperationEvidenceRepository(database).get(command.operationId)
  return Boolean(evidence && stableJsonStringify(evidence.readSet) === stableJsonStringify(readSet)
    && stableJsonStringify(evidence.authorizationReceipt) === stableJsonStringify(receipt))
}
const currentConsent = (input: { readonly project: BreedingProjectDocumentV1, readonly evidence: readonly BreedingCrossOwnerConsentEvidenceV1[], readonly at:number, readonly get:(id:string)=>BreedingConsentRecordV1|null }): boolean => {
  const crossOwners = input.project.parentRefs.filter(parent => parent.ownerTrainerSlug !== input.project.ownerTrainerSlug)
  if (crossOwners.length !== input.evidence.length) return false
  return crossOwners.every((parent,index) => {
    const evidence = input.evidence[index]
    if (!evidence || evidence.projectId !== input.project.projectId || evidence.parentSheetSlug !== parent.pokemonSheetSlug
      || evidence.parentSheetRevision !== parent.expectedSheetRevision || evidence.ownerTrainerSlug !== parent.ownerTrainerSlug
      || evidence.validatedAtCampaignMinute !== input.at || (evidence.expiresAtCampaignMinute !== null && input.at >= evidence.expiresAtCampaignMinute)) return false
    const record = input.get(evidence.consentId)
    return Boolean(record && record.status === 'active' && record.revision === evidence.consentRevision
      && record.definitionSha256 === evidence.consentRecordDefinitionSha256 && record.projectId === evidence.projectId
      && record.parentSheetSlug === evidence.parentSheetSlug && record.parentSheetRevision === evidence.parentSheetRevision
      && record.ownerTrainerSlug === evidence.ownerTrainerSlug && record.consentingProfileId === evidence.consentingProfileId
      && record.expiresAtCampaignMinute === evidence.expiresAtCampaignMinute
      && (record.expiresAtCampaignMinute === null || input.at < record.expiresAtCampaignMinute))
  })
}
const selectedOffersCurrent = (input: { readonly projectId:string, readonly optionIds:readonly string[], readonly readSet:BreedingOperationReadSetV1, readonly receipt:BreedingAuthorizationReceiptV1, readonly find:(value:{readonly projectId:string, readonly optionIds:readonly string[]})=>readonly BreedingOptionOfferRecordV1[] }): readonly BreedingOptionOfferRecordV1[] => {
  const offers = input.find({ projectId:input.projectId, optionIds:input.optionIds })
  for (const offer of offers) {
    const resource = readResource(input.readSet, 'breeding-offer', offer.offerId)
    if (resource?.existence !== 'present' || resource.revision !== offer.revision || resource.definitionSha256 !== offer.definitionSha256
      || !resource.purposes.includes('mechanics') || !input.receipt.evidenceDefinitionHashes.includes(offer.definitionSha256)) {
      return fail('breeding.egg-production.invalid-authority', 'Every selected option offer must be one current mechanics read and authorization-receipt evidence hash.')
    }
  }
  return offers
}
const snapshotFromCurrent = (input: { readonly database:RotomDatabase, readonly parsed:StrictProductionInput, readonly command:BreedingOperationCommandV1, readonly readSet:BreedingOperationReadSetV1, readonly receipt:BreedingAuthorizationReceiptV1 }) => {
  const project = createSqliteBreedingProjectRepository(input.database).get(input.command.payload.projectId)
  if (!project) return null
  const check = createSqliteBreedingCheckLedgerRepository(input.database).getCheckByProject(project.projectId)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const egg = createSqlitePokemonEggRepository(input.database).get(input.command.payload.eggId)
  if (!check || egg || !clockMatches(input.readSet, clock)
    || !currentConsent({ project, evidence:input.parsed.consentEvidence, at:input.readSet.capturedAtCampaignMinute, get:id=>createSqliteBreedingConsentRepository(input.database).get(id) })) return null
  const snapshot = createBreedingProductionSnapshotV1({
    project, check, command:input.command, readSet:input.readSet, authorizationReceipt:input.receipt,
    campaignOptionSnapshot:input.parsed.campaignOptionSnapshot, parents:input.parsed.parents,
    breeder:input.parsed.breeder, breederAuthority:input.parsed.breederAuthority,
    providerSnapshot:input.parsed.providerSnapshot, consentEvidence:input.parsed.consentEvidence,
    roleOverride:input.parsed.roleOverride, roleOverrideEvidenceDefinitionSha256:input.parsed.roleOverrideEvidenceDefinitionSha256,
  })
  const sheets = createSqliteSheetRepository(input.database)
  if (snapshot.parents.some(parent => sheets.getByRef('pokemon', parent.pokemonSheetSlug)?.revision !== parent.sheetRevision)
    || sheets.getByRef('trainer', snapshot.breeder.trainerSheetSlug)?.revision !== snapshot.breeder.sheetRevision) return null
  const offers = selectedOffersCurrent({ projectId:project.projectId, optionIds:input.command.payload.resolutions.selectedOptionIds,
    readSet:input.readSet, receipt:input.receipt,
    find:value=>createSqliteBreedingOptionOfferRepository(input.database).findByProjectOptionIds(value) })
  return Object.freeze({ project, check, clock, snapshot, offers })
}
const rollRecordId = (operationId:string, ordinal:number): `breeding-roll:v1:${string}` => `breeding-roll:v1:${createHash('sha256').update(`breeding-offspring-production-roll-v1\0${operationId}\0${ordinal}`).digest('hex').slice(0,32)}`
const boundedDraw = (draw:()=>number, maximum:number, label:string): number => {
  let value:unknown
  try { value=draw() } catch { return fail('breeding.egg-production.invalid-random-source', `${label} server random source threw.`) }
  if (!Number.isSafeInteger(value) || Number(value)<1 || Number(value)>maximum) return fail('breeding.egg-production.invalid-random-source', `${label} server random source must return 1 through ${maximum}.`)
  return Number(value)
}
const rollDefinition = (kind:BreedingRollRequestKind, abilitySides:number|null) => {
  if (kind==='offspring-family') return { purpose:'offspring-family-d20' as const, formula:'1d20' as const, dieCount:1, dieSides:20, ordered:false }
  if (kind==='nature') return { purpose:'nature-ordered-2d6' as const, formula:'ordered-2d6' as const, dieCount:2, dieSides:6, ordered:true }
  if (kind==='ability' && abilitySides !== null) return { purpose:'ability-uniform-index' as const, formula:'uniform-index' as const, dieCount:1, dieSides:abilitySides, ordered:false }
  if (kind==='gender') return { purpose:'gender-d100' as const, formula:'1d100' as const, dieCount:1, dieSides:100, ordered:false }
  if (kind==='hatch-duration') return { purpose:'hatch-duration-percentage' as const, formula:'percentage-50-to-200' as const, dieCount:1, dieSides:151, ordered:false }
  if (kind==='provider') return { purpose:'provider-bounded' as const, formula:'provider-bounded' as const, dieCount:1, dieSides:2, ordered:false }
  return fail('breeding.egg-production.invalid-authority', 'Unsupported or unresolved production roll declaration.')
}
const drawValues = (kind:BreedingRollRequestKind, abilitySides:number|null, options:ProduceBreedingProjectEggOptions): readonly number[] => {
  if (kind==='offspring-family') return [boundedDraw(options.drawOffspringFamilyD20 ?? (()=>randomInt(1,21)),20,'Family d20')]
  if (kind==='nature') { const draw=options.drawNatureD6 ?? (()=>randomInt(1,7)); return [boundedDraw(draw,6,'first Nature d6'),boundedDraw(draw,6,'second Nature d6')] }
  if (kind==='ability' && abilitySides !== null) return [boundedDraw(()=>options.drawAbilityIndex ? options.drawAbilityIndex(abilitySides) : randomInt(1,abilitySides+1),abilitySides,'Ability index')]
  if (kind==='gender') return [boundedDraw(options.drawGenderD100 ?? (()=>randomInt(1,101)),100,'Gender d100')]
  if (kind==='hatch-duration') {
    const percentage=boundedDraw(options.drawHatchDurationPercentage ?? (()=>randomInt(50,201)),200,'Hatch-duration percentage')
    if (percentage < 50) return fail('breeding.egg-production.invalid-random-source','Hatch-duration percentage server random source must return 50 through 200.')
    return [percentage - 49]
  }
  if (kind==='provider') return [boundedDraw(()=>options.drawProviderIndex ? options.drawProviderIndex(2) : randomInt(1,3),2,'Provider index')]
  return fail('breeding.egg-production.invalid-authority','Unsupported production roll declaration.')
}
const prepareAuthorityAndRolls = (input: { readonly database:RotomDatabase, readonly parsed:StrictProductionInput, readonly command:BreedingOperationCommandV1, readonly readSet:BreedingOperationReadSetV1, readonly receipt:BreedingAuthorizationReceiptV1, readonly options:ProduceBreedingProjectEggOptions }): void => {
  const initial = input.database.withTransaction(() => {
    createSqliteBreedingOperationEvidenceRepository(input.database).insert({ command:input.command, readSet:input.readSet, authorizationReceipt:input.receipt })
    return snapshotFromCurrent(input)
  })
  if (!initial) return
  const repository = createSqliteBreedingRollRepository(input.database)
  let persisted = repository.listByOperation(input.command.operationId)
  const familyRequested = input.command.payload.resolutions.requestedRollKinds.includes('offspring-family')
  if (familyRequested && persisted.length === 0) {
    const kind='offspring-family' as const; const definition=rollDefinition(kind,null)
    const roll=createBreedingRollRecordFromInjectedValues({ schemaVersion:1, rollRecordId:rollRecordId(input.command.operationId,0), operationId:input.command.operationId,
      commandSha256:createBreedingOperationCommandHash(input.command), operationRollOrdinal:0, purpose:definition.purpose,
      target:{kind:'breeding-project',projectId:initial.project.projectId,revision:initial.project.revision}, formula:definition.formula,
      dieCount:definition.dieCount,dieSides:definition.dieSides,ordered:definition.ordered,modifier:0,values:drawValues(kind,null,input.options),generatorId:'server-rng-v1',
      sourceDefinitionHashes:breedingOffspringRollSourceDefinitionHashes(initial.snapshot),generatedAtCampaignMinute:input.readSet.capturedAtCampaignMinute })
    input.database.withTransaction(()=>repository.insert({command:input.command,roll})); persisted=repository.listByOperation(input.command.operationId)
  }
  const familyRoll=persisted.find(roll=>roll.purpose==='offspring-family-d20')??null
  const requirements=resolveBreedingOffspringRollRequirementsV1({ productionSnapshot:initial.snapshot,command:input.command,offers:initial.offers,
    roleOverride:input.parsed.roleOverride,roleOverrideEvidenceDefinitionSha256:input.parsed.roleOverrideEvidenceDefinitionSha256,familyRoll })
  for (const [ordinal,kind] of requirements.requestedRollKinds.entries()) {
    const existing=repository.listByOperation(input.command.operationId)[ordinal]
    if (existing) continue
    const definition=rollDefinition(kind,requirements.abilityDieSides)
    const values=drawValues(kind,requirements.abilityDieSides,input.options)
    const roll=createBreedingRollRecordFromInjectedValues({ schemaVersion:1,rollRecordId:rollRecordId(input.command.operationId,ordinal),operationId:input.command.operationId,
      commandSha256:createBreedingOperationCommandHash(input.command),operationRollOrdinal:ordinal,purpose:definition.purpose,
      target:{kind:'breeding-project',projectId:initial.project.projectId,revision:initial.project.revision},formula:definition.formula,dieCount:definition.dieCount,
      dieSides:definition.dieSides,ordered:definition.ordered,modifier:kind==='hatch-duration'?49:0,values,generatorId:'server-rng-v1',sourceDefinitionHashes:requirements.sourceDefinitionHashes,
      generatedAtCampaignMinute:input.readSet.capturedAtCampaignMinute })
    input.database.withTransaction(()=>repository.insert({command:input.command,roll}))
  }
}
const coordinatorFor = (options:ProduceBreedingProjectEggOptions): {readonly database:RotomDatabase,readonly coordinator:BreedingTransactionCoordinator} => {
  const database=options.database??options.coordinator?.database??getRotomDatabase()
  if(options.coordinator&&options.coordinator.database!==database)return fail('breeding.egg-production.repository-mismatch','Coordinator and Egg-production use case must share one database connection.')
  return Object.freeze({database,coordinator:options.coordinator??createBreedingTransactionCoordinator({database})})
}
const audienceTargets = (project:BreedingProjectDocumentV1) => {
  const participating=[...new Set(project.parentRefs.map(parent=>parent.ownerTrainerSlug).filter(owner=>owner!==project.ownerTrainerSlug))].sort()
  return Object.freeze([{audience:'diagnostic' as const,trainerSheetSlug:null},{audience:'gm' as const,trainerSheetSlug:null},{audience:'owner' as const,trainerSheetSlug:project.ownerTrainerSlug},...participating.map(trainerSheetSlug=>({audience:'participating-owner' as const,trainerSheetSlug})),{audience:'public' as const,trainerSheetSlug:null}])
}
const eggAudienceTargets = (project:BreedingProjectDocumentV1) => Object.freeze(audienceTargets(project).filter(target=>target.audience!=='participating-owner'))
const resultProjection = (input:{readonly database:RotomDatabase,readonly execution:BreedingTransactionExecutionDecision,readonly command:BreedingOperationCommandV1,readonly audience:'gm'|'owner'}):ProduceBreedingProjectEggResultV1 => {
  const project=createSqliteBreedingProjectRepository(input.database).get(input.command.payload.projectId)
  const egg=createSqlitePokemonEggRepository(input.database).get(input.command.payload.eggId)
  const projection=project&&egg&&project.status==='egg-produced'?projectBreedingEggProductionV1({project,egg,audience:input.audience}):null
  return Object.freeze({execution:input.execution,project,egg,projection})
}
export const produceBreedingProjectEgg = (inputValue:unknown, options:ProduceBreedingProjectEggOptions):ProduceBreedingProjectEggResultV1 => {
  const parsed=strictInput(inputValue)
  const command=parseBreedingOperationCommandV1(parsed.command)
  if(command.commandKind!=='produce-egg')return fail('breeding.egg-production.wrong-command','Egg-production use case accepts only produce-egg.')
  const readSet=validateBreedingOperationReadSetCompleteness(command,parsed.readSet)
  const receipt=parseAuthoritativeBreedingAuthorizationReceiptV1(parsed.authorizationReceipt)
  const commandSha256=createBreedingOperationCommandHash(command)
  if(!receipt.authorized||receipt.reasonId!=='breeding.authorization.authorized'||receipt.operationId!==command.operationId||receipt.commandSha256!==commandSha256
    ||receipt.commandKind!==command.commandKind||receipt.readSetDefinitionSha256!==readSet.definitionSha256||receipt.evaluatedAtCampaignMinute!==readSet.capturedAtCampaignMinute) {
    return fail('breeding.egg-production.invalid-authority','Egg production requires one exact authorized receipt and complete read set.')
  }
  const {database,coordinator}=coordinatorFor(options)
  const operations=createSqliteBreedingOperationRepository(database)
  const reservation=database.withTransaction(()=>operations.reserve(command,readSet.capturedAtCampaignMinute))
  if(reservation.kind==='exact-retry') {
    if(!exactEvidence(database,command,readSet,receipt))return fail('breeding.egg-production.invalid-authority','Terminal Egg operation is missing or disagrees with immutable authority evidence.')
  } else if(reservation.kind==='reserved'||options.resumePending===true) {
    try { prepareAuthorityAndRolls({database,parsed,command,readSet,receipt,options}) }
    catch (error) {
      if (!(error instanceof BreedingProductionSnapshotAuthorityError)
        && !(error instanceof BreedingOffspringProductionAuthorityError)
        && !(error instanceof BreedingEggProductionAuthorityError)
        && !(error instanceof ProduceBreedingProjectEggError && error.code==='breeding.egg-production.invalid-authority')) throw error
    }
  }
  const shouldResume=reservation.kind==='reserved'||options.resumePending===true
  const execution=coordinator.execute({command,createdAtCampaignMinute:readSet.capturedAtCampaignMinute,settledAtCampaignMinute:readSet.capturedAtCampaignMinute,
    ...(shouldResume?{resumePending:true}:{}),execute:(canonical,_operation,context)=>{
      const hash=createBreedingOperationCommandHash(canonical)
      const project=context.repositories.projects.get(canonical.payload.projectId)
      const check=project?context.repositories.checkLedger.getCheckByProject(project.projectId):null
      const clock=context.repositories.campaignClock.get()
      const existingEgg=context.repositories.eggs.get(canonical.payload.eggId)
      const evidence=context.repositories.operationEvidence.get(canonical.operationId)
      if(!project||!check)return createBreedingOperationRejectedV1({operationId:canonical.operationId,commandHash:hash,commandKind:canonical.commandKind,reasonId:'breeding.operation.not-found',currentAggregateRefs:[],conflictingScopes:canonical.scopes})
      if(existingEgg||!clockMatches(readSet,clock)||project.status!=='ready-to-produce'||project.revision!==canonical.scopes.find(scope=>scope.kind==='breeding-project')?.expectedRevision
        ||readResource(readSet,'breeding-project',project.projectId)?.definitionSha256!==breedingProjectDocumentDefinitionSha256(project)) {
        return createBreedingOperationRejectedV1({operationId:canonical.operationId,commandHash:hash,commandKind:canonical.commandKind,reasonId:'breeding.operation.stale-revision',currentAggregateRefs:[{kind:'breeding-project',id:project.projectId,revision:project.revision}],conflictingScopes:canonical.scopes})
      }
      if(!evidence||stableJsonStringify(evidence.readSet)!==stableJsonStringify(readSet)||stableJsonStringify(evidence.authorizationReceipt)!==stableJsonStringify(receipt)
        ||!currentConsent({project,evidence:parsed.consentEvidence,at:readSet.capturedAtCampaignMinute,get:id=>context.repositories.consents.get(id)})) {
        return createBreedingOperationRejectedV1({operationId:canonical.operationId,commandHash:hash,commandKind:canonical.commandKind,reasonId:'breeding.operation.unauthorized',currentAggregateRefs:[{kind:'breeding-project',id:project.projectId,revision:project.revision}],conflictingScopes:canonical.scopes})
      }
      let offers:readonly BreedingOptionOfferRecordV1[]
      try { offers=selectedOffersCurrent({projectId:project.projectId,optionIds:canonical.payload.resolutions.selectedOptionIds,readSet,receipt,find:value=>context.repositories.optionOffers.findByProjectOptionIds(value)}) }
      catch (error) {
        if (error instanceof ProduceBreedingProjectEggError && error.code==='breeding.egg-production.invalid-authority') {
          return createBreedingOperationRejectedV1({operationId:canonical.operationId,commandHash:hash,commandKind:canonical.commandKind,reasonId:'breeding.operation.unauthorized',currentAggregateRefs:[{kind:'breeding-project',id:project.projectId,revision:project.revision}],conflictingScopes:canonical.scopes})
        }
        throw error
      }
      let snapshot,resolution,planned
      try {
        snapshot=createBreedingProductionSnapshotV1({project,check,command:canonical,readSet,authorizationReceipt:receipt,campaignOptionSnapshot:parsed.campaignOptionSnapshot,
          parents:parsed.parents,breeder:parsed.breeder,breederAuthority:parsed.breederAuthority,providerSnapshot:parsed.providerSnapshot,consentEvidence:parsed.consentEvidence,
          roleOverride:parsed.roleOverride,roleOverrideEvidenceDefinitionSha256:parsed.roleOverrideEvidenceDefinitionSha256})
        if (snapshot.parents.some(parent => context.repositories.sheets.getByRef('pokemon', parent.pokemonSheetSlug)?.revision !== parent.sheetRevision)
          || context.repositories.sheets.getByRef('trainer', snapshot.breeder.trainerSheetSlug)?.revision !== snapshot.breeder.sheetRevision) {
          throw new BreedingEggProductionAuthorityError('breeding.egg-production.stale-authority', 'Parent or Breeder sheet revision changed before Egg settlement.')
        }
        const rolls=context.repositories.rolls.listByOperation(canonical.operationId)
        resolution=planBreedingOffspringResolutionV1({productionSnapshot:snapshot,command:canonical,rolls,offers,roleOverride:parsed.roleOverride,roleOverrideEvidenceDefinitionSha256:parsed.roleOverrideEvidenceDefinitionSha256})
        planned=planBreedingEggProductionV1({project,productionSnapshot:snapshot,offspringResolution:resolution.record,command:canonical,campaignClock:clock,
          hatchDurationRoll:rolls.find(roll=>roll.purpose==='hatch-duration-percentage')??null})
      } catch(error) {
        if(error instanceof BreedingProductionSnapshotAuthorityError||error instanceof BreedingOffspringProductionAuthorityError||error instanceof BreedingEggProductionAuthorityError) {
          const reasonId=error.code.includes('stale')?'breeding.operation.stale-revision' as const:error.code.includes('unavailable')||error.code.includes('unsupported')?'breeding.operation.unavailable' as const:'breeding.operation.unauthorized' as const
          return createBreedingOperationRejectedV1({operationId:canonical.operationId,commandHash:hash,commandKind:canonical.commandKind,reasonId,currentAggregateRefs:[{kind:'breeding-project',id:project.projectId,revision:project.revision}],conflictingScopes:canonical.scopes})
        }
        throw error
      }
      for(const successor of resolution.consumedOffers) {
        const replaced=context.repositories.optionOffers.replace({expectedRevision:0,record:successor})
        if(replaced.kind!=='applied')throw new Error('Selected Breeding offer changed inside the Egg-production transaction.')
      }
      context.repositories.eggs.insert(planned.egg)
      const replacement=context.repositories.projects.replace({expectedRevision:project.revision,document:planned.project})
      if(replacement.kind!=='applied')throw new Error('Breeding Project changed inside the Egg-production transaction.')
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({aggregateKind:'breeding-project',aggregateId:planned.project.projectId,revision:planned.project.revision,operationKind:canonical.commandKind,audienceTargets:audienceTargets(planned.project),campaignProjectionKey:options.campaignProjectionKey,timestamp:options.realtimeTimestamp}))
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({aggregateKind:'pokemon-egg',aggregateId:planned.egg.eggId,revision:planned.egg.revision,operationKind:canonical.commandKind,audienceTargets:eggAudienceTargets(planned.project),campaignProjectionKey:options.campaignProjectionKey,timestamp:options.realtimeTimestamp}))
      return createBreedingOperationAcceptedV1({operationId:canonical.operationId,commandHash:hash,commandKind:canonical.commandKind,outcomeKind:'egg-produced',aggregateRefs:[{kind:'breeding-project',id:planned.project.projectId,revision:planned.project.revision},{kind:'pokemon-egg',id:planned.egg.eggId,revision:planned.egg.revision}],changedScopes:canonical.scopes,committedAtCampaignMinute:clock.campaignMinute})
    },...(options.beforeSettle?{beforeSettle:options.beforeSettle}:{})})
  if(execution.kind!=='pending'&&!exactEvidence(database,command,readSet,receipt))return fail('breeding.egg-production.invalid-authority','Terminal Egg operation lost immutable authority evidence.')
  return resultProjection({database,execution,command,audience:parsed.audience})
}
