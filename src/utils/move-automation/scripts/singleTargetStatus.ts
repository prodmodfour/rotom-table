import {
  reviewedSingleTargetConditionScript,
  reviewedSingleTargetStatusScript,
} from '~/utils/move-automation/scriptFactories'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export const REVIEWED_SINGLE_TARGET_STATUS_SCRIPT_NAMES = [
  'Confuse Ray',
  'Glare',
  'Grass Whistle',
  'Hypnosis',
  'Lovely Kiss',
  'Poison Powder',
  'Sleep Powder',
  'Spore',
  'Stun Spore',
  'Will-O-Wisp',
]

const reviewedSingleTargetStatusFamilyScript = (name: string): MoveAutomationScript => {
  if (name === 'Spore') {
    return reviewedSingleTargetConditionScript('Spore', [{ condition: 'Sleep', label: 'Sleep' }], 1, {
      damageBase: null,
      requiresAccuracy: true,
    })
  }
  return reviewedSingleTargetStatusScript(name)
}

export const REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  REVIEWED_SINGLE_TARGET_STATUS_SCRIPT_NAMES.map((name) => [name, reviewedSingleTargetStatusFamilyScript(name)]),
)
