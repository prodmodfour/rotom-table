import { getPassiveMoveImmunitySource } from '~/utils/sheetPassiveAbilityEffects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const moveAutomationMoveImmunitySource = (
  script: MoveAutomationScript,
  target: SpawnedPokemon,
): string | null => getPassiveMoveImmunitySource(target.abilityNames, target.defenderCapabilities, script.keywords)
