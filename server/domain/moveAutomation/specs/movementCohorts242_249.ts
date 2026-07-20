import type { MoveSpec, MoveSpecCostDeclaration, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { MOVEMENT_242_249_HANDLER_ID } from '../handlers/movement242_249'
import {
  areaTargeting,
  automaticSetupExecuteCost,
  createReviewedMoveSpec,
  multiTargeting,
  selfTargeting,
  singleTargeting,
  standardActionCost,
} from './reviewedSpecBuilder'

export const MA_242_249_MOVE_NAMES = Object.freeze([
  'Avalanche', 'Baton Pass', 'Bounce', 'Brave Bird', 'Circle Throw', 'Close Combat', 'Cut', 'Defense Curl',
  'Dig', 'Dive', 'Double-Edge', 'Dragon Ascent', 'Dragon Rush', 'Dragon Tail', 'Earthquake', 'Endeavor',
  'Fairy Lock', 'False Swipe', 'First Impression', 'Flame Charge', 'Flare Blitz', 'Flip Turn', 'Fly', 'Flying Press',
  'Focus Energy', 'Freeze Shock', 'Giga Impact', 'Gust', 'Head Charge', 'Head Smash', 'Heal Block', 'Heat Crash',
  'Horn Leech', 'Hydro Pump', 'Hyperspace Hole', 'Ice Burn', 'Imprison', 'Ingrain', 'Lock-On', 'Mega Kick',
  'Megahorn', 'Meteor Mash', 'Muddy Water', 'No Retreat', 'Parting Shot', 'Power Shift', 'Psychic', 'Psycho Shift',
  'Rapid Spin', 'Razor Wind', 'Revenge', 'Roar', 'Roar of Time', 'Rock Wrecker', 'Rollout', 'Shift Gear',
  'Skitter Smack', 'Skull Bash', 'Sky Attack', 'Sky Drop', 'Slam', 'Splash', 'Steamroller', 'Steel Wing',
] as const)
export type MovementCohort242249MoveName = (typeof MA_242_249_MOVE_NAMES)[number]

const SELF = new Set<string>([
  'Baton Pass','Defense Curl','Fairy Lock','Focus Energy','Ingrain','No Retreat','Power Shift',
  'Rapid Spin','Shift Gear','Splash',
])
const AREA = new Set<string>([
  'Dig','Dive','Earthquake','Fairy Lock','Muddy Water','Razor Wind','Roar','Roar of Time',
])
const MULTI: Readonly<Record<string, number>> = { 'Hyperspace Hole': 3, 'Razor Wind': 3 }
const targeting = (name: string): MoveSpecTargetingDeclaration => MULTI[name]
  ? multiTargeting(1, MULTI[name]!)
  : AREA.has(name)
    ? areaTargeting({ relationship: 'any', willingness: 'any', excludeActor: name !== 'Fairy Lock' })
    : SELF.has(name) ? selfTargeting() : singleTargeting()

const SETUP = new Set(['Dig','Dive','Fly','Freeze Shock','Ice Burn','Razor Wind','Skull Bash','Sky Attack','Sky Drop'])
const EXHAUST = new Set(['Giga Impact','Roar of Time','Rock Wrecker'])
const PRIORITY = new Map<string, 'standard' | 'limited'>([['First Impression','standard'],['Revenge','limited']])
const slug = (name: string): string => name.normalize('NFKD').replace(/[’']/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()
const costs = (name: string): readonly MoveSpecCostDeclaration[] => {
  const value: MoveSpecCostDeclaration[] = [standardActionCost(slug(name))]
  if (SETUP.has(name)) value.push(automaticSetupExecuteCost(slug(name)))
  if (EXHAUST.has(name)) value.unshift({ id: `${slug(name)}.cost.exhaust`, phase: 'declare', cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true } })
  const priority = PRIORITY.get(name)
  if (priority) value.unshift({ id: `${slug(name)}.cost.priority`, phase: 'declare', cost: { kind: 'priority', mode: priority } })
  return value
}

const specs = Object.fromEntries(MA_242_249_MOVE_NAMES.map(canonicalId => [canonicalId, createReviewedMoveSpec({
  canonicalId, targeting: targeting(canonicalId), costs: costs(canonicalId), operations: [],
  registeredHandlerId: MOVEMENT_242_249_HANDLER_ID,
  tags: ['movement-context', 'reviewed'],
})])) as Record<MovementCohort242249MoveName, MoveSpec>

export const MOVEMENT_COHORTS_242_249_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] = Object.freeze(
  MA_242_249_MOVE_NAMES.map(canonicalId => Object.freeze({
    canonicalId, sourceModule: 'server/domain/moveAutomation/specs/movementCohorts242_249.ts', spec: specs[canonicalId],
  })),
)
