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

const reviewedSingleTargetAttackScript = (moveName: string, version = 1): MoveAutomationScript => {
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
  })
}

const reviewedTargetStageAreaScript = (
  moveName: string,
  key: 'atk' | 'def',
  label: string,
  version = 1,
): MoveAutomationScript => {
  const move = findMove(moveName)
  if (!move) throw new Error(`Missing canonical PTU move data for ${moveName}`)
  const manualScript = createManualMoveAutomationScript(move)
  return defineExplicitMoveScript({
    moveName: manualScript.moveName,
    version,
    targetMode: 'multi-target',
    targetCount: null,
    damaging: false,
    requiresAccuracy: manualScript.ac != null,
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
    conditionSuggestions: [],
    stageSuggestions: [{
      recipient: 'target',
      key,
      delta: -1,
      label,
    }],
    hpSuggestions: [],
    fieldSuggestions: [],
    hazardSuggestions: [],
    automationNotes: [
      'Use the area-template buttons to choose affected legal targets, or select targets manually.',
      'Friendly keyword: allies are not hit; team allegiance is not tracked, so choose legal foes only.',
    ],
  })
}

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
  ['Growl', reviewedTargetStageAreaScript('Growl', 'atk', 'Growl lowers Attack: -1 Attack CS')],
  ['Leer', reviewedTargetStageAreaScript('Leer', 'def', 'Leer lowers Defense: -1 Defense CS')],
])

const REVIEWED_SMOG_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Smog', reviewedSmogScript()],
])

const REVIEWED_DIRECT_HP_LOSS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Psywave', reviewedPsywaveScript()],
])

const SEAMLESS_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ...REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
  ...REVIEWED_SMOG_SCRIPTS,
])

const SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPT_NAMES = [
  ...STRUGGLE_ATTACK_MOVE_NAMES,
  'Ember',
  'Fire Punch',
  'Flamethrower',
  'Ice Beam',
  'Lick',
  'Poison Sting',
  'Scald',
  'Thunder Shock',
  'Thunderbolt',
]

const STRUGGLE_ATTACK_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  STRUGGLE_ATTACK_MOVE_NAMES.map((name) => [name, reviewedSingleTargetAttackScript(name)]),
)

export const SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPT_NAMES.map((name) => [name, reviewedSingleTargetAttackScript(name)]),
)

export const isSeamlessSingleTargetAttackScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
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
      && (
        SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
        || (REVIEWED_DIRECT_HP_LOSS_SCRIPTS.has(script.moveName) && Boolean(script.directHpLoss))
      )
      && script.targetMode === 'one-target'
      && script.targetCount === 1
      && script.requiresAccuracy
      && script.damaging,
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
