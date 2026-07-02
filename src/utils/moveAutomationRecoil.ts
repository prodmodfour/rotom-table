import { sheetHasCanonicalAbility, type SheetAbilityNameSource } from '~/utils/sheetAbilities'

const ROCK_HEAD_ABILITY_NAME = 'Rock Head'
const MAGIC_GUARD_ABILITY_NAME = 'Magic Guard'

const RECOIL_IMMUNITY_ABILITIES = [ROCK_HEAD_ABILITY_NAME, MAGIC_GUARD_ABILITY_NAME] as const

export const moveAutomationRecoilImmunitySource = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): string | null => RECOIL_IMMUNITY_ABILITIES.find((abilityName) => sheetHasCanonicalAbility(abilities, abilityName)) ?? null
