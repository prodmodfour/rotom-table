import { reviewedSingleTargetStatusScript } from '~/utils/move-automation/scriptFactories'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export const REVIEWED_SINGLE_TARGET_STATUS_SCRIPT_NAMES = [
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

export const REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  REVIEWED_SINGLE_TARGET_STATUS_SCRIPT_NAMES.map((name) => [name, reviewedSingleTargetStatusScript(name)]),
)
