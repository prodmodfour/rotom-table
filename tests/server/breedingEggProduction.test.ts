import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import authorityJson from '../fixtures/breeding/egg-production-authority-v1.json'
import crossOwnerAuthorityJson from '../fixtures/breeding/egg-production-cross-owner-authority-v1.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingReadResourceV1 } from '../../shared/breeding/readSets'
import { parseBreedingEggProductionProjectionV1 } from '../../shared/breeding/eggProduction'
import { createBreedingAuthorizationReceiptV1 } from '../../server/domain/breeding/authorization'
import { createBreedingConsentRecordV1, createBreedingOptionOfferRecordV1, createBreedingRollRecordFromInjectedValues } from '../../server/domain/breeding/ledgers'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { createBreedingOperationReadSetV1 } from '../../server/domain/breeding/readSets'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingCheckLedgerRepository } from '../../server/storage/breedingCheckLedgerRepository'
import { createSqliteBreedingConsentRepository } from '../../server/storage/breedingConsentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../../server/storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../../server/storage/breedingOptionOfferRepository'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { createSqliteBreedingRollRepository } from '../../server/storage/breedingRollRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import {
  ProduceBreedingProjectEggError,
  produceBreedingProjectEgg,
} from '../../server/useCases/produceBreedingProjectEgg'

const authority = authorityJson as any
const crossOwnerAuthority = crossOwnerAuthorityJson as any
const ruleset = rulesetJson as { readonly rulesetId:string, readonly definitionSha256:string }
const databases:RotomDatabase[]=[]
const tempRoots:string[]=[]
afterEach(()=>{while(databases.length)databases.pop()?.close();while(tempRoots.length)rmSync(tempRoots.pop()!,{recursive:true,force:true})})
const op=(value:number):string=>`breeding-operation:v1:${value.toString(16).padStart(32,'0')}`
const resolveCommand=parseBreedingOperationCommandV1({
  schemaVersion:1,
  operationId:op(9),
  commandKind:'resolve-breeding-check',
  actor:{profileId:'profile_owner_0001',selectedTrainerSlug:'trainer-owner'},
  ruleset:{rulesetId:ruleset.rulesetId,definitionSha256:ruleset.definitionSha256},
  scopes:[{kind:'breeding-project',projectId:authority.project.projectId,expectedRevision:0}],
  payload:{projectId:authority.project.projectId,checkRecordId:authority.check.checkRecordId},
})
const seed=(path=':memory:',facts:any=authority):RotomDatabase=>{
  const database=openRotomDatabase({path,enableWal:path!==':memory:'});databases.push(database)
  const checkRoll=createBreedingRollRecordFromInjectedValues({
    schemaVersion:1,
    rollRecordId:facts.check.rollRecordId,
    operationId:resolveCommand.operationId,
    commandSha256:createBreedingOperationCommandHash(resolveCommand),
    operationRollOrdinal:0,
    purpose:'breeder-check-d20',
    target:{kind:'breeding-project',projectId:facts.project.projectId,revision:0},
    formula:'1d20',dieCount:1,dieSides:20,ordered:false,modifier:0,values:[facts.check.dieTotal],
    generatorId:'server-rng-v1',sourceDefinitionHashes:[ruleset.definitionSha256],generatedAtCampaignMinute:facts.check.resolvedAtCampaignMinute,
  })
  database.withTransaction(()=>{
    database.connection.prepare(`
      INSERT INTO breeding_operations (
        operation_id, command_sha256, command_kind, command_json, status,
        result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
      ) VALUES (?, ?, 'advance-breeding-project-time', '{}', 'pending', NULL, NULL, 600, NULL)
    `).run(op(8),'8'.repeat(64))
    createSqliteBreedingOperationRepository(database).reserve(resolveCommand,300)
    database.connection.prepare(`
      INSERT INTO breeding_projects (
        project_id, document_json, revision, status, owner_trainer_slug, breeder_trainer_slug,
        parent_a_slug, parent_b_slug, produced_egg_id, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(facts.project.projectId,JSON.stringify(facts.project),facts.project.revision,facts.project.status,
      facts.project.ownerTrainerSlug,facts.project.breederTrainerSlug,facts.project.parentRefs[0].pokemonSheetSlug,
      facts.project.parentRefs[1].pokemonSheetSlug,facts.project.producedEggId,facts.project.lastOperationId,
      facts.project.createdAtCampaignMinute,facts.project.updatedAtCampaignMinute)
    const ledger=createSqliteBreedingCheckLedgerRepository(database)
    ledger.insertRoll({command:resolveCommand,roll:checkRoll})
    ledger.insertCheck({command:resolveCommand,check:facts.check,roll:checkRoll})
    database.connection.prepare('UPDATE campaign_clock SET revision=3,campaign_minute=600,last_operation_id=? WHERE singleton=1').run(op(8))
    for(const [kind,slug,revision] of [
      ['pokemon',facts.parents[0].pokemonSheetSlug,facts.parents[0].sheetRevision],
      ['pokemon',facts.parents[1].pokemonSheetSlug,facts.parents[1].sheetRevision],
      ['trainer',facts.breeder.trainerSheetSlug,facts.breeder.sheetRevision],
    ] as const) database.connection.prepare('INSERT INTO sheets (kind,slug,document_json,revision,updated_at) VALUES (?, ?, ?, ?, 600)').run(kind,slug,JSON.stringify({slug,folder:''}),revision)
  })
  return database
}
const requestFor=(facts:any,overrides:Record<string,unknown>={})=>({
  command:facts.command,
  readSet:facts.readSet,
  authorizationReceipt:facts.authorizationReceipt,
  campaignOptionSnapshot:facts.campaignOptionSnapshot,
  parents:facts.parents,
  breeder:facts.breeder,
  breederAuthority:facts.breederAuthority,
  providerSnapshot:facts.providerSnapshot,
  consentEvidence:facts.consentEvidence,
  roleOverride:facts.roleOverride,
  roleOverrideEvidenceDefinitionSha256:facts.roleOverrideEvidenceDefinitionSha256,
  audience:'owner',
  ...overrides,
})
const request=(overrides:Record<string,unknown>={})=>requestFor(authority,overrides)
const draws=()=>({
  drawOffspringFamilyD20:vi.fn(()=>5),
  drawNatureD6:vi.fn(()=>1),
  drawAbilityIndex:vi.fn((_maximum:number)=>1),
  drawGenderD100:vi.fn(()=>13),
})
const options=(database:RotomDatabase, draw=draws())=>({database,campaignProjectionKey:'k'.repeat(32),realtimeTimestamp:1_700_000_000_000,...draw})
const CHOICE_OPTION_ID='option:v1:00000000000000000000000000000001'
const CHOICE_OFFER_ID='breeding-offer:v1:00000000000000000000000000000001'
const ISSUANCE_OPERATION_ID=op(30)
const choiceAuthority=()=>{
  const command=parseBreedingOperationCommandV1({
    ...authority.command,
    payload:{...authority.command.payload,resolutions:{selectedOptionIds:[CHOICE_OPTION_ID],requestedRollKinds:['offspring-family','nature','gender']}},
  })
  const offer=createBreedingOptionOfferRecordV1({
    schemaVersion:1,offerId:CHOICE_OFFER_ID as never,choiceKind:'ability',target:{kind:'breeding-project',projectId:authority.project.projectId,revision:2},
    chooserProfileId:'profile_owner_0001',minimumPokemonEducationRank:'Expert',options:[{optionId:CHOICE_OPTION_ID as never,kind:'ability',canonicalValueId:'overgrow',
      valueDefinitionSha256:authority.parents[0].speciesSpecDefinitionSha256,authorityEvidenceIds:['breeding-offer-authority:ability:overgrow']}],
    issuedOperationId:ISSUANCE_OPERATION_ID as never,issuedCommandSha256:'e'.repeat(64),issuedAtCampaignMinute:590,expiresAtCampaignMinute:650,
  })
  const readSet=createBreedingOperationReadSetV1({
    ...authority.readSet,
    commandSha256:createBreedingOperationCommandHash(command),
    resources:[...authority.readSet.resources,parseBreedingReadResourceV1({resourceKind:'breeding-offer',resourceId:offer.offerId,existence:'present',revision:0,definitionSha256:offer.definitionSha256,observedCampaignMinute:null,purposes:['mechanics']})],
  })
  const receipt=createBreedingAuthorizationReceiptV1({
    ...authority.authorizationReceipt,
    commandSha256:createBreedingOperationCommandHash(command),
    readSetDefinitionSha256:readSet.definitionSha256,
    evidenceDefinitionHashes:[...authority.authorizationReceipt.evidenceDefinitionHashes,offer.definitionSha256],
  })
  return {command,offer,readSet,receipt}
}
const seedCrossOwnerConsent=(database:RotomDatabase):void=>{
  const evidence=crossOwnerAuthority.consentEvidence[0]
  const command=parseBreedingOperationCommandV1({
    schemaVersion:1,operationId:op(21),commandKind:'grant-breeding-consent',
    actor:{profileId:'profile_other_0001',selectedTrainerSlug:'trainer-other'},ruleset:crossOwnerAuthority.command.ruleset,
    scopes:[{kind:'breeding-project',projectId:crossOwnerAuthority.project.projectId,expectedRevision:2},{kind:'parent-consent',consentId:evidence.consentId,expectedRevision:null}],
    payload:{projectId:crossOwnerAuthority.project.projectId,consentId:evidence.consentId,parentSheetSlug:evidence.parentSheetSlug,parentSheetRevision:evidence.parentSheetRevision,consentScopes:[...BREEDING_CONSENT_SCOPES].sort(),expiresAtCampaignMinute:evidence.expiresAtCampaignMinute},
  })
  const record=createBreedingConsentRecordV1({
    schemaVersion:1,consentId:evidence.consentId,projectId:evidence.projectId,parentSheetSlug:evidence.parentSheetSlug,parentSheetRevision:evidence.parentSheetRevision,
    ownerTrainerSlug:evidence.ownerTrainerSlug,consentingProfileId:evidence.consentingProfileId,scopes:[...BREEDING_CONSENT_SCOPES].sort() as never,
    grantedAtCampaignMinute:500,expiresAtCampaignMinute:evidence.expiresAtCampaignMinute,grantOperationId:command.operationId,grantCommandSha256:createBreedingOperationCommandHash(command),
  })
  expect(record.definitionSha256).toBe(evidence.consentRecordDefinitionSha256)
  database.withTransaction(()=>{createSqliteBreedingOperationRepository(database).reserve(command,500);createSqliteBreedingConsentRepository(database).insert(record)})
}
const seedChoice=(database:RotomDatabase, choice:ReturnType<typeof choiceAuthority>):void=>database.withTransaction(()=>{
  database.connection.prepare(`
    INSERT INTO breeding_operations (
      operation_id, command_sha256, command_kind, command_json, status,
      result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) VALUES (?, ?, 'preview-breeding', '{}', 'pending', NULL, NULL, 590, NULL)
  `).run(ISSUANCE_OPERATION_ID,'e'.repeat(64))
  createSqliteBreedingOptionOfferRepository(database).insert(choice.offer)
})

describe('atomic Breeding Project Egg production',()=>{
  it('persists rolls before reduction and atomically inserts one immutable Egg with the terminal Project transition',()=>{
    const database=seed();const random=draws()
    const result=produceBreedingProjectEgg(request(),options(database,random))
    expect(result.execution.kind).toBe('executed')
    expect(result.execution.record.result).toMatchObject({ok:true,outcomeKind:'egg-produced'})
    expect(result.project).toMatchObject({revision:3,status:'egg-produced',producedEggId:authority.command.payload.eggId,timeline:{eggProducedAtCampaignMinute:600}})
    expect(result.egg).toMatchObject({
      revision:0,status:'incubating',ownerTrainerSlug:'trainer-owner',source:{kind:'breeding',projectId:authority.project.projectId},
      offspring:{speciesId:'bulbasaur',nature:{valueId:'cuddly'},ability:{valueId:'chlorophyll'},gender:{valueId:'male'},startingLevel:1},
      incubation:{accumulatedCampaignMinutes:0,lastAppliedClockRevision:3,lastAppliedClockMinute:600,paused:false},
      special:{state:'not-rolled',automaticShiny:false},createdAtCampaignMinute:600,lastOperationId:authority.command.operationId,
    })
    expect(result.egg!.incubation.targetCampaignMinutes).toBeGreaterThan(0)
    expect(result.egg!.definitionHashes).toContain(result.egg!.offspring.definitionSha256)
    expect(result.projection).toEqual({schemaVersion:1,audience:'owner',status:'egg-produced',eggId:authority.command.payload.eggId,eggRevision:0,projectRevision:3,producedAtCampaignMinute:600,sourceKind:'breeding',incubationStatus:'incubating'})
    expect(parseBreedingEggProductionProjectionV1(result.projection)).toEqual(result.projection)
    expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toHaveLength(4)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(authority.command.operationId)).not.toBeNull()
    expect(result.execution.committedRealtimeEvents).toHaveLength(8)
    expect(random.drawOffspringFamilyD20).toHaveBeenCalledTimes(1)
    expect(random.drawNatureD6).toHaveBeenCalledTimes(2)
    expect(random.drawAbilityIndex).toHaveBeenCalledWith(2)
    expect(random.drawGenderD100).toHaveBeenCalledTimes(1)
  })

  it('returns exact retry without rerolling, revising aggregates, or republishing',()=>{
    const database=seed();const firstDraws=draws()
    const first=produceBreedingProjectEgg(request(),options(database,firstDraws))
    const forbidden={drawOffspringFamilyD20:vi.fn(()=>{throw new Error('redraw')}),drawNatureD6:vi.fn(()=>{throw new Error('redraw')}),drawAbilityIndex:vi.fn(()=>{throw new Error('redraw')}),drawGenderD100:vi.fn(()=>{throw new Error('redraw')})}
    const retry=produceBreedingProjectEgg(request(),options(database,forbidden))
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.execution.record.result).toEqual(first.execution.record.result)
    expect(retry.project).toEqual(first.project);expect(retry.egg).toEqual(first.egg)
    expect(retry.execution.committedRealtimeEvents).toEqual([])
    expect(Object.values(forbidden).every(draw=>draw.mock.calls.length===0)).toBe(true)
  })

  it('keeps authority and every persisted roll for explicit recovery when phase 2 rolls back',()=>{
    const database=seed();const random=draws()
    expect(()=>produceBreedingProjectEgg(request(),{...options(database,random),beforeSettle:()=>{throw new Error('injected rollback')}})).toThrow(/injected rollback/)
    expect(createSqliteBreedingProjectRepository(database).get(authority.project.projectId)).toEqual(authority.project)
    expect(createSqlitePokemonEggRepository(database).get(authority.command.payload.eggId)).toBeNull()
    expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toHaveLength(4)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(authority.command.operationId)).not.toBeNull()
    expect(createSqliteBreedingOperationRepository(database).get(authority.command.operationId)?.status).toBe('pending')
    expect((database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as {count:number}).count).toBe(0)
    const forbidden={drawOffspringFamilyD20:vi.fn(()=>{throw new Error('redraw')}),drawNatureD6:vi.fn(()=>{throw new Error('redraw')}),drawAbilityIndex:vi.fn(()=>{throw new Error('redraw')}),drawGenderD100:vi.fn(()=>{throw new Error('redraw')})}
    const recovered=produceBreedingProjectEgg(request(),{...options(database,forbidden),resumePending:true})
    expect(recovered.execution.kind).toBe('executed');expect(recovered.egg?.status).toBe('incubating')
    expect(Object.values(forbidden).every(draw=>draw.mock.calls.length===0)).toBe(true)
  })

  it('consumes a selected rank-bounded offer in the same transaction as Egg and Project writes',()=>{
    const database=seed();const choice=choiceAuthority();seedChoice(database,choice);const random=draws()
    const choiceRequest=request({command:choice.command,readSet:choice.readSet,authorizationReceipt:choice.receipt})
    const result=produceBreedingProjectEgg(choiceRequest,options(database,random))
    expect(result.execution.record.result).toMatchObject({ok:true,outcomeKind:'egg-produced'})
    expect(result.egg?.offspring.ability).toMatchObject({valueId:'overgrow',resolutionKind:'rank-choice',rollRecordId:null,optionId:CHOICE_OPTION_ID})
    expect(createSqliteBreedingRollRepository(database).listByOperation(choice.command.operationId)).toHaveLength(3)
    expect(createSqliteBreedingOptionOfferRepository(database).get(CHOICE_OFFER_ID)).toMatchObject({revision:1,status:'consumed',selectedOptionId:CHOICE_OPTION_ID,settlementOperationId:choice.command.operationId})
    expect(random.drawAbilityIndex).not.toHaveBeenCalled()
  })

  it('rolls back offer consumption together with the Egg and Project, then recovers without rerolling',()=>{
    const database=seed();const choice=choiceAuthority();seedChoice(database,choice);const choiceRequest=request({command:choice.command,readSet:choice.readSet,authorizationReceipt:choice.receipt})
    expect(()=>produceBreedingProjectEgg(choiceRequest,{...options(database),beforeSettle:()=>{throw new Error('choice rollback')}})).toThrow(/choice rollback/)
    expect(createSqliteBreedingOptionOfferRepository(database).get(CHOICE_OFFER_ID)).toMatchObject({revision:0,status:'active'})
    expect(createSqlitePokemonEggRepository(database).get(choice.command.payload.eggId)).toBeNull()
    expect(createSqliteBreedingProjectRepository(database).get(authority.project.projectId)).toEqual(authority.project)
    const forbidden={drawOffspringFamilyD20:vi.fn(()=>{throw new Error('redraw')}),drawNatureD6:vi.fn(()=>{throw new Error('redraw')}),drawAbilityIndex:vi.fn(()=>{throw new Error('redraw')}),drawGenderD100:vi.fn(()=>{throw new Error('redraw')})}
    const recovered=produceBreedingProjectEgg(choiceRequest,{...options(database,forbidden),resumePending:true})
    expect(recovered.egg?.offspring.ability.valueId).toBe('overgrow')
    expect(createSqliteBreedingOptionOfferRepository(database).get(CHOICE_OFFER_ID)).toMatchObject({revision:1,status:'consumed'})
    expect(Object.values(forbidden).every(draw=>draw.mock.calls.length===0)).toBe(true)
  })

  it('preserves earlier persisted rolls when a later server random source fails and resumes without redrawing them',()=>{
    const database=seed();const family=vi.fn(()=>5);const nature=vi.fn(()=>{throw new Error('nature source down')})
    expect(()=>produceBreedingProjectEgg(request(),{...options(database),drawOffspringFamilyD20:family,drawNatureD6:nature})).toThrow(/Nature d6.*threw/)
    expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toHaveLength(1)
    expect(family).toHaveBeenCalledTimes(1)
    const familyForbidden=vi.fn(()=>{throw new Error('family redraw')})
    const recovered=produceBreedingProjectEgg(request(),{...options(database),resumePending:true,drawOffspringFamilyD20:familyForbidden,drawNatureD6:()=>1,drawAbilityIndex:()=>1,drawGenderD100:()=>13})
    expect(recovered.execution.record.result).toMatchObject({ok:true,outcomeKind:'egg-produced'})
    expect(familyForbidden).not.toHaveBeenCalled()
    expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toHaveLength(4)
  })

  it('revalidates current positive cross-owner consent transactionally without projecting private parent facts',()=>{
    const allowedDatabase=seed(':memory:',crossOwnerAuthority);seedCrossOwnerConsent(allowedDatabase)
    const allowed=produceBreedingProjectEgg(requestFor(crossOwnerAuthority),options(allowedDatabase))
    expect(allowed.execution.record.result).toMatchObject({ok:true,outcomeKind:'egg-produced'})
    expect(JSON.stringify(allowed.projection)).not.toMatch(/trainer-other|pokemon-parent|consent|profile|roll|hash|species|nature|ability|gender/iu)
    expect(allowed.execution.committedRealtimeEvents).toHaveLength(9)

    const deniedDatabase=seed(':memory:',crossOwnerAuthority);const random=draws()
    const denied=produceBreedingProjectEgg(requestFor(crossOwnerAuthority),options(deniedDatabase,random))
    expect(denied.execution.record.result).toMatchObject({ok:false,reasonId:'breeding.operation.unauthorized'})
    expect(denied.egg).toBeNull()
    expect(Object.values(random).every(draw=>draw.mock.calls.length===0)).toBe(true)
  })

  it('rejects stale parent sheets before drawing and creates no Egg',()=>{
    const database=seed();database.connection.prepare("UPDATE sheets SET revision=4 WHERE kind='pokemon' AND slug='pokemon-parent-b'").run()
    const random=draws();const result=produceBreedingProjectEgg(request(),options(database,random))
    expect(result.execution.record.result).toMatchObject({ok:false,reasonId:'breeding.operation.stale-revision'})
    expect(result.egg).toBeNull();expect(result.project).toEqual(authority.project)
    expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toEqual([])
    expect(Object.values(random).every(draw=>draw.mock.calls.length===0)).toBe(true)
  })

  it('rejects a stale campaign-clock read before drawing or creating lifecycle authority',()=>{
    const database=seed();database.connection.prepare('UPDATE campaign_clock SET revision=4,campaign_minute=601 WHERE singleton=1').run()
    const random=draws();const result=produceBreedingProjectEgg(request(),options(database,random))
    expect(result.execution.record.result).toMatchObject({ok:false,reasonId:'breeding.operation.stale-revision'})
    expect(result.egg).toBeNull();expect(result.project).toEqual(authority.project)
    expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toEqual([])
    expect(Object.values(random).every(draw=>draw.mock.calls.length===0)).toBe(true)
  })

  it('rejects malformed, enriched, accessor-backed, unauthorized, and wrong-command requests',()=>{
    const database=seed()
    expect(()=>produceBreedingProjectEgg({...request(),extra:true},options(database))).toThrow(/exactly the declared/)
    const accessor=request() as Record<string,unknown>;Object.defineProperty(accessor,'audience',{enumerable:true,get:()=> 'owner'})
    expect(()=>produceBreedingProjectEgg(accessor,options(database))).toThrow(/accessors/)
    expect(()=>produceBreedingProjectEgg({...request(),authorizationReceipt:{...authority.authorizationReceipt,authorized:false}},options(database))).toThrow()
    const wrong=parseBreedingOperationCommandV1({schemaVersion:1,operationId:op(40),commandKind:'advance-breeding-project-time',actor:authority.command.actor,ruleset:authority.command.ruleset,scopes:[{kind:'breeding-project',projectId:authority.project.projectId,expectedRevision:2}],payload:{projectId:authority.project.projectId,throughClockRevision:3,throughCampaignMinute:600}})
    expect(()=>produceBreedingProjectEgg({...request(),command:wrong},options(database))).toThrow(ProduceBreedingProjectEggError)
  })

  it('survives restart with one Egg, one Project successor, immutable rolls, and one terminal operation',()=>{
    const root=mkdtempSync(join(tmpdir(),'rotom-egg-production-'));tempRoots.push(root);const path=join(root,'campaign.sqlite')
    const first=seed(path);const produced=produceBreedingProjectEgg(request(),options(first));expect(produced.egg).not.toBeNull();databases.pop();first.close()
    const reopened=openRotomDatabase({path,enableWal:true});databases.push(reopened)
    expect(createSqlitePokemonEggRepository(reopened).get(authority.command.payload.eggId)).toEqual(produced.egg)
    expect(createSqliteBreedingProjectRepository(reopened).get(authority.project.projectId)).toEqual(produced.project)
    expect(createSqliteBreedingRollRepository(reopened).listByOperation(authority.command.operationId)).toHaveLength(4)
    expect(createSqliteBreedingOperationRepository(reopened).get(authority.command.operationId)?.result).toEqual(produced.execution.record.result)
  })
})
