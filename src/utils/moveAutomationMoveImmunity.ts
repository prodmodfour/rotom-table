import { getPassiveMoveImmunitySource } from '~/utils/sheetPassiveAbilityEffects'
import {
  moveAutomationPassiveImmunityKeywordsForTarget,
  moveAutomationPowderImmunitySource,
} from '~/utils/moveAutomationKeywordImmunity'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const moveAutomationMoveImmunitySource = (
  script: Pick<MoveAutomationScript, 'keywords'>,
  target: SpawnedPokemon,
): string | null => moveAutomationPowderImmunitySource(script, target)
  ?? getPassiveMoveImmunitySource(
    target.abilityNames,
    target.defenderCapabilities,
    moveAutomationPassiveImmunityKeywordsForTarget(script.keywords, target),
  )
