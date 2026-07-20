import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import { ITEM_RANDOM_250_257_HANDLER_REGISTRATION } from '~~/server/domain/moveAutomation/handlers/itemRandom250_257'
import { REGISTERED_MOVE_HANDLER_REGISTRY, validateRegisteredMoveHandlerOutput } from '~~/server/domain/moveAutomation/handlers/registry'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { ITEM_RANDOM_COHORTS_250_257_MOVE_SPEC_REGISTRATIONS, MA_250_257_MOVE_NAMES, type ItemRandomCohort250257MoveName } from '~~/server/domain/moveAutomation/specs/itemRandomCohorts250_257'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { MA_250_257_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/itemRandomCohorts250_257'

const history = ['Tackle','Scratch','Growl','Ember','Water Gun'].map((canonicalId,index)=>({canonicalId,resolutionId:`resolution.${index}`}))
const context={map:{voxels:[],initiative:{round:2}},actor:{placement:{id:'actor',sheetSlug:'actor',position:{x:0,y:0,z:0}},token:{level:20,abilityNames:['Blaze']}},candidatePlacements:[],selectedPlacements:[{id:'target',position:{x:1,y:0,z:0}}],resolvedSheets:[],ruleset:{},reads:{recordPlacement:()=>undefined},queries:{tokens:{get:()=>({level:10,abilityNames:['Pressure']})},targetStates:{resolve:(id:string)=>({conditionIds:id==='actor'?['sleep']:[],itemIds:[],semiInvulnerable:'none'})},history:{lastCompletedMove:()=>({canonicalId:'Tackle',resolutionId:'resolution.0'}),completedMovesThisScene:()=>history}}}
const run=(moveName:string)=>validateRegisteredMoveHandlerOutput(ITEM_RANDOM_250_257_HANDLER_REGISTRATION.run({...context,intent:{moveName}} as never))

describe('MA-250 through MA-257 items, random tables, and copied moves',()=>{
  it('registers exactly 57 reviewed definitions with matching hashes',()=>{
    expect(ITEM_RANDOM_COHORTS_250_257_MOVE_SPEC_REGISTRATIONS.map(value=>value.canonicalId)).toEqual(MA_250_257_MOVE_NAMES)
    expect(new Set(MA_250_257_MOVE_NAMES).size).toBe(57)
    for(const registration of ITEM_RANDOM_COHORTS_250_257_MOVE_SPEC_REGISTRATIONS){const name=registration.canonicalId as ItemRandomCohort250257MoveName,row=manifestJson.moves.find(value=>value.canonicalId===name)!;const definition=validateMoveSpec(registration.spec,{capabilityIds:row.capabilityTags,rulesetVersion:row.rulesProvenance,handlerRegistry:REGISTERED_MOVE_HANDLER_REGISTRY});expect(row.runtime.definitionHash).toBe(definition.definitionHash);expect(row.baseStatus).toBe('complete');expect(row.scenarioIds).toEqual(MA_250_257_SCENARIOS_BY_MOVE[name].map(value=>value.scenarioId));expect(registeredMoveAutomationRuntimeFor(name)?.definitionHash).toBe(definition.definitionHash)}
  })
  it('emits strict operation programs for the full cohort',()=>{for(const name of MA_250_257_MOVE_NAMES){expect(()=>run(name),name).not.toThrow();expect(run(name).operations.length,name).toBeGreaterThan(0)}})
  it('encodes item authority and weighted random outcomes',()=>{
    expect(run('Covet').operations).toEqual(expect.arrayContaining([expect.objectContaining({id:'covet.steal-held',kind:'item',payload:expect.objectContaining({action:'steal'})})]))
    expect(run('Embargo').operations).toEqual(expect.arrayContaining([expect.objectContaining({id:'embargo.suppress-items',payload:expect.objectContaining({action:'suppress',scope:'all-equipped'})})]))
    expect(run('Magnitude').operations).toEqual(expect.arrayContaining([expect.objectContaining({id:'magnitude.outcome-table',kind:'roll'}),expect.objectContaining({id:'magnitude.damage-6',payload:expect.objectContaining({damageBase:11})})]))
    expect(run('Fissure').operations).toEqual(expect.arrayContaining([expect.objectContaining({id:'fissure.execute-table',kind:'roll'}),expect.objectContaining({id:'fissure.execute',kind:'direct-hp'})]))
  })
  it('encodes nested reviewed moves, permanent Sketch, and ability overlays',()=>{
    expect(run('Copycat').operations).toEqual(expect.arrayContaining([expect.objectContaining({kind:'nested-move',payload:expect.objectContaining({canonicalId:'Tackle'})})]))
    expect(run('Sketch').operations).toEqual(expect.arrayContaining([expect.objectContaining({id:'sketch.replace-self',kind:'permanent-move-list'})]))
    expect(run('Role Play').operations).toEqual(expect.arrayContaining([expect.objectContaining({kind:'temporary-effect',payload:expect.objectContaining({definition:expect.objectContaining({payload:expect.objectContaining({domain:'ability',values:['Pressure']})})})})]))
  })
})
