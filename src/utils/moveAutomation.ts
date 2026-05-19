import { findMove, moves } from '~~/data/ptuReference'
import {
  MOVE_DAMAGE_BASE_TABLE,
  formatMoveDamageBase,
  rollMoveDamageFormula,
} from '~/utils/moveDamageBase'
import {
  createMoveAutomationScriptFromMoveData,
  damageFormulaForMoveData,
} from '~/utils/moveAutomationDerived'
import { STRUGGLE_ATTACK_MOVE_NAMES } from '~/utils/struggleMoves'
import {
  ELECTRIC_RESISTANT_COAT_CONDITION,
  HELPING_HAND_CONDITION,
  REFLECT_BLESSING_CONDITION,
  SUPERSONIC_ACCURACY_PENALTY_CONDITION,
} from '~/utils/moveAutomationSpecialConditions'
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

export const damageFormulaForMove = damageFormulaForMoveData

export const buildMoveAutomationScriptFromMoveData = createMoveAutomationScriptFromMoveData

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
  applyWhen?: MoveAutomationScript['conditionSuggestions'][number]['applyWhen']
}

const reviewedMoveScriptFromCanonical = (
  moveName: string,
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => {
  const move = findMove(moveName)
  if (!move) throw new Error(`Missing canonical PTU move data for ${moveName}`)
  const derivedScript = createMoveAutomationScriptFromMoveData(move)
  return defineExplicitMoveScript({
    moveName: derivedScript.moveName,
    version,
    targetMode: derivedScript.targetMode,
    targetCount: derivedScript.targetCount,
    damaging: derivedScript.damaging,
    requiresAccuracy: derivedScript.requiresAccuracy,
    damageBase: derivedScript.damageBase,
    damageClass: derivedScript.damageClass,
    type: derivedScript.type,
    ac: derivedScript.ac,
    range: derivedScript.range,
    effect: derivedScript.effect,
    special: derivedScript.special,
    keywords: derivedScript.keywords,
    criticalRange: derivedScript.criticalRange,
    areaTemplates: derivedScript.areaTemplates,
    conditionSuggestions: derivedScript.conditionSuggestions,
    stageSuggestions: derivedScript.stageSuggestions,
    hpSuggestions: derivedScript.hpSuggestions,
    fieldSuggestions: derivedScript.fieldSuggestions,
    hazardSuggestions: derivedScript.hazardSuggestions,
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

const userStageSuggestions = (stages: readonly ReviewedTargetStageDefinition[]): MoveAutomationScript['stageSuggestions'] =>
  stages.map((stage) => ({
    recipient: 'user',
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
    ...(condition.applyWhen ? { applyWhen: condition.applyWhen } : {}),
  }))

const areaAutomationNotes = (): string[] => [
  'Use the area-template buttons to choose affected legal targets, or select targets manually.',
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
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  conditionSuggestions: targetConditionSuggestions(conditions),
  ...overrides,
})

const reviewedSingleTargetConditionAndStageScript = (
  moveName: string,
  conditions: readonly ReviewedTargetConditionDefinition[],
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  conditionSuggestions: targetConditionSuggestions(conditions),
  stageSuggestions: targetStageSuggestions(stages),
  ...overrides,
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

const reviewedSelfStageScript = (
  moveName: string,
  stages: readonly ReviewedTargetStageDefinition[],
  version = 1,
  overrides: ReviewedMoveScriptOverrides = {},
): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'self',
  targetCount: 1,
  requiresAccuracy: false,
  stageSuggestions: userStageSuggestions(stages),
  ...overrides,
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
    automationNotes: overrides.automationNotes ?? areaAutomationNotes(),
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
  const derivedScript = createMoveAutomationScriptFromMoveData(move)
  return defineExplicitMoveScript({
    moveName: derivedScript.moveName,
    version,
    targetMode: 'multi-target',
    targetCount: null,
    damaging: true,
    requiresAccuracy: true,
    damageBase: derivedScript.damageBase,
    damageClass: derivedScript.damageClass,
    type: derivedScript.type,
    ac: derivedScript.ac,
    range: derivedScript.range,
    effect: derivedScript.effect,
    special: derivedScript.special,
    keywords: derivedScript.keywords,
    criticalRange: derivedScript.criticalRange,
    areaTemplates: derivedScript.areaTemplates,
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
  const derivedScript = createMoveAutomationScriptFromMoveData(move)
  return defineExplicitMoveScript({
    moveName: derivedScript.moveName,
    version,
    targetMode: 'one-target',
    targetCount: 1,
    damaging: true,
    requiresAccuracy: true,
    damageBase: null,
    damageClass: derivedScript.damageClass,
    type: derivedScript.type,
    ac: derivedScript.ac,
    range: derivedScript.range,
    effect: derivedScript.effect,
    special: derivedScript.special,
    keywords: derivedScript.keywords,
    criticalRange: null,
    areaTemplates: derivedScript.areaTemplates,
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

const reviewedDragonRageScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Dragon Rage', version, {
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: null,
  criticalRange: null,
  directHpLoss: {
    kind: 'fixed',
    amount: 15,
    applyTypeImmunity: true,
    ignoreWeaknessResistance: true,
    ignoreStats: true,
    label: 'Dragon Rage fixed HP loss',
  },
  conditionSuggestions: [],
  hpSuggestions: [],
  automationNotes: [
    'Dragon Rage applies exactly 15 HP loss on a hit; Stats, weakness/resistance, STAB, and critical hits are ignored.',
    'Dragon-type immunity still prevents the HP loss.',
  ],
})

const reviewedFiveStrikeScript = (moveName: string, version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  dynamicDamageBase: {
    kind: 'five-strike',
    rollFormula: '1d8',
    label: `${moveName} Five Strike`,
  },
  automationNotes: [
    'Five Strike is rolled automatically after a hit: 1=one hit, 2-3=two hits, 4-6=three hits, 7=four hits, 8=five hits.',
    'STAB is applied after strike-count Damage Base multiplication.',
    'Technician and other non-STAB Damage Base modifiers are not inferred; adjust the move before use if they apply.',
  ],
})

const reviewedDoubleStrikeScript = (moveName: string, version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical(moveName, version, {
  targetMode: 'one-target',
  targetCount: 1,
  dynamicDamageBase: {
    kind: 'double-strike',
    label: `${moveName} Double Strike`,
  },
  automationNotes: [
    'Double Strike rolls two Accuracy Rolls automatically: one hit uses the base Damage Base; two hits double the Damage Base.',
    'Each hit can crit separately; critical bonus damage is rolled from the Move’s base Damage Base before doubling.',
    'STAB is applied after Double Strike Damage Base multiplication.',
  ],
})

const reviewedPowerTripScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Power Trip', version, {
  targetMode: 'one-target',
  targetCount: 1,
  dynamicDamageBase: {
    kind: 'positive-combat-stage-scaling',
    dbPerPositiveStage: 2,
    maxDamageBase: 20,
    label: 'Power Trip Damage Base scaling',
  },
  automationNotes: [
    'Power Trip recalculates Damage Base from the user’s current positive Combat Stages at resolution time.',
    'The Power Trip bonus caps at DB 20 before this automation applies STAB.',
  ],
})

const ACUPRESSURE_STAGE_BOOSTS: readonly ReviewedTargetStageDefinition[] = [
  { key: 'atk', delta: 2, label: 'Acupressure raises Attack: +2 Attack CS', optional: true },
  { key: 'def', delta: 2, label: 'Acupressure raises Defense: +2 Defense CS', optional: true },
  { key: 'satk', delta: 2, label: 'Acupressure raises Special Attack: +2 Special Attack CS', optional: true },
  { key: 'sdef', delta: 2, label: 'Acupressure raises Special Defense: +2 Special Defense CS', optional: true },
  { key: 'spd', delta: 2, label: 'Acupressure raises Speed: +2 Speed CS', optional: true },
  { key: 'acc', delta: 2, label: 'Acupressure raises Accuracy: +2 Accuracy CS', optional: true },
]

const reviewedAcupressureScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Acupressure', version, {
  targetMode: 'one-target',
  targetCount: 1,
  stageSuggestions: targetStageSuggestions(ACUPRESSURE_STAGE_BOOSTS),
  randomStageSuggestion: {
    kind: 'roll-table',
    rollFormula: '1d6',
    label: 'Acupressure',
    entries: ACUPRESSURE_STAGE_BOOSTS.map((boost, index) => ({
      roll: index + 1,
      stageSuggestionIndex: index,
      label: boost.label,
    })),
  },
  automationNotes: [
    'Acupressure rolls 1d6 automatically after a successful accuracy roll and applies the matching +2 Combat Stage boost.',
    'The range includes Self; select the user token in the targeting overlay to apply Acupressure to itself.',
  ],
})

const reviewedAbsorbScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Absorb', version, {
  targetMode: 'one-target',
  targetCount: 1,
  hpSuggestions: [{
    recipient: 'user',
    mode: 'heal-percent-damage-dealt',
    percent: 50,
    label: 'Absorb heals user for half damage dealt',
  }],
})

const reviewedMudSportScript = (version = 1): MoveAutomationScript => reviewedAreaConfirmationScript('Mud Sport', version, {
  conditionSuggestions: [
    {
      recipient: 'user',
      condition: ELECTRIC_RESISTANT_COAT_CONDITION,
      action: 'add',
      label: 'Mud Sport grants Electric-Resistant Coat',
    },
    {
      recipient: 'target',
      condition: ELECTRIC_RESISTANT_COAT_CONDITION,
      action: 'add',
      label: 'Mud Sport grants Electric-Resistant Coat',
    },
  ],
  automationNotes: [
    'Burst 2 is shown as an area overlay; the user also receives the Coat even though the user token is not a selectable target.',
    'Electric-Resistant Coat is consumed automatically after a damaging Electric-Type move hits that token.',
  ],
})

const reviewedHowlScript = (version = 1): MoveAutomationScript => reviewedAreaConfirmationScript('Howl', version, {
  requiresAccuracy: false,
  stageSuggestions: [
    { recipient: 'user', key: 'atk', delta: 1, label: "Howl raises user's Attack: +1 Attack CS" },
    { recipient: 'target', key: 'atk', delta: 1, label: "Howl raises allies' Attack: +1 Attack CS" },
  ],
  automationNotes: [
    'Burst 1 is shown as an area overlay; the user also receives the Attack boost even though the user token is not a selectable target.',
    'Howl affects allies only. Team allegiance is not tracked, so verify affected tokens are allies or correct Combat Stages manually afterward.',
  ],
})

const reviewedSynthesisScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Synthesis', version, {
  targetMode: 'self',
  targetCount: 1,
  requiresAccuracy: false,
  hpSuggestions: [{
    recipient: 'user',
    mode: 'heal-percent-max',
    percent: 50,
    weatherPercentOverrides: {
      sunny: 200 / 3,
      rainy: 25,
      sandstorm: 25,
      hail: 25,
    },
    rounding: 'floor',
    label: 'Synthesis heals weather-adjusted HP',
  }],
  automationNotes: [
    'Synthesis heals 1/2 Max HP normally, 2/3 Max HP in Sunny Weather, or 1/4 Max HP in Rain, Sandstorm, or Hail.',
  ],
})

const reviewedReflectScript = (version = 1): MoveAutomationScript => reviewedMoveScriptFromCanonical('Reflect', version, {
  targetMode: 'self',
  targetCount: 1,
  requiresAccuracy: false,
  conditionSuggestions: [{
    recipient: 'user',
    condition: REFLECT_BLESSING_CONDITION,
    action: 'add',
    label: 'Reflect Blessing (2 activations)',
  }],
  automationNotes: [
    'Reflect creates a team Blessing shared by allies; this marker tracks the side’s 2 activations on the user token.',
    'Remove the marker after both activations are spent, or move it manually if your table tracks side effects elsewhere.',
  ],
})

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
  ['Poison Gas', reviewedAreaConditionScript('Poison Gas', [{ condition: 'Poisoned', label: 'Poisoned' }])],
  ['Rock Slide', reviewedAreaConditionScript('Rock Slide', [{ condition: 'Flinch', label: 'Flinch on 17+', threshold: '17+' }])],
  ['Sludge Wave', reviewedAreaConditionScript('Sludge Wave', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Teeter Dance', reviewedAreaConditionScript('Teeter Dance', [{ condition: 'Confused', label: 'Confused' }])],
])

const REVIEWED_SMOG_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Smog', reviewedSmogScript()],
])

const REVIEWED_DIRECT_HP_LOSS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Dragon Rage', reviewedDragonRageScript()],
  ['Psywave', reviewedPsywaveScript()],
])

const REVIEWED_AREA_COAT_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Mud Sport', reviewedMudSportScript()],
])

const REVIEWED_ALLY_AREA_STAGE_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Howl', reviewedHowlScript()],
])

const SEAMLESS_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ...REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
  ...REVIEWED_AREA_CONFIRMATION_SCRIPTS,
  ...REVIEWED_AREA_CONDITION_SCRIPTS,
  ...REVIEWED_SMOG_SCRIPTS,
  ...REVIEWED_AREA_COAT_SCRIPTS,
  ...REVIEWED_ALLY_AREA_STAGE_SCRIPTS,
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
  'Drill Peck',
  'Drill Run',
  'Ember',
  'Esper Wing',
  'Extrasensory',
  'Extreme Speed',
  'Fairy Wind',
  'Fire Blast',
  'Fire Punch',
  'Flamethrower',
  'Force Palm',
  'Gunk Shot',
  'Headbutt',
  'Heart Stamp',
  'Horn Attack',
  'Hyper Fang',
  'Ice Beam',
  'Ice Punch',
  'Ice Shard',
  'Icicle Crash',
  'Karate Chop',
  'Leaf Blade',
  'Lick',
  'Mach Punch',
  'Magical Leaf',
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
  'X-Scissor',
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
  ['Astonish', reviewedSingleTargetConditionScript('Astonish', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }], 1, {
    automationNotes: ['Astonish’s once-per-scene automatic Flinch against an unaware target is not inferred; apply Flinch manually if that clause applies.'],
  })],
  ['Confusion', reviewedSingleTargetConditionScript('Confusion', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Cross Poison', reviewedSingleTargetConditionScript('Cross Poison', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Dizzy Punch', reviewedSingleTargetConditionScript('Dizzy Punch', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Flame Wheel', reviewedSingleTargetConditionScript('Flame Wheel', [{ condition: 'Burned', label: 'Burned on 19+', threshold: '19+' }])],
  ['Flatter', reviewedSingleTargetConditionAndStageScript('Flatter',
    [{ condition: 'Confused', label: 'Confused' }],
    [{ key: 'satk', delta: 1, label: 'Flatter raises Special Attack: +1 Special Attack CS' }],
  )],
  ['Iron Head', reviewedSingleTargetConditionScript('Iron Head', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
  ['Mountain Gale', reviewedSingleTargetConditionScript('Mountain Gale', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
  ['Nuzzle', reviewedSingleTargetConditionScript('Nuzzle', [{ condition: 'Paralysis', label: 'Paralysis' }])],
  ['Poison Fang', reviewedSingleTargetConditionScript('Poison Fang', [{ condition: 'Badly Poisoned', label: 'Badly Poisoned on 17+', threshold: '17+' }])],
  ['Poison Tail', reviewedSingleTargetConditionScript('Poison Tail', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Psybeam', reviewedSingleTargetConditionScript('Psybeam', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Rock Climb', reviewedSingleTargetConditionScript('Rock Climb', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Sacred Fire', reviewedSingleTargetConditionScript('Sacred Fire', [{ condition: 'Burned', label: 'Burned on even roll', threshold: 'even roll' }])],
  ['Sand Attack', reviewedSingleTargetConditionScript('Sand Attack', [{ condition: 'Blindness', label: 'Blindness' }])],
  ['Signal Beam', reviewedSingleTargetConditionScript('Signal Beam', [{ condition: 'Confused', label: 'Confused on 19+', threshold: '19+' }])],
  ['Spark', reviewedSingleTargetConditionScript('Spark', [{ condition: 'Paralysis', label: 'Paralysis on 15+', threshold: '15+' }])],
  ['Swagger', reviewedSingleTargetConditionAndStageScript('Swagger',
    [{ condition: 'Confused', label: 'Confused' }],
    [{ key: 'atk', delta: 2, label: 'Swagger raises Attack: +2 Attack CS' }],
  )],
  ['Taunt', reviewedSingleTargetConditionScript('Taunt', [{ condition: 'Rage', label: 'Enraged' }])],
  ['Water Pulse', reviewedSingleTargetConditionScript('Water Pulse', [{ condition: 'Confused', label: 'Confused on 17+', threshold: '17+' }])],
  ['Zen Headbutt', reviewedSingleTargetConditionScript('Zen Headbutt', [{ condition: 'Flinch', label: 'Flinch on 15+', threshold: '15+' }])],
])

const REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Acid Spray', reviewedSingleTargetStageScript('Acid Spray', [{ key: 'sdef', delta: -2, label: 'Acid Spray lowers Special Defense: -2 Special Defense CS' }])],
  ['Aurora Beam', reviewedSingleTargetStageScript('Aurora Beam', [{ key: 'atk', delta: -1, label: 'Aurora Beam lowers Attack on 18+: -1 Attack CS', threshold: '18+' }])],
  ['Baby-Doll Eyes', reviewedSingleTargetStageScript('Baby-Doll Eyes', [{ key: 'atk', delta: -1, label: 'Baby-Doll Eyes lowers Attack: -1 Attack CS' }])],
  ['Bubble Beam', reviewedSingleTargetStageScript('Bubble Beam', [{ key: 'spd', delta: -1, label: 'Bubble Beam lowers Speed on 18+: -1 Speed CS', threshold: '18+' }])],
  ['Charm', reviewedSingleTargetStageScript('Charm', [{ key: 'atk', delta: -2, label: 'Charm lowers Attack: -2 Attack CS' }])],
  ['Confide', reviewedSingleTargetStageScript('Confide', [{ key: 'satk', delta: -1, label: 'Confide lowers Special Attack: -1 Special Attack CS' }])],
  ['Crunch', reviewedSingleTargetStageScript('Crunch', [{ key: 'def', delta: -1, label: 'Crunch lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Crush Claw', reviewedSingleTargetStageScript('Crush Claw', [{ key: 'def', delta: -1, label: 'Crush Claw lowers Defense on even roll: -1 Defense CS', threshold: 'even roll' }])],
  ['Drum Beating', reviewedSingleTargetStageScript('Drum Beating', [{ key: 'spd', delta: -1, label: 'Drum Beating lowers Speed: -1 Speed CS' }])],
  ['Eerie Impulse', reviewedSingleTargetStageScript('Eerie Impulse', [{ key: 'satk', delta: -2, label: 'Eerie Impulse lowers Special Attack: -2 Special Attack CS' }])],
  ['Energy Ball', reviewedSingleTargetStageScript('Energy Ball', [{ key: 'sdef', delta: -1, label: 'Energy Ball lowers Special Defense on 17+: -1 Special Defense CS', threshold: '17+' }])],
  ['Fake Tears', reviewedSingleTargetStageScript('Fake Tears', [{ key: 'sdef', delta: -2, label: 'Fake Tears lowers Special Defense: -2 Special Defense CS' }])],
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
  ['Mud Shot', reviewedSingleTargetStageScript('Mud Shot', [{ key: 'spd', delta: -1, label: 'Mud Shot lowers Speed: -1 Speed CS' }])],
  ['Mud-Slap', reviewedSingleTargetStageScript('Mud-Slap', [{ key: 'acc', delta: -1, label: 'Mud-Slap lowers Accuracy: -1 Accuracy CS' }])],
  ['Mystical Fire', reviewedSingleTargetStageScript('Mystical Fire', [{ key: 'satk', delta: -1, label: 'Mystical Fire lowers Special Attack: -1 Special Attack CS' }])],
  ['Night Daze', reviewedSingleTargetStageScript('Night Daze', [{ key: 'acc', delta: -1, label: 'Night Daze lowers Accuracy on 13+: -1 Accuracy CS', threshold: '13+' }])],
  ['Play Nice', reviewedSingleTargetStageScript('Play Nice', [{ key: 'atk', delta: -1, label: 'Play Nice lowers Attack: -1 Attack CS' }])],
  ['Play Rough', reviewedSingleTargetStageScript('Play Rough', [{ key: 'atk', delta: -1, label: 'Play Rough lowers Attack on 17-20: -1 Attack CS', threshold: '17-20' }])],
  ['Razor Shell', reviewedSingleTargetStageScript('Razor Shell', [{ key: 'def', delta: -1, label: 'Razor Shell lowers Defense on even roll: -1 Defense CS', threshold: 'even roll' }])],
  ['Rock Smash', reviewedSingleTargetStageScript('Rock Smash', [{ key: 'def', delta: -1, label: 'Rock Smash lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Rock Tomb', reviewedSingleTargetStageScript('Rock Tomb', [{ key: 'spd', delta: -1, label: 'Rock Tomb lowers Speed: -1 Speed CS' }])],
  ['Scary Face', reviewedSingleTargetStageScript('Scary Face', [{ key: 'spd', delta: -2, label: 'Scary Face lowers Speed: -2 Speed CS' }])],
  ['Shadow Ball', reviewedSingleTargetStageScript('Shadow Ball', [{ key: 'sdef', delta: -1, label: 'Shadow Ball lowers Special Defense on 17+: -1 Special Defense CS', threshold: '17+' }])],
  ['Shadow Bone', reviewedSingleTargetStageScript('Shadow Bone', [{ key: 'def', delta: -1, label: 'Shadow Bone lowers Defense on 17+: -1 Defense CS', threshold: '17+' }])],
  ['Spirit Break', reviewedSingleTargetStageScript('Spirit Break', [{ key: 'satk', delta: -1, label: 'Spirit Break lowers Special Attack: -1 Special Attack CS' }])],
  ['Tickle', reviewedSingleTargetStageScript('Tickle', [
    { key: 'atk', delta: -1, label: 'Tickle lowers Attack: -1 Attack CS' },
    { key: 'def', delta: -1, label: 'Tickle lowers Defense: -1 Defense CS' },
  ])],
])

const REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Absorb', reviewedAbsorbScript()],
  ['Acupressure', reviewedAcupressureScript()],
  ['Fake Out', reviewedSingleTargetConditionScript('Fake Out', [{ condition: 'Flinch', label: 'Fake Out flinches on hit' }], 1, {
    automationNotes: ['Fake Out’s Priority/Flinch clause is only legal upon joining an encounter; automation applies Flinch on hit assuming that requirement is met.'],
  })],
  ['Fury Cutter', reviewedMoveScriptFromCanonical('Fury Cutter', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: ['Fury Cutter’s consecutive same-target Damage Base scaling is not inferred; update the move DB manually before use if the chain has advanced.'],
  })],
  ['Helping Hand', reviewedSingleTargetConditionScript('Helping Hand', [{ condition: HELPING_HAND_CONDITION, label: 'Helping Hand bonus' }], 1, {
    requiresAccuracy: false,
    automationNotes: ['Helping Hand creates a removable marker; remove it after the target consumes the +2 Accuracy/+10 Damage bonus or the round ends.'],
  })],
  ['Double Kick', reviewedDoubleStrikeScript('Double Kick')],
  ['Fury Attack', reviewedFiveStrikeScript('Fury Attack')],
  ['Fury Swipes', reviewedFiveStrikeScript('Fury Swipes')],
  ['Knock Off', reviewedMoveScriptFromCanonical('Knock Off', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: [
      'On hit, choose one of the target’s Held Items or Accessory Slot Items; the chosen item is knocked to the ground.',
      'Equipment slots and ground item placement are not tracked by this transaction, so update the sheet/map item manually after damage resolves.',
    ],
  })],
  ['Pin Missile', reviewedFiveStrikeScript('Pin Missile')],
  ['Power Trip', reviewedPowerTripScript()],
  ['Sand Tomb', reviewedSingleTargetConditionScript('Sand Tomb', [
    { condition: 'Slowed', label: 'Vortex slows target' },
    { condition: 'Trapped', label: 'Vortex traps target' },
  ], 1, {
    automationNotes: ['Vortex tick damage and the end-of-turn dispel checks (20, 14, 8, 2, then wears off) are tracked by note, not automatic turn processing.'],
  })],
  ['Supersonic', reviewedSingleTargetConditionScript('Supersonic', [
    { condition: 'Confused', label: 'Confused on hit' },
    { condition: SUPERSONIC_ACCURACY_PENALTY_CONDITION, label: 'Supersonic miss accuracy penalty', applyWhen: 'miss' },
  ])],
  ['Tackle', reviewedMoveScriptFromCanonical('Tackle', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: ['Tackle pushes the target 2 meters after damage; move the target token manually after the automated hit resolves.'],
  })],
  ['Torment', reviewedSingleTargetConditionScript('Torment', [{ condition: 'Suppressed', label: 'Suppressed' }])],
  ['U-Turn', reviewedMoveScriptFromCanonical('U-Turn', 1, {
    targetMode: 'one-target',
    targetCount: 1,
    automationNotes: [
      'On hit, the user is recalled immediately after damage and may send out a new Pokémon; perform the token recall/send-out after the automated damage resolves.',
      'U-Turn explicitly allows a Trapped user to be recalled.',
    ],
  })],
])

const REVIEWED_SELF_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Hone Claws', reviewedSelfStageScript('Hone Claws', [
    { key: 'acc', delta: 1, label: 'Hone Claws raises Accuracy: +1 Accuracy CS' },
    { key: 'atk', delta: 1, label: 'Hone Claws raises Attack: +1 Attack CS' },
  ])],
  ['Reflect', reviewedReflectScript()],
  ['Swords Dance', reviewedSelfStageScript('Swords Dance', [{ key: 'atk', delta: 2, label: 'Swords Dance raises Attack: +2 Attack CS' }])],
  ['Synthesis', reviewedSynthesisScript()],
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
  || REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS.has(script.moveName)
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
      || REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS.has(script.moveName)
    )
    && script.targetMode === 'one-target'
    && script.targetCount === 1
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
      && script.targetCount === 1,
  )
}

export const isSeamlessSelfMoveScript = (
  script: MoveAutomationScript | null | undefined,
): boolean => Boolean(
  script
    && script.kind === 'explicit'
    && REVIEWED_SELF_SCRIPTS.has(script.moveName)
    && script.targetMode === 'self'
    && script.targetCount === 1
    && !script.requiresAccuracy,
)

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
  ...REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS,
  ...REVIEWED_SELF_SCRIPTS,
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
