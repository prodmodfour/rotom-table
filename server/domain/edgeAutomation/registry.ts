import { createHash } from 'node:crypto'
import {
  CANONICAL_POKE_EDGE_IDS,
  CANONICAL_TRAINER_EDGE_IDS,
  canonicalEdgeKey,
  canonicalEdgeReference,
  type EdgeFamily,
} from '#shared/edgeAutomation/catalog'
import {
  EDGE_AUTOMATION_MANIFEST,
  type EdgeAutomationManifestEntry,
} from '#shared/edgeAutomation/manifest'
import type {
  EdgeMechanicDeclaration,
  EdgeMechanicKind,
  EdgeMechanicParameter,
  EdgeRuntimeDefinition,
  EdgeRuntimeRegistry,
  EdgeRuntimeSpec,
} from '#shared/edgeAutomation/spec'
import { stableJsonStringify } from '#shared/automation/stableJson'

interface MechanicOptions {
  readonly operation?: EdgeMechanicDeclaration['operation']
  readonly value?: EdgeMechanicDeclaration['value']
  readonly valueSource?: string | null
  readonly choiceId?: string | null
  readonly contextId?: string
  readonly parameters?: Readonly<Record<string, EdgeMechanicParameter>>
}

const mechanic = (
  mechanicId: string,
  kind: EdgeMechanicKind,
  propertyId: string,
  options: MechanicOptions = {},
): EdgeMechanicDeclaration => Object.freeze({
  mechanicId,
  kind,
  propertyId,
  operation: options.operation ?? (kind === 'permanent-grant' ? 'grant' : kind === 'trigger-subscription' ? 'subscribe' : kind === 'permission-provider' || kind === 'delegated-operation' ? 'permit' : 'add'),
  value: options.value ?? null,
  valueSource: options.valueSource ?? null,
  choiceId: options.choiceId ?? null,
  contextId: options.contextId ?? 'always',
  parameters: Object.freeze({ ...(options.parameters ?? {}) }),
})

const n = (id: string, property: string, value: number, contextId = 'always', valueSource: string | null = null): EdgeMechanicDeclaration => mechanic(id, 'numeric-provider', property, { value, contextId, valueSource })
const grant = (id: string, property: string, value: string, choiceId: string | null = null, contextId = 'acquisition'): EdgeMechanicDeclaration => mechanic(id, 'permanent-grant', property, { value, choiceId, contextId })
const permit = (id: string, property: string, contextId: string, parameters: Readonly<Record<string, EdgeMechanicParameter>> = {}): EdgeMechanicDeclaration => mechanic(id, 'permission-provider', property, { contextId, parameters })
const substitute = (id: string, property: string, valueSource: string, contextId: string): EdgeMechanicDeclaration => mechanic(id, 'substitution-provider', property, { operation: 'substitute', valueSource, contextId })
const trigger = (id: string, property: string, contextId: string, parameters: Readonly<Record<string, EdgeMechanicParameter>> = {}): EdgeMechanicDeclaration => mechanic(id, 'trigger-subscription', property, { contextId, parameters })
const lifecycle = (id: string, property: string, operation: EdgeMechanicDeclaration['operation'], value: EdgeMechanicDeclaration['value'], contextId: string, parameters: Readonly<Record<string, EdgeMechanicParameter>> = {}): EdgeMechanicDeclaration => mechanic(id, 'lifecycle-rule', property, { operation, value, contextId, parameters })
const rank = (id: string, property: string, operation: 'add' | 'set', value: number, choiceId: string, contextId = 'acquisition'): EdgeMechanicDeclaration => mechanic(id, 'rank-provider', property, { operation, value, choiceId, contextId })

const T: Readonly<Record<string, readonly EdgeMechanicDeclaration[]>> = Object.freeze({
  'Acrobat': [n('jump-high', 'capability.high-jump', 1), n('jump-long', 'capability.long-jump', 1)],
  'Adept Skills': [rank('skill-adept', 'skill.rank', 'set', 4, 'skill')],
  'Apricorn Balls': [permit('craft-apricorn-ball', 'campaign.recipe.apricorn-ball', 'ball-toolbox-and-apricorn')],
  'Art of Stealth': [grant('grant-stealth', 'capability', 'Stealth')],
  'Athletic Initiative': [grant('learn-agility', 'move', 'Agility')],
  'Bad Mood': [n('persistent-critical', 'combat.critical-range', 1, 'persistent-status'), n('volatile-critical', 'combat.critical-range', 1, 'volatile-status')],
  'Basic Balls': [permit('craft-basic-ball', 'campaign.recipe.basic-ball', 'ball-toolbox-and-money', { basicCost: 100, greatCost: 175 })],
  'Basic Cooking': [permit('cook-basic-food', 'campaign.recipe.basic-food', 'ingredients', { cost: 50, outputs: ['Candy Bar', 'Baby Food'] })],
  'Basic Martial Arts': [grant('learn-rock-smash', 'move', 'Rock Smash')],
  'Basic Psionics': [grant('learn-confusion', 'move', 'Confusion')],
  'Basic Skills': [rank('skill-step', 'skill.rank', 'add', 1, 'skill', 'rank-below-novice')],
  'Beast Master': [substitute('low-loyalty-command', 'check.low-loyalty-command', 'skill.intimidate', 'pokemon-loyalty-0-or-1'), substitute('training-command', 'training.rank', 'skill.intimidate', 'training')],
  'Breeder': [mechanic('breeding-handoff', 'delegated-operation', 'campaign.breeding.v1', { operation: 'permit', contextId: 'downstream-capability', parameters: { contractId: 'edge.breeder.request.v1', ownerPlan: 'BREEDING_AND_EGG_LIFECYCLE_PLAN.md' } })],
  'Categoric Inclination': [mechanic('category-check-bonus', 'numeric-provider', 'skill.check', { value: 1, choiceId: 'category', contextId: 'selected-skill-category' })],
  'Charmer': [grant('learn-baby-doll-eyes', 'move', 'Baby-Doll Eyes')],
  'Confidence Artist': [grant('learn-confide', 'move', 'Confide')],
  'Demoralize': [trigger('critical-vulnerable', 'condition.vulnerable', 'critical-hit', { statusNaturalMinimum: 19, duration: 'canonical' })],
  'Dynamism': [mechanic('guile-initiative', 'numeric-provider', 'initiative', { valueSource: 'skill.guile.rank', contextId: 'initiative' })],
  'Elemental Connection': [mechanic('typed-social-bonus', 'numeric-provider', 'skill.check', { value: 2, choiceId: 'type', contextId: 'social-check-against-selected-pokemon-type', parameters: { skills: ['charm', 'command', 'guile', 'intimidate', 'intuition'] } }), mechanic('mystic-exclusion', 'mutual-exclusion', 'edge.Mystic Senses', { operation: 'prevent', value: true, contextId: 'acquisition' })],
  'Expert Manipulator': [n('manipulate-check', 'maneuver.manipulate.opposed-check', 2), lifecycle('manipulate-usage', 'maneuver.manipulate.per-target-use', 'set', 'on-success', 'manipulate-resolution')],
  'Expert Skills': [rank('skill-expert', 'skill.rank', 'set', 5, 'skill')],
  'Expert Trickster': [n('dirty-trick-check', 'maneuver.dirty-trick.opposed-check', 2), lifecycle('dirty-trick-usage', 'maneuver.dirty-trick.per-target-use', 'set', 'on-success', 'dirty-trick-resolution')],
  'Flustering Charisma': [trigger('social-save-penalty', 'save.volatile-status', 'social-move-hit', { value: -2, duration: 'one-full-round' })],
  'Gem Lore': [permit('craft-gem', 'campaign.recipe.gem', 'typed-shard'), permit('transmute-stone', 'campaign.recipe.evolution-stone', 'four-matching-shards-or-stone')],
  'Grace': [n('poffin-cap', 'pokemon.poffin-cap', 2, 'owned-pokemon'), substitute('contest-introduction', 'contest.introduction.skill', 'selected-grace-prerequisite-skill', 'contest-introduction')],
  'Green Thumb': [permit('grow-apricorn', 'campaign.grow.apricorn', 'grower-or-fertilized-soil'), permit('grow-tier-1-berry', 'campaign.grow.tier-1-berry', 'grower-or-fertilized-soil')],
  'Groomer': [permit('groom-team', 'training.groom', 'groomers-kit', { targetLimit: 6, minutes: 60 }), n('groom-contest', 'contest.introduction.dice', 1, 'groomed-today')],
  'Instinctive Aptitude': [lifecycle('ap-roll-bonus', 'ap.raise-roll.bonus-per-ap', 'set', 2, 'trainer-owned-roll')],
  'Instruction': [lifecycle('education-assist', 'skill.assist.rank-fraction', 'set', 1, 'education-assist-at-novice')],
  'Intimidating Presence': [grant('learn-leer', 'move', 'Leer')],
  'Iron Mind': [trigger('mind-read-awareness', 'information.telepathy-attempt', 'mind-read-attempt', { revealAttempt: true, revealSuccess: false })],
  'Kip Up': [lifecycle('swift-stand', 'action.stand-from-tripped', 'set', 'swift', 'tripped')],
  'Leader': [grant('learn-after-you', 'move', 'After You')],
  'Master Skills': [rank('skill-master', 'skill.rank', 'set', 6, 'skill')],
  'Medic Training': [lifecycle('restorative-turn', 'item.restorative.target-next-turn-forfeit', 'prevent', true, 'using-restorative-on-other')],
  'Mounted Prowess': [lifecycle('mount-auto-success', 'mount.initial-check', 'set', 'automatic-success', 'mount-check'), n('remain-mounted', 'mount.remain-check', 3)],
  'Mystic Senses': [substitute('wild-disposition', 'check.wild-disposition', 'skill.intuition', 'improve-wild-pokemon-disposition'), mechanic('elemental-exclusion', 'mutual-exclusion', 'edge.Elemental Connection', { operation: 'prevent', value: true, contextId: 'acquisition' })],
  'Nimble Movement': [lifecycle('disengage-distance', 'maneuver.disengage.distance', 'set', 2, 'disengage')],
  'Paleontologist': [permit('identify-fossil', 'campaign.fossil.identify', 'fossil', { dc: 10, skills: ['pokeEd', 'survival'] }), permit('reanimate-fossil', 'campaign.fossil.reanimate', 'reanimation-machine')],
  'Poké Ball Repair': [permit('repair-ball', 'campaign.ball.repair', 'broken-ball-and-toolbox', { dc: 15, skill: 'techEd', failure: 'permanently-broken' })],
  'PokéPsychologist': [substitute('pokemon-social', 'check.pokemon-social', 'skill.pokeEd', 'general-pokemon-interaction-or-disposition')],
  'Power Boost': [n('power', 'capability.power', 2)],
  'Repel Crafter': [permit('craft-repel', 'campaign.recipe.repel', 'chemistry-set-and-money', { repelCost: 100, superRepelCost: 150 })],
  'Scholar': [mechanic('education-checks', 'numeric-provider', 'skill.check', { value: 1, contextId: 'education-or-survival', parameters: { skills: ['generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd', 'survival'] } })],
  'Skill Enhancement': [mechanic('selected-skill-bonus', 'numeric-provider', 'skill.check', { value: 2, choiceId: 'skills', contextId: 'selected-skill', parameters: { uniquePerSkill: true } })],
  'Skill Stunt': [mechanic('skill-stunt', 'action-modifier', 'skill.roll', { operation: 'set', value: 6, choiceId: 'skill', contextId: 'selected-circumstance', parameters: { diceDelta: -1, circumstanceChoiceId: 'circumstance' } })],
  'Slippery': [substitute('grapple-defense', 'maneuver.grapple-push-trip.defense-skill', 'skill.stealth', 'defending-opposed-check'), lifecycle('grapple-win', 'maneuver.grapple.stealth-win-outcome', 'set', 'end-grapple', 'grapple-defense-win')],
  'Smooth': [n('social-evasion', 'evasion.social-move', 4), n('rage-save', 'save.rage', 2), n('infatuation-save', 'save.infatuation', 2)],
  'Sneak’s Tricks': [grant('learn-astonish', 'move', 'Astonish')],
  'Stamina': [trigger('stamina-temp-hp', 'temporary-hp', 'breather-massive-damage-or-critical', { valueSource: 'max(skill.athletics.rank,skill.combat.rank)', timing: 'after-trigger' })],
  'Survival Drive': [grant('learn-bulk-up', 'move', 'Bulk Up')],
  'Swimmer': [n('swim-speed', 'capability.swim', 2), mechanic('underwater-duration', 'numeric-provider', 'capability.underwater-minutes', { valueSource: 'max(skill.athletics.rank,skill.survival.rank)', contextId: 'underwater' })],
  'Tag Scribe': [permit('cleanse-tag', 'campaign.recipe.cleanse-tag', 'daily-resource', { usesSource: 'floor(skill.occultEd.rank/2)' })],
  'Throwing Masteries': [n('throwing-range', 'capability.throwing-range', 2)],
  'Train the Reserves': [lifecycle('training-target-limit', 'training.target-limit', 'multiply', 2, 'experience-training')],
  'Trainer of Champions': [n('training-experience', 'training.experience', 5)],
  'Traveler': [substitute('power-survival', 'capability.power.skill', 'skill.survival', 'power-formula'), substitute('jump-survival', 'capability.jump.skill', 'skill.survival', 'jump-formula'), substitute('overland-survival', 'capability.overland.lower-skill', 'skill.survival', 'overland-formula')],
  'Virtuoso': [rank('effective-rank-eight', 'skill.effective-rank-for-effects', 'set', 8, 'skill')],
  'Wallrunner': [mechanic('vertical-traversal', 'permission-provider', 'movement.vertical-surface', { operation: 'permit', valueSource: 'skill.acrobatics.rank', contextId: 'wallrun-before-jump' })],
  'Weapon of Choice': [n('disarm-defense', 'maneuver.disarm.defense', 2, 'selected-weapon'), trigger('prevent-disarm', 'maneuver.disarm.prevent', 'would-be-disarmed-with-selected-weapon', { apCost: 1 })],
  'Work Up': [grant('learn-work-up', 'move', 'Work Up')],
})

const P: Readonly<Record<string, readonly EdgeMechanicDeclaration[]>> = Object.freeze({
  'Ability Mastery': [grant('additional-ability', 'ability', 'choice', 'choice-1')],
  'Accuracy Training': [mechanic('move-ac', 'numeric-provider', 'move.ac', { value: -1, choiceId: 'choice-1', contextId: 'selected-move' })],
  'Advanced Connection': [lifecycle('connected-slot', 'move.slot-required', 'prevent', true, 'connected-move-for-selected-ability', { abilityChoiceId: 'choice-1' })],
  'Advanced Mobility': [mechanic('movement-plus-two', 'numeric-provider', 'capability.selected-movement', { value: 2, choiceId: 'choice-1', contextId: 'selected-capability' })],
  'Attack Conflict': [lifecycle('relation-waiver', 'stat.base-relation', 'prevent', true, 'selected-attack-stat', { choiceId: 'choice-1' })],
  'Aura Pulse': [grant('aura-pulse', 'capability', 'Aura Pulse')],
  'Basic Ranged Attacks': [lifecycle('ranged-struggle', 'struggle.range', 'set', 6, 'selected-elemental-capability', { choiceId: 'choice-1', unit: 'meters' })],
  'Capability Training': [mechanic('capability-plus-one', 'numeric-provider', 'capability.selected-power-or-jump', { value: 1, choiceId: 'choice-1', contextId: 'selected-capability' })],
  'Enticing Bait': [mechanic('alluring-roll', 'numeric-provider', 'capability.alluring.roll', { valueSource: 'max(skill.athletics.rank,skill.focus.rank)', contextId: 'alluring-activation' })],
  'Extended Invisibility': [lifecycle('invisibility-duration', 'capability.invisibility.maximum-minutes', 'set', 8, 'invisibility')],
  'Far Reading': [n('telepath-focus', 'capability.telepath.effective-focus-rank', 2)],
  'Mixed Power': [grant('twisted-power', 'ability', 'Twisted Power')],
  'Precise Threadings': [lifecycle('threaded-range', 'capability.threaded.range', 'set', 6, 'threaded', { unit: 'meters' }), lifecycle('threaded-ac', 'capability.threaded.ac', 'set', 3, 'threaded')],
  'Realized Potential': [mechanic('bonus-stat-points', 'numeric-provider', 'pokemon.bonus-stat-points', { valueSource: 'max(0,45-species.base-stat-total)', contextId: 'underdog-bst-below-45' }), lifecycle('refund-on-bst', 'edge.source-loss-and-refund', 'set', 'bst-45-or-higher', 'evolution')],
  'Seismometer': [mechanic('tremorsense-range', 'numeric-provider', 'capability.tremorsense.range', { valueSource: 'skill.perception.rank', contextId: 'tremorsense' })],
  'Skill Improvement': [rank('species-skill-step', 'pokemon.skill.rank', 'add', 1, 'choice-1', 'selected-skill-at-or-below-species-default')],
  'TK Mastery': [n('telekinetic-focus', 'capability.telekinetic.effective-focus-rank', 2)],
  'Trail Sniffer': [mechanic('tracker-roll', 'numeric-provider', 'capability.tracker.perception-roll', { valueSource: 'skill.focus.rank', contextId: 'tracker-check' })],
  'Underdog’s Lessons': [grant('final-evolution-move', 'move', 'choice', 'choice-2'), lifecycle('final-evolution-lists', 'pokemon.move-list-overlay', 'set', 'selected-final-evolution', 'tm-hm-tutor-eligibility', { choiceId: 'choice-1' })],
  'Underdog’s Strength': [n('base-hp', 'pokemon.base-stat.hp', 1), n('base-atk', 'pokemon.base-stat.atk', 1), n('base-def', 'pokemon.base-stat.def', 1), n('base-satk', 'pokemon.base-stat.satk', 1), n('base-sdef', 'pokemon.base-stat.sdef', 1), n('base-spd', 'pokemon.base-stat.spd', 1), lifecycle('prevent-evolution', 'pokemon.evolution', 'prevent', true, 'always')],
})

const declarationsFor = (family: EdgeFamily, canonicalId: string): readonly EdgeMechanicDeclaration[] => (
  (family === 'trainer' ? T : P)[canonicalId] ?? []
)

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const buildDefinition = (entry: EdgeAutomationManifestEntry): EdgeRuntimeDefinition => {
  const reference = canonicalEdgeReference(entry.family, entry.canonicalId)
  const mechanics = declarationsFor(entry.family, entry.canonicalId)
  if (!reference || mechanics.length === 0) throw new Error(`Edge ${canonicalEdgeKey(entry.family, entry.canonicalId)} has no reviewed native semantics.`)
  const mechanicIds = mechanics.map(row => row.mechanicId)
  if (new Set(mechanicIds).size !== mechanicIds.length) throw new Error(`Edge ${entry.canonicalId} repeats a mechanic ID.`)
  const spec: EdgeRuntimeSpec = Object.freeze({
    schemaVersion: 1,
    family: entry.family,
    canonicalId: entry.canonicalId,
    sourceEffectSha256: entry.sourceEffectSha256,
    roles: entry.roles,
    mechanics: Object.freeze([...mechanics]),
    actions: entry.actions,
    registeredHandlerId: 'edge.native.v1',
  })
  return Object.freeze({
    key: canonicalEdgeKey(entry.family, entry.canonicalId),
    family: entry.family,
    canonicalId: entry.canonicalId,
    definitionHash: sha256(spec),
    spec,
  })
}

const definitions = Object.freeze(EDGE_AUTOMATION_MANIFEST.entries.map(buildDefinition))
const byKey = new Map(definitions.map(definition => [definition.key, definition]))
if (definitions.length !== 81
  || CANONICAL_TRAINER_EDGE_IDS.some(id => !byKey.has(canonicalEdgeKey('trainer', id)))
  || CANONICAL_POKE_EDGE_IDS.some(id => !byKey.has(canonicalEdgeKey('poke', id)))) {
  throw new Error('Edge runtime registry must cover all 81 frozen rows.')
}

export const EDGE_AUTOMATION_RUNTIME_REGISTRY: EdgeRuntimeRegistry = Object.freeze({
  definitions,
  resolve: (family: EdgeFamily, canonicalId: string) => byKey.get(canonicalEdgeKey(family, canonicalId)) ?? null,
  require: (family: EdgeFamily, canonicalId: string) => {
    const definition = byKey.get(canonicalEdgeKey(family, canonicalId))
    if (!definition) throw new Error(`Edge ${canonicalEdgeKey(family, canonicalId)} is not registered.`)
    return definition
  },
})
