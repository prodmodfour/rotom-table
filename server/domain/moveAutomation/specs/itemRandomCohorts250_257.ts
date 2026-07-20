import type { MoveSpec, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { ITEM_RANDOM_250_257_HANDLER_ID } from '../handlers/itemRandom250_257'
import { areaTargeting, createReviewedMoveSpec, multiTargeting, selfTargeting, singleTargeting } from './reviewedSpecBuilder'

export const MA_250_257_MOVE_NAMES = Object.freeze([
  'Strength','Superpower','Surf','Surging Strikes','Triple Arrows','Twister','Volt Switch','Volt Tackle',
  'Whirlwind','Wicked Blow','Wild Charge','Wood Hammer',
  'Acrobatics','Bestow','Corrosive Gas','Covet','Embargo','Fling','Incinerate','Multi-Attack',
  'Natural Gift','Pay Day','Pluck','Poltergeist','Power Trick','Recycle','Spectral Thief','Stuff Cheeks',
  'Switcheroo','Techno Blast','Thief','Trick','Trick-or-Treat',
  'Assist','Charge Beam','Copycat','Dire Claw','Eerie Spell','Encore','Fissure','Guillotine',
  'Hidden Power','Horn Drill','Last Resort','Magnitude','Mimic','Mirror Move','Nature Power','Present',
  'Role Play','Sheer Cold','Sketch','Skill Swap','Sleep Talk','Telekinesis','Transform','Tri Attack',
] as const)
export type ItemRandomCohort250257MoveName=(typeof MA_250_257_MOVE_NAMES)[number]
const SELF=new Set(['Power Trick','Recycle','Stuff Cheeks','Assist','Hidden Power','Sleep Talk'])
const AREA=new Set(['Surf','Twister','Whirlwind','Corrosive Gas','Incinerate','Poltergeist','Hidden Power','Magnitude'])
const MULTI:Record<string,number>={'Surging Strikes':3,'Triple Arrows':3,Trick:2}
const targeting=(n:string):MoveSpecTargetingDeclaration=>MULTI[n]?multiTargeting(1,MULTI[n]!):AREA.has(n)?areaTargeting():SELF.has(n)?selfTargeting():singleTargeting()
const specs=Object.fromEntries(MA_250_257_MOVE_NAMES.map(canonicalId=>[canonicalId,createReviewedMoveSpec({canonicalId,targeting:targeting(canonicalId),operations:[],registeredHandlerId:ITEM_RANDOM_250_257_HANDLER_ID,tags:['item-random-context','reviewed']})])) as Record<ItemRandomCohort250257MoveName,MoveSpec>
export const ITEM_RANDOM_COHORTS_250_257_MOVE_SPEC_REGISTRATIONS:readonly MoveSpecV2Registration[]=Object.freeze(MA_250_257_MOVE_NAMES.map(canonicalId=>Object.freeze({canonicalId,sourceModule:'server/domain/moveAutomation/specs/itemRandomCohorts250_257.ts',spec:specs[canonicalId]})))
