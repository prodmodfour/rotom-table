import { findMove } from '~~/data/ptuReference'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import {
  defineExplicitMoveScript,
  reviewedMoveScriptFromCanonical,
} from '~/utils/move-automation/scriptFactories'
import type { MoveAutomationScript } from '~/types/moveAutomation'

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

export const REVIEWED_DIRECT_HP_LOSS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Dragon Rage', reviewedDragonRageScript()],
  ['Psywave', reviewedPsywaveScript()],
])
