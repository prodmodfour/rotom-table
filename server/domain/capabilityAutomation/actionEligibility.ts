import type { CapabilityActionEconomy } from '#shared/capabilityAutomation/manifest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const normalizedConditions = (sheet: CharacterSheet | TrainerSheet): readonly string[] => (
  'species' in sheet ? sheet.combat?.conditions ?? [] : sheet.conditions ?? []
).map(condition => condition.trim().toLocaleLowerCase('en-US'))

/** PTU Fainted authority, derived from both HP and the retained condition. */
export const capabilityActorIsFainted = (sheet: CharacterSheet | TrainerSheet): boolean => {
  const currentHp = 'species' in sheet ? sheet.combat?.currentHp : sheet.currentHp
  return (typeof currentHp === 'number' && currentHp <= 0)
    || normalizedConditions(sheet).includes('fainted')
}

/**
 * Economy-free lifecycle/cleanup commands are not actions by the actor. Every
 * actual action is unavailable while the acting participant is Fainted.
 */
export const capabilityActorCanTakeAction = (
  sheet: CharacterSheet | TrainerSheet,
  economy: CapabilityActionEconomy,
): boolean => economy === 'none' || !capabilityActorIsFainted(sheet)
