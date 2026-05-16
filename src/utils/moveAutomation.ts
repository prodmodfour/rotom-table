import { findMove, moves } from '~~/data/ptuReference'
import {
  MOVE_DAMAGE_BASE_TABLE,
  formatMoveDamageBase,
  rollMoveDamageFormula,
} from '~/utils/moveDamageBase'
import {
  createManualMoveAutomationScript,
  damageFormulaForManualMove,
} from '~/utils/moveAutomationManual'
import { STRUGGLE_ATTACK_MOVE_NAMES } from '~/utils/struggleMoves'
import type { MoveDamageRollResult } from '~/utils/moveDamageBase'
import type { CombatStageKey } from '~/types/combatStages'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerMove } from '~/types/trainerSheet'

export interface MoveAutomationMoveLike {
  name: string
  type?: string
  frequency?: string
  ac?: number | string | null
  damage_base?: number | null
  damage_roll?: string | null
  damage_class?: string | null
  range?: string
  effect?: string
  special?: string
}

export type DamageRollResult = MoveDamageRollResult

export const DAMAGE_BASE_TABLE = MOVE_DAMAGE_BASE_TABLE
export const formatDamageBase = formatMoveDamageBase
export const rollDamageFormula = rollMoveDamageFormula

export const sheetMoveToMoveLike = (move: CharacterSheetMove | TrainerMove): MoveAutomationMoveLike => ({
  name: move.name,
  type: move.type,
  frequency: move.frequency,
  ac: move.ac,
  damage_base: move.db ?? null,
  damage_roll: move.damageRoll ?? null,
  damage_class: move.category ?? null,
  range: move.range,
  effect: move.effect,
  special: move.special,
})

export const damageFormulaForMove = damageFormulaForManualMove

export const buildManualMoveResolution = createManualMoveAutomationScript

const defineExplicitMoveScript = (script: Omit<MoveAutomationScript, 'kind'>): MoveAutomationScript => ({
  ...script,
  kind: 'explicit',
})

type ReviewedMoveScriptOverrides = Partial<Omit<MoveAutomationScript, 'kind' | 'moveName' | 'version'>>

type ReviewedTargetStageDefinition = {
  key: CombatStageKey
  delta: number
  label: string
  threshold?: string
  optional?: boolean
}

type ReviewedTargetConditionDefinition = {
  condition: string
  label: string
  threshold?: string
  optional?: boolean
}

const reviewedMoveScriptFromCanonical = (
  moveName: string,
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => {
  const move = findMove(moveName)
  if (!move) throw new Error(`Missing canonical PTU move data for ${moveName}`)
  const manualScript = createManualMoveAutomationScript(move)
  return defineExplicitMoveScript({
    moveName: manualScript.moveName,
    version,
    targetMode: manualScript.targetMode,
    targetCount: manualScript.targetCount,
    damaging: manualScript.damaging,
    requiresAccuracy: manualScript.requiresAccuracy,
    damageBase: manualScript.damageBase,
    damageClass: manualScript.damageClass,
    type: manualScript.type,
    ac: manualScript.ac,
    range: manualScript.range,
    effect: manualScript.effect,
    special: manualScript.special,
    keywords: manualScript.keywords,
    criticalRange: manualScript.criticalRange,
    areaTemplates: manualScript.areaTemplates,
    conditionSuggestions: manualScript.conditionSuggestions,
    stageSuggestions: manualScript.stageSuggestions,
    hpSuggestions: manualScript.hpSuggestions,
    fieldSuggestions: manualScript.fieldSuggestions,
    hazardSuggestions: manualScript.hazardSuggestions,
    automationNotes: [],
    ...overrides,
  })
}

const targetStageSuggestions = (stages: readonly ReviewedTargetStageDefinition[]): MoveAutomationScript['stageSuggestions'] =>
  stages.map((stage) => ({
    recipient: 'target',
    key: stage.key,
    delta: stage.delta,
    label: stage.label,
    ...(stage.threshold ? { threshold: stage.threshold, optional: stage.optional ?? true } : {}),
    ...(!stage.threshold && stage.optional != null ? { optional: stage.optional } : {}),
  }))

const targetConditionSuggestions = (conditions: readonly ReviewedTargetConditionDefinition[]): MoveAutomationScript['conditionSuggestions'] =>
  conditions.map((condition) => ({
    recipient: 'target',
    condition: condition.condition,
    action: 'add',
    label: condition.label,
    ...(condition.threshold ? { threshold: condition.threshold, optional: condition.optional ?? true } : {}),
    ...(!condition.threshold && condition.optional != null ? { optional: condition.optional } : {}),
  }))

const areaAutomationNotes = (script: Pick<MoveAutomationScript, 'keywords'>): string[] => [
  'Use the area-template buttons to choose affected legal targets, or select targets manually.',
  ...(script.keywords.some((keyword) => /^Friendly$/i.test(keyword))
    ? ['Friendly keyword: allies are not hit; team allegiance is not tracked, so choose legal foes only.']
    : []),
]

const reviewedSingleTargetAttackScript = (moveName: string, version = 1): MoveAutomationScript =>
  reviewedMoveScriptFromCanonical(moveName, version, {
    targetMode: 'one-target',
    targetCount: 1,
  })

const reviewedSingleTargetStatusScript = reviewedSingleTargetAttackScript

const reviewedSingleTargetConditionScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  version = 1,
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  conditionSuggestions: targetConditionSuggestions(conditions),
})

const reviewedSingleTargetStageScript = (
  moveName: string,
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  stageSuggestions: targetStageSuggestions(stages),
})

const reviewedAreaConfirmationScript = (
  moveName: string,
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => {
  const script = reviewedMoveScriptFromCanonical(moveName, version, {
    targetMode: 'multi-target',
    targetCount: null,
    ...overrides,
  })
  return {
    ...script,
    automationNotes: overrides.automationNotes ?? areaAutomationNotes(script),
  }
}

const reviewedAreaConditionScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  version = 1,
): MoveAutomationScript => reviewedAreaConfirmationScript(moveName, version, {
  conditionSuggestions: targetConditionSuggestions(conditions),
})

const reviewedTargetStagesAreaScript = (
  moveName: string,
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
): MoveAutomationScript => reviewedAreaConfirmationScript(moveName, version, {
  stageSuggestions: targetStageSuggestions(stages),
})

const reviewedTargetStageAreaScript = (
  moveName: string,
  key: 'atk' | 'def',
  label: string,
  version = 1,
): MoveAutomationScript => reviewedTargetStagesAreaScript(moveName, [{ key, delta: -1, label }], version)

const reviewedSmogScript = (version = 1): MoveAutomationScript => {
  const move = findMove('Smog')
  if (!move) throw new Error('Missing canonical PTU move data for Smog')
  const manualScript = createManualMoveAutomationScript(move)
  return defineExplicitMoveScript({
    moveName: manualScript.moveName,
    version,
    targetMode: 'multi-target',
    targetCount: null,
    damaging: true,
    requiresAccuracy: true,
    damageBase: manualScript.damageBase,
    damageClass: manualScript.damageClass,
    type: manualScript.type,
    ac: manualScript.ac,
    range: manualScript.range,
    effect: manualScript.effect,
    special: manualScript.special,
    keywords: manualScript.keywords,
    criticalRange: manualScript.criticalRange,
    areaTemplates: manualScript.areaTemplates,
    conditionSuggestions: [{
      recipient: 'target',
      condition: 'Poisoned',
      action: 'add',
      label: 'Poisoned on even roll',
      threshold: 'even roll',
      optional: true,
    }],
    stageSuggestions: [],
    hpSuggestions: [],
    fieldSuggestions: [],
    hazardSuggestions: [],
    automationNotes: [
      'Use the Line 2 template to confirm affected legal targets, or select targets manually.',
      'Poison is applied only to hit targets whose natural accuracy roll is even.',
    ],
  })
}

const reviewedPsywaveScript = (version = 1): MoveAutomationScript => {
  const move = findMove('Psywave')
  if (!move) throw new Error('Missing canonical PTU move data for Psywave')
  const manualScript = createManualMoveAutomationScript(move)
  return defineExplicitMoveScript({
    moveName: manualScript.moveName,
    version,
    targetMode: 'one-target',
    targetCount: 1,
    damaging: true,
    requiresAccuracy: true,
    damageBase: null,
    damageClass: manualScript.damageClass,
    type: manualScript.type,
    ac: manualScript.ac,
    range: manualScript.range,
    effect: manualScript.effect,
    special: manualScript.special,
    keywords: manualScript.keywords,
    criticalRange: null,
    areaTemplates: manualScript.areaTemplates,
    directHpLoss: {
      kind: 'user-level-roll-table',
      rollFormula: '1d4',
      rollTable: [
        { roll: 1, multiplier: 0.5, label: 'Half user level' },
        { roll: 2, multiplier: 1, label: 'User level' },
        { roll: 3, multiplier: 1.5, label: 'One and a half times user level' },
        { roll: 4, multiplier: 2, label: 'Double user level' },
      ],
      applyTypeImmunity: true,
      ignoreWeaknessResistance: true,
      ignoreStats: true,
      label: 'Psywave level-scaled HP loss',
    },
    conditionSuggestions: [],
    stageSuggestions: [],
    hpSuggestions: [],
    fieldSuggestions: [],
    hazardSuggestions: [],
    automationNotes: [
      'Psywave rolls 1d4 for direct HP loss based on the user’s Level; fractions round down by PTU rules.',
      'Weakness, resistance, Stats, STAB, and critical hits are ignored; type immunity still prevents HP loss.',
    ],
  })
}

const REVIEWED_TARGET_STAGE_AREA_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Acid', reviewedTargetStagesAreaScript('Acid', [{ key: 'sdef', delta: -1, label: 'Acid lowers Special Defense on 18+: -1 Special Defense CS', threshold: '18+' }])],
  ['Apple Acid', reviewedTargetStagesAreaScript('Apple Acid', [{ key: 'sdef', delta: -1, label: 'Apple Acid lowers Special Defense: -1 Special Defense CS' }])],
  ['Breaking Swipe', reviewedTargetStagesAreaScript('Breaking Swipe', [{ key: 'atk', delta: -1, label: 'Breaking Swipe lowers Attack: -1 Attack CS' }])],
  ['Bubble', reviewedTargetStagesAreaScript('Bubble', [{ key: 'spd', delta: -1, label: 'Bubble lowers Speed on 16+: -1 Speed CS', threshold: '16+' }])],
  ['Bulldoze', reviewedTargetStagesAreaScript('Bulldoze', [{ key: 'spd', delta: -1, label: 'Bulldoze lowers Speed: -1 Speed CS' }])],
  ['Cotton Spore', reviewedTargetStagesAreaScript('Cotton Spore', [{ key: 'spd', delta: -2, label: 'Cotton Spore lowers Speed: -2 Speed CS' }])],
  ['Feather Dance', reviewedTargetStagesAreaScript('Feather Dance', [{ key: 'atk', delta: -2, label: 'Feather Dance lowers Attack: -2 Attack CS' }])],
  ['Flash', reviewedTargetStagesAreaScript('Flash', [{ key: 'acc', delta: -1, label: 'Flash lowers Accuracy: -1 Accuracy CS' }])],
  ['Growl', reviewedTargetStageAreaScript('Growl', 'atk', 'Growl lowers Attack: -1 Attack CS')],
  ['Icy Wind', reviewedTargetStagesAreaScript('Icy Wind', [{ key: 'spd', delta: -1, label: 'Icy Wind lowers Speed: -1 Speed CS' }])],
  ['Leer', reviewedTargetStageAreaScript('Leer', 'def', 'Leer lowers Defense: -1 Defense CS')],
  ['Metal Sound', reviewedTargetStagesAreaScript('Metal Sound', [{ key: 'sdef', delta: -2, label: 'Metal Sound lowers Special Defense: -2 Special Defense CS' }])],
  ['Noble Roar', reviewedTargetStagesAreaScript('Noble Roar', [
    { key: 'atk', delta: -1, label: 'Noble Roar lowers Attack: -1 Attack CS' },
    { key: 'satk', delta: -1, label: 'Noble Roar lowers Special Attack: -1 Special Attack CS' },
  ])],
  ['Screech', reviewedTargetStagesAreaScript('Screech', [{ key: 'def', delta: -2, label: 'Screech lowers Defense: -2 Defense CS' }])],
  ['Snarl', reviewedTargetStagesAreaScript('Snarl', [{ key: 'satk', delta: -1, label: 'Snarl lowers Special Attack: -1 Special Attack CS' }])],
  ['Struggle Bug', reviewedTargetStagesAreaScript('Struggle Bug', [{ key: 'satk', delta: -1, label: 'Struggle Bug lowers Special Attack: -1 Special Attack CS' }])],
  ['Tail Whip', reviewedTargetStagesAreaScript('Tail Whip', [{ key: 'def', delta: -1, label: 'Tail Whip lowers Defense: -1 Defense CS' }])],
  ['Tearful Look', reviewedTargetStagesAreaScript('Tearful Look', [
    { key: 'atk', delta: -1, label: 'Tearful Look lowers Attack: -1 Attack CS' },
    { key: 'satk', delta: -1, label: 'Tearful Look lowers Special Attack: -1 Special Attack CS' },
  ])],
])

const REVIEWED_AREA_CONFIRMATION_SCRIPT_NAMES = [
  'Air Cutter',
  'Boomburst',
  'Brutal Swing',
  'Dazzling Gleam',
  'Discharge',
  'Heat Wave',
  'Lava Plume',
  'Origin Pulse',
  'Overdrive',
  'Petal Blizzard',
  'Powder Snow',
  'Precipice Blades',
  'Razor Leaf',
  'Searing Shot',
  'Steam Eruption',
  'Strange Steam',
]

const REVIEWED_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  REVIEWED_AREA_CONFIRMATION_SCRIPT_NAMES.map((name) => [name, reviewedAreaConfirmationScript(name)]),
)

const REVIEWED_AREA_CONDITION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Teeter Dance', reviewedAreaConditionScript('Teeter Dance', [{ condition: 'Confused', label: 'Confused' }])],
])

const REVIEWED_SMOG_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Smog', reviewedSmogScript()],
])

const REVIEWED_DIRECT_HP_LOSS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Psywave', reviewedPsywaveScript()],
])

const SEAMLESS_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ...REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
  ...REVIEWED_AREA_CONFIRMATION_SCRIPTS,
  ...REVIEWED_AREA_CONDITION_SCRIPTS,
  ...REVIEWED_SMOG_SCRIPTS,
])

const SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPT_NAMES = [
  ...STRUGGLE_ATTACK_MOVE_NAMES,
  'Air Slash',
  'Aqua Jet',
  'Aqua Tail',
  'Attack Order',
  'Bite',
  'Blaze Kick',
  'Blue Flare',
  'Body Slam',
  'Bolt Strike',
  'Bone Club',
  'Bullet Punch',
  'Crabhammer',
  'Cross Chop',
  'Dark Pulse',
  'Dragon Breath',
  'Dragon Claw',
  'Dragon Pulse',
  'Drill Run',
  'Ember',
  'Esper Wing',
  'Extrasensory',
  'Fairy Wind',
  'Fire Blast',
  'Fire Punch',
  'Flamethrower',
  'Force Palm',
  'Gunk Shot',
  'Headbutt',
  'Heart Stamp',
  'Hyper Fang',
  'Ice Beam',
  'Ice Punch',
  'Ice Shard',
  'Icicle Crash',
  'Karate Chop',
  'Leaf Blade',
  'Lick',
  'Mach Punch',
  'Mega Punch',
  'Needle Arm',
  'Night Slash',
  'Peck',
  'Poison Jab',
  'Poison Sting',
  'Pound',
  'Power Gem',
  'Power Whip',
  'Psycho Cut',
  'Pyro Ball',
  'Quick Attack',
  'Rock Throw',
  'Rolling Kick',
  'Scald',
  'Scorching Sands',
  'Scratch',
  'Seed Bomb',
  'Shadow Claw',
  'Shadow Sneak',
  'Slash',
  'Sludge',
  'Sludge Bomb',
  'Stone Edge',
  'Thunder Punch',
  'Thunder Shock',
  'Thunderbolt',
  'Vacuum Wave',
  'Vice Grip',
  'Vine Whip',
  'Water Gun',
  'Waterfall',
  'Wing Attack',
  'Zing Zap',
]

const REVIEWED_SINGLE_TARGET_STATUS_SCRIPT_NAMES = [
  'Confuse Ray',
  'Glare',
  'Grass Whistle',
  'Hypnosis',
  'Lovely Kiss',
  'Poison Powder',
  'Sleep Powder',
  'Stun Spore',
  'Will-O-Wisp',
]

const REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Confusion', reviewedSingleTargetConditionScript('Confusion', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Cross Poison', reviewedSingleTargetConditionScript('Cross Poison', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Dizzy Punch', reviewedSingleTargetConditionScript('Dizzy Punch', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Poison Fang', reviewedSingleTargetConditionScript('Poison Fang', [{ condition: 'Badly Poisoned', label: 'Badly Poisoned on 17+', threshold: '17+' }])],
  ['Poison Tail', reviewedSingleTargetConditionScript('Poison Tail', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Psybeam', reviewedSingleTargetConditionScript('Psybeam', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Signal Beam', reviewedSingleTargetConditionScript('Signal Beam', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Water Pulse', reviewedSingleTargetConditionScript('Water Pulse', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
])

const REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Acid Spray', reviewedSingleTargetStageScript('Acid Spray', [{ key: 'sdef', delta: -2, label: 'Acid Spray lowers Special Defense: -2 Special Defense CS' }])],
  ['Aurora Beam', reviewedSingleTargetStageScript('Aurora Beam', [{ key: 'atk', delta: -1, label: 'Aurora Beam lowers Attack on 18+: -1 Attack CS', threshold: '18+' }])],
  ['Bubble Beam', reviewedSingleTargetStageScript('Bubble Beam', [{ key: 'spd', delta: -1, label: 'Bubble Beam lowers Speed on 18+: -1 Speed CS', threshold: '18+' }])],
  ['Crunch', reviewedSingleTargetStageScript('Crunch', [{ key: 'def', delta: -1, label: 'Crunch lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Drum Beating', reviewedSingleTargetStageScript('Drum Beating', [{ key: 'spd', delta: -1, label: 'Drum Beating lowers Speed: -1 Speed CS' }])],
  ['Energy Ball', reviewedSingleTargetStageScript('Energy Ball', [{ key: 'sdef', delta: -1, label: 'Energy Ball lowers Special Defense on 17+: -1 Special Defense CS', threshold: '17+' }])],
  ['Fire Lash', reviewedSingleTargetStageScript('Fire Lash', [{ key: 'def', delta: -1, label: 'Fire Lash lowers Defense: -1 Defense CS' }])],
  ['Flash Cannon', reviewedSingleTargetStageScript('Flash Cannon', [{ key: 'sdef', delta: -1, label: 'Flash Cannon lowers Special Defense on 17+: -1 Special Defense CS', threshold: '17+' }])],
  ['Focus Blast', reviewedSingleTargetStageScript('Focus Blast', [{ key: 'sdef', delta: -1, label: 'Focus Blast lowers Special Defense on 18+: -1 Special Defense CS', threshold: '18+' }])],
  ['Grav Apple', reviewedSingleTargetStageScript('Grav Apple', [{ key: 'def', delta: -1, label: 'Grav Apple lowers Defense: -1 Defense CS' }])],
  ['Iron Tail', reviewedSingleTargetStageScript('Iron Tail', [{ key: 'def', delta: -1, label: 'Iron Tail lowers Defense on 15+: -1 Defense CS', threshold: '15+' }])],
  ['Liquidation', reviewedSingleTargetStageScript('Liquidation', [{ key: 'def', delta: -1, label: 'Liquidation lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Low Sweep', reviewedSingleTargetStageScript('Low Sweep', [{ key: 'spd', delta: -1, label: 'Low Sweep lowers Speed: -1 Speed CS' }])],
  ['Luster Purge', reviewedSingleTargetStageScript('Luster Purge', [{ key: 'sdef', delta: -1, label: 'Luster Purge lowers Special Defense on even roll: -1 Special Defense CS', threshold: 'even roll' }])],
  ['Mist Ball', reviewedSingleTargetStageScript('Mist Ball', [{ key: 'satk', delta: -1, label: 'Mist Ball lowers Special Attack on even roll: -1 Special Attack CS', threshold: 'even roll' }])],
  ['Moonblast', reviewedSingleTargetStageScript('Moonblast', [{ key: 'satk', delta: -1, label: 'Moonblast lowers Special Attack on 15+: -1 Special Attack CS', threshold: '15+' }])],
  ['Mud-Slap', reviewedSingleTargetStageScript('Mud-Slap', [{ key: 'acc', delta: -1, label: 'Mud-Slap lowers Accuracy: -1 Accuracy CS' }])],
  ['Mystical Fire', reviewedSingleTargetStageScript('Mystical Fire', [{ key: 'satk', delta: -1, label: 'Mystical Fire lowers Special Attack: -1 Special Attack CS' }])],
  ['Night Daze', reviewedSingleTargetStageScript('Night Daze', [{ key: 'acc', delta: -1, label: 'Night Daze lowers Accuracy on 13+: -1 Accuracy CS', threshold: '13+' }])],
  ['Play Rough', reviewedSingleTargetStageScript('Play Rough', [{ key: 'atk', delta: -1, label: 'Play Rough lowers Attack on 17-20: -1 Attack CS', threshold: '17-20' }])],
  ['Rock Smash', reviewedSingleTargetStageScript('Rock Smash', [{ key: 'def', delta: -1, label: 'Rock Smash lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Rock Tomb', reviewedSingleTargetStageScript('Rock Tomb', [{ key: 'spd', delta: -1, label: 'Rock Tomb lowers Speed: -1 Speed CS' }])],
  ['Shadow Ball', reviewedSingleTargetStageScript('Shadow Ball', [{ key: 'sdef', delta: -1, label: 'Shadow Ball lowers Special Defense on 17+: -1 Special Defense CS', threshold: '17+' }])],
  ['Shadow Bone', reviewedSingleTargetStageScript('Shadow Bone', [{ key: 'def', delta: -1, label: 'Shadow Bone lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Spirit Break', reviewedSingleTargetStageScript('Spirit Break', [{ key: 'satk', delta: -1, label: 'Spirit Break lowers Special Attack: -1 Special Attack CS' }])],
])

const STRUGGLE_ATTACK_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  STRUGGLE_ATTACK_MOVE_NAMES.map((name) => [name, reviewedSingleTargetAttackScript(name)]),
)

export const SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPT_NAMES.map((name) => [name, reviewedSingleTargetAttackScript(name)]),
)

const REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  REVIEWED_SINGLE_TARGET_STATUS_SCRIPT_NAMES.map((name) => [name, reviewedSingleTargetStatusScript(name)]),
)

const hasReviewedSeamlessSingleTargetScript = (script: MoveAutomationScript): boolean =>
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS.has(script.moveName)
  || (REVIEWED_DIRECT_HP_LOSS_SCRIPTS.has(script.moveName) && Boolean(script.directHpLoss))

export const isSeamlessSingleTargetAttackScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && (
      SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
      || REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS.has(script.moveName)
      || REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS.has(script.moveName)
    )
    && script.targetMode === 'one-target'
    && script.targetCount === 1
    && script.requiresAccuracy
    && script.damaging,
)

export const isSeamlessSingleTargetMoveScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => {
  if (!script) return false
  return Boolean(
    script.kind === 'explicit'
      && hasReviewedSeamlessSingleTargetScript(script)
      && script.targetMode === 'one-target'
      && script.targetCount === 1
      && script.requiresAccuracy,
  )
}

export const isSeamlessAreaConfirmationScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && SEAMLESS_AREA_CONFIRMATION_SCRIPTS.has(script.moveName)
    && script.targetMode === 'multi-target'
    && script.areaTemplates?.length,
)

/**
 * Human-reviewed move automation scripts. A move only counts as automated when
 * an explicit entry is added here (or moved into per-move modules later). Small
 * factories may copy canonical move data, but the registry itself remains an
 * allow-list of reviewed automation coverage.
 */
export const EXPLICIT_MOVE_AUTOMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map<string, MoveAutomationScript>([
  ...STRUGGLE_ATTACK_SCRIPTS,
  ...SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS,
  ...REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS,
  ...REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS,
  ...REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS,
  ...SEAMLESS_AREA_CONFIRMATION_SCRIPTS,
  ...REVIEWED_DIRECT_HP_LOSS_SCRIPTS,
])

export const moveAutomationCoverage = {
  canonicalMoveCount: moves.length,
  explicitScriptCount: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
  missing: moves
    .filter((move) => !EXPLICIT_MOVE_AUTOMATION_SCRIPTS.has(move.name))
    .map((move) => move.name),
}

export const explicitScriptForMove = (moveName: string): MoveAutomationScript | null => {
  const direct = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName)
  if (direct) return direct

  const canonical = findMove(moveName)
  return canonical ? EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(canonical.name) ?? null : null
}

export const fieldEffectDamageBonus = (attackType: string, fieldEffects: MapFieldEffects | null | undefined): number => {
  let bonus = 0
  const weather = fieldEffects?.weather ?? []
  if (weather.some((effect) => effect.kind === 'sunny')) {
    if (attackType === 'Fire') bonus += 5
    if (attackType === 'Water') bonus -= 5
  }
  if (weather.some((effect) => effect.kind === 'rainy')) {
    if (attackType === 'Water') bonus += 5
    if (attackType === 'Fire') bonus -= 5
  }
  const terrains = fieldEffects?.terrains ?? []
  if (terrains.some((effect) => effect.kind === 'electric') && attackType === 'Electric') bonus += 10
  if (terrains.some((effect) => effect.kind === 'grassy') && attackType === 'Grass') bonus += 10
  if (terrains.some((effect) => effect.kind === 'psychic') && attackType === 'Psychic') bonus += 10
  if (terrains.some((effect) => effect.kind === 'misty') && attackType === 'Dragon') bonus -= 10
  return bonus
}
