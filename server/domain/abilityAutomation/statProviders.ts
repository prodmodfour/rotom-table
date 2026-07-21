import {
  resolveAbilityStatProviders,
  type AbilityStatProviderResolution,
} from '#shared/abilityAutomation/statProviders'
import type { AuthoritativeAbilityContext } from './context'
import { aggregateAuthoritativeAbilityPassiveProviders } from './passiveProviders'

export class AuthoritativeAbilityStatProviderError extends Error {
  constructor(readonly code: 'placement-missing' | 'token-missing', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityStatProviderError'
  }
}
const fail = (code: AuthoritativeAbilityStatProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityStatProviderError(code, detail)
}
const finiteSpeed = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

/** Build all stat/evasion/initiative/movement bases from one authoritative token snapshot. */
export const resolveAuthoritativeAbilityStatProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly placementId: string
  readonly providers: unknown
}): AbilityStatProviderResolution => {
  if (!input.context.queries.placements.get(input.placementId)) {
    fail('placement-missing', `Stat provider placement ${input.placementId} is missing.`)
  }
  const token = input.context.queries.tokens.get(input.placementId)
    ?? fail('token-missing', `Stat provider token ${input.placementId} is missing.`)
  const groups = aggregateAuthoritativeAbilityPassiveProviders(input.context, input.providers)
  const stages = token.combatStages ?? { atk: 0, satk: 0, def: 0, sdef: 0, spd: 0, acc: 0 }
  const speeds = token.movementCapabilities ?? {}
  return resolveAbilityStatProviders({
    groups,
    fact: {
      placementId: input.placementId,
      baseStats: {
        attack: token.atk,
        'special-attack': token.satk,
        defense: token.def,
        'special-defense': token.sdef,
        speed: token.spd ?? 0,
        hp: token.maxHp,
      },
      combatStages: {
        attack: stages.atk,
        'special-attack': stages.satk,
        defense: stages.def,
        'special-defense': stages.sdef,
        speed: stages.spd,
        accuracy: stages.acc,
      },
      evasionBonuses: {
        physical: token.evasion?.physical ?? 0,
        special: token.evasion?.special ?? 0,
        speed: token.evasion?.speed ?? 0,
      },
      initiativeOffset: 0,
      movementSpeeds: {
        overland: finiteSpeed(speeds.overland),
        swim: finiteSpeed(speeds.swim),
        sky: finiteSpeed(speeds.sky),
        levitate: finiteSpeed(speeds.levitate),
        burrow: finiteSpeed(speeds.burrow),
        teleport: finiteSpeed(speeds.teleporter),
      },
      movementTraits: token.movementTraits?.phasing ? ['phasing'] : [],
    },
  })
}
