import { getPassiveMoveImmunitySource } from '~/utils/sheetPassiveAbilityEffects'
import {
  moveAutomationPassiveImmunityKeywordsForTarget,
  moveAutomationPowderImmunitySource,
} from '~/utils/moveAutomationKeywordImmunity'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const moveAutomationMoveImmunitySource = (
  script: Pick<MoveAutomationScript, 'keywords' | 'range'>,
  target: SpawnedPokemon,
): string | null => (
  (script.keywords.some(keyword => keyword.trim().toLowerCase() === 'execute')
    || /(?:^|[,;]\s*)execute(?:\s*[,;]|$)/i.test(script.range))
  && target.abilityNames?.some(ability => ability.trim() === 'Sturdy')
    ? 'Sturdy'
    : null
) ?? moveAutomationPowderImmunitySource(script, target)
  ?? getPassiveMoveImmunitySource(
    target.abilityNames,
    target.defenderCapabilities,
    moveAutomationPassiveImmunityKeywordsForTarget(script.keywords, target),
  )
