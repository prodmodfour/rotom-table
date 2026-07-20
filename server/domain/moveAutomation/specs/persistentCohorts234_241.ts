import type { MoveSpec, MoveSpecCostDeclaration, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { PERSISTENT_234_241_HANDLER_ID } from '../handlers/persistent234_241'
import {
  areaTargeting,
  createReviewedMoveSpec,
  multiTargeting,
  selfTargeting,
  singleTargeting,
  standardActionCost,
} from './reviewedSpecBuilder'

export const MA_234_241_MOVE_NAMES = Object.freeze([
  'Conversion', 'Conversion2', 'Core Enforcer', 'Curse', 'Destiny Bond', 'Doom Desire', 'Double Team', 'Electrify',
  'Fire Spin', 'Forest’s Curse', 'Future Sight', 'Gastro Acid', 'Glacial Lance', 'Guard Split', 'Headlong Rush', 'Healing Wish',
  'High Horsepower', 'Infestation', 'Laser Focus', 'Lash Out', 'Leech Seed', 'Light Screen', 'Lucky Chant', 'Lunar Blessing',
  'Lunar Dance', 'Lunge', 'Magma Storm', 'Mean Look', 'Mind Reader', 'Mist', 'Nightmare', 'Octolock',
  'Perish Song', 'Power Split', 'Psyshield Bash', 'Psyshock', 'Psystrike', 'Rage', 'Rest', 'Roost',
  'Safeguard', 'Secret Sword', 'Sing', 'Snap Trap', 'Sonic Boom', 'Spider Web', 'Spirit Shackle', 'Spit Up',
  'Spotlight', 'Stockpile', 'Substitute', 'Swallow', 'Sweet Kiss', 'Tar Shot', 'Thousand Waves', 'Thunder Cage',
  'Trop Kick', 'Victory Dance', 'Water Sport', 'Whirlpool', 'Wish',
] as const)
export type PersistentCohort234241MoveName = (typeof MA_234_241_MOVE_NAMES)[number]

const SELF = new Set<string>([
  'Conversion', 'Conversion2', 'Curse', 'Double Team', 'Laser Focus', 'Lunar Blessing',
  'Perish Song', 'Rage', 'Rest', 'Roost', 'Stockpile', 'Substitute', 'Swallow',
  'Victory Dance', 'Water Sport',
])
const AREA = new Set<string>([
  'Core Enforcer', 'Destiny Bond', 'Glacial Lance', 'Perish Song', 'Sing',
  'Thousand Waves', 'Thunder Cage', 'Water Sport',
])
const TARGETING_OVERRIDES: Readonly<Record<string, MoveSpecTargetingDeclaration>> = {
  Curse: multiTargeting(0, 1),
  'Perish Song': areaTargeting({ relationship: 'any', willingness: 'any', excludeActor: false }),
  'Water Sport': areaTargeting({ relationship: 'any', willingness: 'any', excludeActor: false }),
}
const targetingFor = (name: string): MoveSpecTargetingDeclaration => TARGETING_OVERRIDES[name]
  ?? (AREA.has(name) ? areaTargeting() : SELF.has(name) ? selfTargeting() : singleTargeting())

const priorityCosts = (slug: string): readonly MoveSpecCostDeclaration[] => [
  { id: `${slug}.cost.priority`, phase: 'declare', cost: { kind: 'priority', mode: 'standard' } },
  standardActionCost(slug),
]

const slug = (name: string): string => name.normalize('NFKD').replace(/[’']/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const specs = Object.fromEntries(MA_234_241_MOVE_NAMES.map((canonicalId) => {
  const moveSlug = slug(canonicalId)
  return [canonicalId, createReviewedMoveSpec({
    canonicalId,
    targeting: targetingFor(canonicalId),
    ...(canonicalId === 'Spotlight' ? { costs: priorityCosts(moveSlug) } : {}),
    operations: [],
    registeredHandlerId: PERSISTENT_234_241_HANDLER_ID,
    tags: ['reviewed', 'persistent-context'],
  })]
})) as Record<PersistentCohort234241MoveName, MoveSpec>

export const PERSISTENT_COHORTS_234_241_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] = Object.freeze(
  MA_234_241_MOVE_NAMES.map(canonicalId => Object.freeze({
    canonicalId,
    sourceModule: 'server/domain/moveAutomation/specs/persistentCohorts234_241.ts',
    spec: specs[canonicalId],
  })),
)
