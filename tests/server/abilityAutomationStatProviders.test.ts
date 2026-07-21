import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import { resolveAuthoritativeAbilityStatProviders } from '../../server/domain/abilityAutomation/statProviders'
import { resolveAbilityStatProviders } from '#shared/abilityAutomation/statProviders'
import {
  AbilityPassiveProviderValidationError,
  aggregateAbilityPassiveProviders,
} from '#shared/abilityAutomation/passiveProviders'

const provider = (input: {
  readonly id: string
  readonly domain: 'stat' | 'evasion' | 'movement'
  readonly attribute: string
  readonly operation: 'add' | 'multiply' | 'set' | 'minimum' | 'maximum' | 'grant' | 'deny'
  readonly value: number | string | boolean | readonly string[]
  readonly group: string
  readonly policy?: 'stack' | 'highest' | 'lowest' | 'priority' | 'union' | 'exclusive'
  readonly priority?: number
  readonly scope?: string
}) => ({
  schemaVersion: 1,
  providerId: input.id,
  abilityInstanceId: 'base:actor:0',
  canonicalId: 'Speed Boost',
  sourcePlacementId: 'actor',
  scopeKey: input.scope ?? 'placement:actor',
  domain: input.domain,
  attribute: input.attribute,
  operation: input.operation,
  value: input.value,
  priority: input.priority ?? 0,
  stackingGroup: input.group,
  stackingPolicy: input.policy ?? (input.operation === 'grant' || input.operation === 'deny' ? 'union' : 'stack'),
  reasonCode: `ability.${input.id}`,
})
const providers = () => [
  provider({ id: 'attack-plus-five', domain: 'stat', attribute: 'stat.attack', operation: 'add', value: 5, group: 'stat.base' }),
  provider({ id: 'attack-stage-plus-two', domain: 'stat', attribute: 'stat.combat-stage.attack', operation: 'add', value: 2, group: 'stat.combat-stage' }),
  provider({ id: 'accuracy-stage-floor', domain: 'stat', attribute: 'stat.combat-stage.accuracy', operation: 'minimum', value: 0, group: 'stat.combat-stage' }),
  provider({ id: 'initiative-plus-five', domain: 'stat', attribute: 'stat.initiative', operation: 'add', value: 5, group: 'stat.derived' }),
  provider({ id: 'special-evasion-plus-two', domain: 'evasion', attribute: 'evasion.special', operation: 'add', value: 2, group: 'evasion.value' }),
  provider({ id: 'overland-plus-two', domain: 'movement', attribute: 'movement.overland', operation: 'add', value: 2, group: 'movement.speed' }),
  provider({ id: 'phasing-grant', domain: 'movement', attribute: 'movement.phasing', operation: 'grant', value: 'phasing', group: 'movement.capability' }),
]
const fact = {
  placementId: 'actor',
  baseStats: {
    attack: 20, 'special-attack': 18, defense: 25, 'special-defense': 20, speed: 15, hp: 50,
  },
  combatStages: {
    attack: 0, 'special-attack': 0, defense: 0, 'special-defense': 0, speed: -3, accuracy: -2,
  },
  evasionBonuses: { physical: 0, special: 0, speed: 1 },
  initiativeOffset: 0,
  movementSpeeds: { overland: 6, swim: 3, sky: 0, levitate: 0, burrow: 0, teleport: 2 },
  movementTraits: [],
} as const
const context = (): AuthoritativeAbilityContext => ({
  queries: {
    placements: { get: (id: string) => id === 'actor' ? { id } : null },
    tokens: {
      get: (id: string) => id === 'actor' ? {
        id,
        atk: 20, satk: 18, def: 25, sdef: 20, spd: 15,
        maxHp: 50, currentHp: 40, temporaryHp: 0, injuries: 0,
        combatStages: { atk: 0, satk: 0, def: 0, sdef: 0, spd: -3, acc: -2 },
        evasion: { physical: 0, special: 0, speed: 1 },
        movementCapabilities: { overland: 6, swim: 3, teleporter: 2 },
        movementTraits: { phasing: false },
      } : null,
    },
    effectiveAbilities: {
      activeForPlacement: (id: string) => id === 'actor'
        ? [{ instanceId: 'base:actor:0', canonicalId: 'Speed Boost', effective: true }]
        : [],
    },
  },
} as unknown as AuthoritativeAbilityContext)

describe('ability stat, Combat Stage, evasion, initiative, and movement providers', () => {
  it('resolves raw stats before capped Combat Stages and derived totals', () => {
    const result = resolveAbilityStatProviders({
      groups: aggregateAbilityPassiveProviders(providers()),
      fact,
    })
    expect(result.baseStats.attack).toBe(25)
    expect(result.combatStages).toMatchObject({ attack: 2, speed: -3, accuracy: 0 })
    expect(result.effectiveStats).toMatchObject({
      attack: 35,
      speed: 10,
      hp: 50,
    })
  })

  it('derives capped evasion and initiative from provider-adjusted staged stats', () => {
    const result = resolveAbilityStatProviders({
      groups: aggregateAbilityPassiveProviders(providers()), fact,
    })
    expect(result.evasion).toEqual({
      physical: 5,
      special: 6,
      speed: 3,
    })
    expect(result.initiative).toBe(15)
  })

  it('applies movement providers before Speed CS and preserves teleport semantics', () => {
    const result = resolveAbilityStatProviders({
      groups: aggregateAbilityPassiveProviders(providers()), fact,
    })
    expect(result.movementSpeeds).toEqual({
      overland: 7,
      swim: 2,
      sky: 0,
      levitate: 0,
      burrow: 0,
      teleport: 2,
    })
    expect(result.movementTraits).toEqual(['phasing'])
  })

  it('honors deterministic highest stacking and ignores other placement scopes', () => {
    const groups = aggregateAbilityPassiveProviders([
      provider({
        id: 'speed-low', domain: 'stat', attribute: 'stat.speed', operation: 'add', value: 2,
        group: 'stat.base', policy: 'highest',
      }),
      provider({
        id: 'speed-high', domain: 'stat', attribute: 'stat.speed', operation: 'add', value: 4,
        group: 'stat.base', policy: 'highest',
      }),
      provider({
        id: 'other-speed', domain: 'stat', attribute: 'stat.speed', operation: 'add', value: 99,
        group: 'stat.base', scope: 'placement:other',
      }),
    ])
    const result = resolveAbilityStatProviders({ groups, fact })
    expect(result.baseStats.speed).toBe(19)
    expect(result.trace.flatMap(entry => entry.providerIds)).toContain('speed-high')
    expect(result.trace.flatMap(entry => entry.providerIds)).not.toContain('speed-low')
    expect(result.trace.flatMap(entry => entry.providerIds)).not.toContain('other-speed')
  })

  it('fails closed on unsupported domain attributes and malformed values', () => {
    expect(() => aggregateAbilityPassiveProviders([
      { ...providers()[0], attribute: 'stat.unknown' },
    ])).toThrowError(AbilityPassiveProviderValidationError)
    expect(() => resolveAbilityStatProviders({
      groups: aggregateAbilityPassiveProviders(providers()),
      fact: { ...fact, combatStages: { ...fact.combatStages, attack: Number.NaN } },
    })).toThrowError(/invalid authoritative values/)
  })

  it('rebuilds every base from the authoritative token and active source instances', () => {
    const result = resolveAuthoritativeAbilityStatProviders({
      context: context(), placementId: 'actor', providers: providers(),
    })
    expect(result).toMatchObject({
      baseStats: { attack: 25 },
      combatStages: { attack: 2, accuracy: 0 },
      effectiveStats: { attack: 35, speed: 10 },
      initiative: 15,
      movementSpeeds: { overland: 7, teleport: 2 },
    })
    const inactive = context()
    ;(inactive.queries.effectiveAbilities as unknown as { activeForPlacement: () => unknown[] }).activeForPlacement = () => []
    expect(() => resolveAuthoritativeAbilityStatProviders({
      context: inactive, placementId: 'actor', providers: providers(),
    })).toThrowError(/not backed by an active effective ability/)
  })
})
