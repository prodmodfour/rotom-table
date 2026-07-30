import { createHash } from 'node:crypto'
import { CANONICAL_CAPABILITY_IDS, CANONICAL_CAPABILITY_REFERENCE } from '#shared/capabilityAutomation/catalog'
import {
  CAPABILITY_AUTOMATION_MANIFEST,
  type CapabilityAutomationManifestEntry,
} from '#shared/capabilityAutomation/manifest'
import type {
  CapabilityActionMechanicKind,
  CapabilityRuntimeActionSpec,
  CapabilityRuntimeDefinition,
  CapabilityRuntimeRegistry,
  CapabilityRuntimeSpec,
} from '#shared/capabilityAutomation/spec'
import { stableJsonStringify } from '#shared/automation/stableJson'

const SEMANTIC_TAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'Alluring': ['bait-item-equivalent', 'daily-resource'],
  'Amorphous': ['squeeze-tight-spaces', 'shape-flexibility'],
  'As One': ['mount-link', 'capability-substitution', 'type-substitution', 'ability-copy', 'shared-targeting'],
  'Aura Pulse': ['willing-mind-communication', 'surface-thoughts'],
  'Aura Reader': ['aura-personality', 'aura-intent'],
  'Blender': ['melee-evasion-plus-2', 'ranged-evasion-plus-4', 'until-next-turn'],
  'Blindsense': ['darkness-vision', 'blind-immunity', 'no-color-or-fine-form'],
  'Bloom': ['sunny-form-change'],
  'Burrow': ['movement-speed', 'underground-route', 'underground-standard-upkeep'],
  'Chilled': ['ambient-cold'],
  'Darkvision': ['darkness-vision', 'low-light-blind-immunity'],
  'Dead Silent': ['no-breath', 'no-heartbeat', 'silent-movement'],
  'Delta Evolution': ['rayquaza-mega-without-stone', 'dragon-ascent-required'],
  'Dream Mist': ['item-production', 'collection-jar', 'daily-resource'],
  'Dream Reader': ['sleeping-dream-access', 'mindlock-blocks'],
  'Egg Warmer': ['hatch-time-reduction', 'daily-resource', 'd10-roll'],
  'Firestarter': ['struggle-type-fire', 'struggle-special-option'],
  'Fortune': ['money-production', 'daily-resource', 'level-times-d10', 'loyalty-risk'],
  'Fountain': ['struggle-type-water', 'struggle-special-option'],
  'Freezer': ['struggle-type-ice', 'struggle-special-option'],
  'Gather Unown': ['summon-unown', 'weekly-resource', 'level-2d8-capped'],
  'Gilled': ['underwater-breathing'],
  'Glow': ['light-emission', 'wild-attraction-adjudication'],
  'Groundshaper': ['adjacent-terrain-shaping', 'rough-terrain', 'slow-terrain', 'basic-terrain'],
  'Guster': ['struggle-type-flying', 'struggle-special-option'],
  'Heart Gift': ['item-production', 'heart-scale', 'weekly-resource'],
  'Heater': ['ambient-warmth'],
  'Herb Growth': ['item-production', 'revival-herb', 'daily-resource'],
  'High Jump': ['jump-height', 'acrobatics-dc-16-extension'],
  'Honey Gather': ['item-production', 'honey', 'daily-resource', 'plant-environment-required'],
  'Illusionist': ['visual-illusion', 'half-meter-limit', 'focus-range', 'concentration-economy'],
  'Inflatable': ['size-125-percent', 'evasion-minus-1', 'blocking-terrain'],
  'Invisibility': ['accuracy-dc-plus-4', 'moves-prohibited', 'four-minute-limit', 'minute-cooldown'],
  'Juicer': [
    'exact-held-berry-custody-24-hours', 'independent-shell-item',
    'shuckles-berry-juice-snack', 'bottled-refreshment', 'shell-juice-to-rare-candy-14-days',
  ],
  'Jump': ['jump-long-and-high', 'acrobatics-dc-16-extension'],
  'Keystone Warp': ['synchronized-keystone-teleport', 'ten-meter-range'],
  'Letter Press': ['irreversible-unown-fusion', 'base-stat-increase', 'hidden-power-instances'],
  'Levitate': ['movement-speed', 'groundsource-immunity', 'height-half-speed'],
  'Living Weapon': ['wielder-link', 'equipment-profile', 'shared-movement-budget', 'granted-weapon-moves'],
  'Long Jump': ['jump-horizontal-distance'],
  'Magnetic': ['iron-steel-manipulation', 'magnetic-north-sense'],
  'Marsupial': ['baby-template', 'pouch-protection', 'experience-sharing'],
  'Materializer': ['struggle-type-rock', 'struggle-special-option'],
  'Milk Collection': ['item-production', 'moomoo-milk', 'daily-resource'],
  'Mindlock': ['mind-reading-immunity', 'mind-reader-immunity', 'dream-reader-immunity'],
  'Mountable X': ['mount-capacity', 'ignore-power-carry-penalties', 'campaign-guideline'],
  'Mushroom Harvest': ['item-production', 'mushroom-d20-table', 'daily-resource'],
  'Naturewalk': ['listed-terrain-is-basic'],
  'Overland': ['movement-speed', 'dry-land-route'],
  'Pack Mon': ['wild-pack-command', 'fearful-disposition', 'dominance-conflict'],
  'Pearl Creation': ['evolution-trigger', 'pink-pearl-production', 'capability-consumed'],
  'Phasing': ['slow-terrain-ignore', 'intangible-mode', 'blocking-terrain-pass', 'round-end-hp-tick'],
  'Planter': ['portable-grower', 'one-plant-capacity', 'plant-category-parameter'],
  'Power': ['heavy-lifting', 'staggering-weight', 'drag-weight'],
  'Premonition': ['natural-disaster-warning'],
  'Reach': ['melee-range-by-size'],
  'Shadow Meld': ['stealth-plus-4', 'evasion-plus-1', 'surface-flat', 'standard-actions-prohibited'],
  'Shapeshifter': ['shape-change', 'mass-within-50-percent', 'opposed-perception-stealth'],
  'Shrinkable': ['size-25-percent', 'evasion-plus-4', 'standard-actions-prohibited'],
  'Sky': ['movement-speed', 'air-route', 'groundsource-immunity'],
  'Soulless': ['max-hp-one', 'temporary-hp-prohibited', 'injury-immunity', 'cannot-die'],
  'Split Evolution': ['nature-stat-evolution-branch'],
  'Sprouter': ['plant-growth', 'berry-instant-yield', 'weekly-resource'],
  'Stealth': ['silent-movement', 'rough-terrain-ranged-untargetable'],
  'Swim': ['movement-speed', 'underwater-route'],
  'Telekinetic': ['focus-power', 'object-range-8', 'ranged-struggle', 'ranged-maneuvers', 'psychic-residue'],
  'Telepath': ['focus-range-double', 'opposed-focus', 'failure-penalty-24-hours', 'psychic-residue'],
  'Teleporter': ['movement-speed', 'line-of-sight', 'surface-destination', 'once-per-round', 'no-sprint'],
  'Threaded': ['range-4-shift', 'weight-directed-pull', 'ac-6-unwilling'],
  'Throwing Range': ['small-item-throw-range'],
  'Tracker': ['scent-tracking', 'perception-dc-by-familiarity', 'once-per-hour'],
  'Tremorsense': ['ground-sense-range-5', 'location-size-shape'],
  'Underdog': ['underdog-class-eligibility'],
  'Viral Fusion': ['bond-link', 'capability-substitution', 'skill-substitution-plus-rank', 'type-substitution', 'temporary-move'],
  'Volatile Bomb': ['self-destruct-loyalty-immunity', 'explosion-loyalty-immunity'],
  'Wallclimber': ['wall-ceiling-route', 'half-overland-speed'],
  'Weapon Bond': ['crowned-form', 'ancestral-item-required', 'temporary-move'],
  'Weathershape': ['weather-form-appearance'],
  'Wielder': ['disarm-plus-2', 'natural-weapon-disarm-immunity', 'weapon-size-by-pokemon-size'],
  'Wired': ['electronic-entry', 'connected-device-travel', 'rotom-machine-control'],
  'X-Ray Vision': ['solid-object-vision-one-foot', 'material-blocking'],
  'Zapper': ['struggle-type-electric', 'struggle-special-option'],
  'Zygarde Cells': ['cell-assembly', 'zygarde-cube', 'form-change', 'cube-tutoring'],
})

const TOGGLE_ACTIONS = new Set([
  'blend', 'emit-light', 'stop-light', 'create-illusion', 'dismiss-illusion',
  'inflate', 'deflate', 'become-invisible', 'become-visible', 'become-intangible',
  'become-tangible', 'meld', 'reform', 'change-shape', 'restore-shape', 'shrink',
  'restore-size', 'assume-crowned-form', 'relinquish-crowned-form', 'enter-machine',
  'exit-machine', 'change-zygarde-form', 'mega-evolve',
])
const LINK_ACTIONS = new Set([
  'mount', 'dismount', 'engage-wielder', 'disengage-wielder', 'accept-rider',
  'release-rider', 'bond', 'release-bond', 'combine-unown', 'assemble-zygarde',
  'disassemble-zygarde', 'ride-shadow', 'leave-shadow', 'shelter-baby',
])
const MOVEMENT_ACTIONS = new Set(['keystone-warp', 'threaded-shift', 'teleport', 'jump', 'reposition-illusion'])
const COMMUNICATION_ACTIONS = new Set(['communicate', 'project-thought'])
const SKILL_ACTIONS = new Set(['read-aura', 'read-dream', 'read-mind', 'manipulate-object', 'telekinetic-maneuver', 'track-scent', 'distract-with-alluring'])
const CAMPAIGN_TIME_ACTIONS = new Set([
  'consume-juicer-shell-juice-as-snack', 'collect-juicer-output',
  'plant', 'harvest', 'tutor-cube-move', 'synchronize-keystone',
])
const ROLL_ACTIONS = new Set([
  'warm-egg', 'roam-for-fortune', 'gather-unown', 'harvest-mushroom',
  'lure-with-alluring', 'resolve-alluring-lure-check', 'abandon-alluring-lure', 'oppose-examination',
])
const GM_CONFIRMED_ACTIONS = new Set([
  'lure-with-alluring', 'read-aura', 'read-dream',
  'manipulate-metal', 'plant', 'harvest', 'sprout', 'read-mind', 'bond', 'combine-unown', 'track-scent',
  'change-shape',
  'influence-nearby-wilds',
  'assemble-zygarde', 'shelter-baby',
])

const mechanicFor = (
  entry: CapabilityAutomationManifestEntry,
  actionId: string,
): CapabilityActionMechanicKind => {
  if (CAMPAIGN_TIME_ACTIONS.has(actionId)) return 'campaign-time'
  if (entry.itemOutputs.length > 0) return actionId === 'harvest-mushroom' ? 'resolve-roll' : 'produce-item'
  if (TOGGLE_ACTIONS.has(actionId)) return 'toggle-mode'
  if (LINK_ACTIONS.has(actionId)) return 'link-actors'
  if (MOVEMENT_ACTIONS.has(actionId)) return 'movement-request'
  if (COMMUNICATION_ACTIONS.has(actionId)) return 'communication'
  if (SKILL_ACTIONS.has(actionId)) return 'skill-challenge'
  if (ROLL_ACTIONS.has(actionId)) return 'resolve-roll'
  if (actionId === 'shape-ground') return 'shape-terrain'
  return 'adjudication'
}

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const buildDefinition = (entry: CapabilityAutomationManifestEntry): CapabilityRuntimeDefinition => {
  const reference = CANONICAL_CAPABILITY_REFERENCE[entry.canonicalId]
  const semanticTags = SEMANTIC_TAGS[entry.canonicalId]
  if (!reference || !semanticTags?.length) throw new Error(`Capability ${entry.canonicalId} has no reviewed runtime semantics.`)
  const actions: readonly CapabilityRuntimeActionSpec[] = Object.freeze(entry.actions.map(action => Object.freeze({
    actionId: action.id,
    economy: action.action,
    frequency: action.frequency,
    contextPredicateId: `capability.${entry.canonicalId}.${action.context}`,
    mechanic: mechanicFor(entry, action.id),
    levelRequirement: entry.levelRequirement,
    itemOutputs: action.id === 'consume-juicer-shell-juice-as-snack'
      ? Object.freeze([])
      : entry.itemOutputs,
    requiresGmConfirmation: GM_CONFIRMED_ACTIONS.has(action.id),
  })))
  const spec: CapabilityRuntimeSpec = Object.freeze({
    schemaVersion: 1,
    canonicalId: entry.canonicalId,
    category: entry.category,
    sourceEffectSha256: entry.sourceEffectSha256,
    semanticTags: Object.freeze([...semanticTags]),
    actions,
    passiveProjection: true,
    registeredHandlerId: 'capability.native.v1',
  })
  return Object.freeze({
    canonicalId: entry.canonicalId,
    definitionHash: sha256(spec),
    spec,
    source: Object.freeze({ file: reference.source, effect: reference.effect }),
  })
}

const definitions = Object.freeze(CAPABILITY_AUTOMATION_MANIFEST.entries.map(buildDefinition))
const byId = new Map(definitions.map(definition => [definition.canonicalId, definition]))
if (definitions.length !== 83 || CANONICAL_CAPABILITY_IDS.some(id => !byId.has(id))) {
  throw new Error('Capability runtime registry must cover the complete frozen 83-entry corpus.')
}

export const CAPABILITY_AUTOMATION_RUNTIME_REGISTRY: CapabilityRuntimeRegistry = Object.freeze({
  definitions,
  resolve: (canonicalId: string): CapabilityRuntimeDefinition | null => byId.get(canonicalId) ?? null,
  require: (canonicalId: string): CapabilityRuntimeDefinition => {
    const definition = byId.get(canonicalId)
    if (!definition) throw new Error(`Capability ${canonicalId} is not registered.`)
    return definition
  },
})

export const capabilityRuntimeSemanticTags = (canonicalId: string): readonly string[] => (
  CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)?.spec.semanticTags ?? []
)
