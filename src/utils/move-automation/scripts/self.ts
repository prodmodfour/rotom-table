import {
  reviewedMoveScriptFromCanonical,
  reviewedSelfStageScript,
} from '~/utils/move-automation/scriptFactories'
import { REFLECT_BLESSING_CONDITION } from '~/utils/moveAutomationSpecialConditions'
import type { MoveAutomationScript } from '~/types/moveAutomation'

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
    'The selected native v2 runtime stores Reflect as a side-owned two-charge Blessing in authoritative encounter state.',
  ],
})

export const REVIEWED_SELF_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ['Hone Claws', reviewedSelfStageScript('Hone Claws', [
    { key: 'acc', delta: 1, label: 'Hone Claws raises Accuracy: +1 Accuracy CS' },
    { key: 'atk', delta: 1, label: 'Hone Claws raises Attack: +1 Attack CS' },
  ])],
  ['Reflect', reviewedReflectScript()],
  ['Swords Dance', reviewedSelfStageScript('Swords Dance', [{ key: 'atk', delta: 2, label: 'Swords Dance raises Attack: +2 Attack CS' }])],
  ['Synthesis', reviewedSynthesisScript()],
])
