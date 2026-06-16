import { findMove } from '~~/data/ptuReference'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import {
  defineExplicitMoveScript,
  reviewedAreaConditionScript,
  reviewedAreaConfirmationScript,
  reviewedPassAttackScript,
  reviewedPassConditionScript,
  reviewedTargetStageAreaScript,
  reviewedTargetStagesAreaScript,
} from '~/utils/move-automation/scriptFactories'
import {
  ELECTRIC_RESISTANT_COAT_CONDITION,
  SWEET_SCENT_EVASION_PENALTY_CONDITION,
} from '~/utils/moveAutomationSpecialConditions'
import type { MoveAutomationScript } from '~/types/moveAutomation'

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

export const REVIEWED_TARGET_STAGE_AREA_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
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

export const REVIEWED_AREA_CONFIRMATION_SCRIPT_NAMES = [
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

export const REVIEWED_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  REVIEWED_AREA_CONFIRMATION_SCRIPT_NAMES.map((name) => [name, reviewedAreaConfirmationScript(name)]),
)

export const REVIEWED_AREA_CONDITION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Poison Gas', reviewedAreaConditionScript('Poison Gas', [{ condition: 'Poisoned', label: 'Poisoned' }])],
  ['Rock Slide', reviewedAreaConditionScript('Rock Slide', [{ condition: 'Flinch', label: 'Flinch on 17+', threshold: '17+' }])],
  ['Sludge Wave', reviewedAreaConditionScript('Sludge Wave', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Sweet Scent', reviewedAreaConditionScript('Sweet Scent', [{ condition: SWEET_SCENT_EVASION_PENALTY_CONDITION, label: 'Sweet Scent Evasion Penalty' }])],
  ['Teeter Dance', reviewedAreaConditionScript('Teeter Dance', [{ condition: 'Confused', label: 'Confused' }])],
])

export const REVIEWED_SMOG_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Smog', reviewedSmogScript()],
])

export const REVIEWED_AREA_COAT_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Mud Sport', reviewedMudSportScript()],
])

export const REVIEWED_ALLY_AREA_STAGE_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Howl', reviewedHowlScript()],
])

export const REVIEWED_PASS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Aqua Tail', reviewedPassAttackScript('Aqua Tail')],
  ['Cross Poison', reviewedPassConditionScript('Cross Poison', [{ condition: 'Poisoned', label: 'Poisoned on 19+', threshold: '19+' }])],
  ['Esper Wing', reviewedPassAttackScript('Esper Wing')],
  ['Leaf Blade', reviewedPassAttackScript('Leaf Blade')],
  ['Night Slash', reviewedPassAttackScript('Night Slash')],
  ['Scratch', reviewedPassAttackScript('Scratch')],
  ['Shadow Claw', reviewedPassAttackScript('Shadow Claw')],
  ['Slash', reviewedPassAttackScript('Slash')],
])
