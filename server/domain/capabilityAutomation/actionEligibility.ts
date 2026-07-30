import type { CapabilityActionEconomy } from '#shared/capabilityAutomation/manifest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'

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

export type CapabilityStandardActionRestrictionCode =
  | 'intangible-standard-action-blocked'
  | 'shadow-meld-standard-action-blocked'
  | 'shrunken-standard-action-blocked'
  | 'illusion-standard-action-reserved'

export interface CapabilityStandardActionRestriction {
  readonly code: CapabilityStandardActionRestrictionCode
  readonly message: string
}

/**
 * Resolve source-effective modes that prohibit or continuously consume the
 * actor's Standard Action. Callers still own ordinary action-resource spends;
 * this is the cross-surface authoritative rule gate for non-Move actions.
 */
export const capabilityStandardActionRestriction = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly now: number
  /** Shrinkable expressly permits its own restore-size Standard Action. */
  readonly allowShrunkenRestore?: boolean
}): CapabilityStandardActionRestriction | null => {
  const effectiveInstanceIds = new Set(resolveEffectiveCapabilities({
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  }).instances.filter(instance => instance.effective).map(instance => instance.instanceId))
  const modes = (input.map.encounterState?.capabilityRuntime?.modes ?? []).filter(mode => (
    mode.actorPlacementId === input.placement.id
    && effectiveInstanceIds.has(mode.capabilityInstanceId)
    && (mode.expiresAt === null || mode.expiresAt > input.now)
  ))
  if (modes.some(mode => mode.mode === 'intangible')) {
    return {
      code: 'intangible-standard-action-blocked',
      message: 'Intangible creatures cannot perform Standard Actions.',
    }
  }
  if (modes.some(mode => mode.mode === 'shadow-melded')) {
    return {
      code: 'shadow-meld-standard-action-blocked',
      message: 'Shadow Meld prevents the actor from performing Standard Actions.',
    }
  }
  if (!input.allowShrunkenRestore && modes.some(mode => mode.mode === 'shrunken')) {
    return {
      code: 'shrunken-standard-action-blocked',
      message: 'A Shrunken creature cannot perform Standard Actions except to return to normal size.',
    }
  }
  if (modes.some(mode => mode.mode === 'illusion'
    && /(?:^|;)motion:major$/.test(mode.configurationId ?? ''))) {
    return {
      code: 'illusion-standard-action-reserved',
      message: 'Maintaining this major Illusion continuously consumes the actor’s Standard Action.',
    }
  }
  return null
}
