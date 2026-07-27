import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { moveItemEffectBindingId } from '#shared/moveAutomation/itemEffects'
import {
  parseMoveEffectOperation,
  type MoveDamageEffectOperation,
} from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { placementToSpawned } from '~/utils/placement'
import { pokemonInitiativeOrderEntry } from '~/utils/initiativeOrderEntries'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { authoritativeEquippedItemReferences } from '~~/server/domain/moveAutomation/itemResources'
import { resolveMoveCriticalHit } from '~~/server/domain/moveAutomation/criticalHits'
import { resolveMoveDamageType } from '~~/server/domain/moveAutomation/damageTypes'
import { resolveAuthoritativeMoveUserAccuracy } from '~~/server/domain/moveAutomation/accuracy'
import { applyEncounterNumericModifiers } from '~~/server/domain/moveAutomation/encounterNumericModifiers'
import {
  aa085to100AccuracyModifiers,
  aa085to100DamageBaseBonus,
  aa085to100MoveDamageModifiers,
  AA085_RADIANT_BEAM_TARGET_BRANCH_ID,
} from '~~/server/domain/abilityAutomation/mechanics/aa085to100StaticIntegration'
import {
  aa085to100InitiativeProjection,
} from '~~/server/domain/abilityAutomation/mechanics/aa085to100InitiativeIntegration'
import { recordAa085to100MovementEvidence } from '~~/server/domain/abilityAutomation/mechanics/aa085to100MovementIntegration'
import { REMAINING_ABILITY_TEST_REGISTRY } from '../fixtures/abilityAutomation/remainingRegistry'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slug(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})

const pokemon = (input: {
  readonly slug: string
  readonly species?: string
  readonly abilities?: readonly string[]
  readonly move?: string
  readonly conditions?: readonly string[]
  readonly currentHp?: number
  readonly heldItem?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species ?? 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: [{ name: input.move ?? 'Tackle' }],
  items: input.heldItem ? { held: input.heldItem } : {},
  stats: {
    hp: { added: 30 }, atk: { added: 20 }, def: { added: 20 },
    satk: { added: 20 }, sdef: { added: 20 }, spd: { added: 20 },
  },
  capabilities: { overland: 5, sky: 0, swim: 2, levitate: 0, burrow: 0 },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 100,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})

const formEffect = (input: {
  readonly id: string
  readonly tag: string
  readonly formId: string
}): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'form', action: 'replace', value: input.formId,
    referencePlacementId: null,
  }),
  id: input.id,
  affected: { placementIds: ['actor'], sideIds: [], cells: [] },
  tags: ['ability', input.tag],
})

const fixture = (input: {
  readonly actor?: CharacterSheet
  readonly target?: CharacterSheet
  readonly effects?: readonly EncounterEffect[]
  readonly temporaryHp?: number
  readonly voxels?: TabletopMap['voxels']
}) => {
  const actor = input.actor ?? pokemon({ slug: 'actor' })
  const target = input.target ?? pokemon({ slug: 'target' })
  const encounter = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `static-${slug(actor.slug)}`,
    name: 'Remaining static conformance',
    revision: 4,
    dimensions: { x: 20, y: 12, z: 20 },
    groundLevelY: 0,
    voxels: input.voxels ?? [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      {
        id: 'actor', sheetKind: 'pokemon', sheetSlug: actor.slug,
        sideId: 'heroes', position: { x: 6, y: 0, z: 6 },
      },
      {
        id: 'target', sheetKind: 'pokemon', sheetSlug: target.slug,
        sideId: 'foes', position: { x: 12, y: 0, z: 6 },
      },
    ],
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 1 },
    ...(input.temporaryHp ? {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 1 },
        byPlacementId: { actor: input.temporaryHp },
      },
    } : {}),
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: 'scene:remaining-static',
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
    },
  }
  const pokemonSheets = new Map([[actor.slug, actor], [target.slug, target]])
  return { map, actor, target, pokemonSheets, trainerSheets: new Map() }
}

const context = (state: ReturnType<typeof fixture>, moveName = state.actor.movelist![0]!.name) => (
  buildAuthoritativeMoveRulesContext({
    map: state.map,
    pokemonSheets: state.pokemonSheets,
    trainerSheets: state.trainerSheets,
    abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    candidatePlacementIds: ['target'],
    selectedPlacementIds: ['target'],
    random: () => 0.5,
    time: 1,
    resolutionId: `resolution:${slug(moveName)}`,
  })
)

const statTotal = (sheet: CharacterSheet, key: string): number => (
  resolveStats(sheet).find(stat => stat.key === key)?.total ?? 0
)

const projectedActor = (state: ReturnType<typeof fixture>) => context(state).actor.token

const projectedDelta = (
  current: number,
  sourceSpecies: string,
  targetSpecies: string,
  key: string,
): number => {
  const source = pokemon({ slug: 'source', species: sourceSpecies })
  const target = pokemon({ slug: 'target-form', species: targetSpecies })
  return current + statTotal(target, key) - statTotal(source, key)
}

describe('AA-085 through AA-100 static conformance', () => {
  it('loads every remaining reviewed runtime through the isolated conformance registry', () => {
    expect(REMAINING_ABILITY_TEST_REGISTRY.resolve('Psychic Surge')).toMatchObject({
      canonicalId: 'Psychic Surge', kind: 'abilityspec-v1', version: 1,
    })
    expect(REMAINING_ABILITY_TEST_REGISTRY.resolve('Zen Snowed')).toMatchObject({
      canonicalId: 'Zen Snowed', kind: 'abilityspec-v1', version: 1,
    })
  })

  it('composes Razor Edge, Super Luck, and the exact owner-bound Vicious critical provider', () => {
    const vicious = (sourcePlacementId: string): EncounterEffect => parseEncounterEffect({
      id: `effect.vicious.${sourcePlacementId}`,
      kind: 'capability',
      source: {
        operationId: `ability.vicious.${sourcePlacementId}`,
        moveId: 'hone-claws',
        placementId: sourcePlacementId,
      },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 1,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa097-vicious-critical'],
      payload: { capabilityId: 'aa097.vicious.critical-range-plus-two', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['aa097-vicious-critical'] },
      transferPolicy: 'expire',
      suppression: { sources: [] },
    })
    const operation = parseMoveEffectOperation({
      id: 'poison-tail.damage',
      kind: 'damage',
      source: { kind: 'move', id: 'move.poison-tail' },
      recipients: { kind: 'selected-targets' },
      phase: 'damage',
      reasonCode: 'poison-tail.damage',
      payload: {
        damageBase: 6,
        damageClass: 'physical',
        moveType: 'poison',
        accuracyRollId: null,
        criticalRollId: null,
      },
    })
    if (operation.kind !== 'damage') throw new Error('Expected damage operation.')
    const state = fixture({
      actor: pokemon({
        slug: 'critical-owner', move: 'Poison Tail', abilities: ['Razor Edge', 'Super Luck'],
      }),
      effects: [vicious('actor')],
    })
    const resolvedContext = context(state, 'Poison Tail')
    expect(resolveMoveCriticalHit({
      context: resolvedContext,
      operation,
      script: resolvedContext.queries.rules.reviewedScriptFor('Poison Tail')!,
      recipientId: 'target',
      naturalRoll: 11,
    })).toMatchObject({
      trigger: { kind: 'range', minimum: 11 },
      candidate: true,
      critical: true,
    })

    const wrongOwner = fixture({
      actor: pokemon({
        slug: 'critical-owner-mismatch', move: 'Poison Tail', abilities: ['Razor Edge', 'Super Luck'],
      }),
      effects: [vicious('target')],
    })
    const wrongOwnerContext = context(wrongOwner, 'Poison Tail')
    expect(resolveMoveCriticalHit({
      context: wrongOwnerContext,
      operation,
      script: wrongOwnerContext.queries.rules.reviewedScriptFor('Poison Tail')!,
      recipientId: 'target',
      naturalRoll: 12,
    }).trigger).toEqual({ kind: 'range', minimum: 13 })
  })

  it('orders RKS, Counter resistance, typed bypass, Transistor, and defensive immunities per target', () => {
    const resolve = (input: {
      readonly moveName: 'Thunder Shock' | 'Ember'
      readonly actorAbilities?: readonly string[]
      readonly targetAbilities?: readonly string[]
      readonly markerReasons?: readonly string[]
      readonly targetCurrentHp?: number
    }) => {
      const state = fixture({
        actor: pokemon({
          slug: `typed-${slug(input.moveName)}`,
          move: input.moveName,
          abilities: input.actorAbilities,
        }),
        target: pokemon({
          slug: 'typed-target',
          abilities: input.targetAbilities,
          currentHp: input.targetCurrentHp,
        }),
      })
      const resolvedContext = context(state, input.moveName)
      const operation = parseMoveEffectOperation({
        id: `typed.${slug(input.moveName)}.damage`,
        kind: 'damage',
        source: { kind: 'move', id: `move.${slug(input.moveName)}` },
        recipients: { kind: 'selected-targets' },
        phase: 'damage',
        reasonCode: `typed.${slug(input.moveName)}.damage`,
        payload: {
          damageBase: 6,
          damageClass: 'special',
          moveType: input.moveName === 'Thunder Shock' ? 'electric' : 'fire',
          accuracyRollId: null,
          criticalRollId: null,
          preTypeDamageModifiers: (input.markerReasons ?? []).map((reasonCode, index) => ({
            id: `typed.marker.${index}`,
            priority: 48,
            stackingGroup: `typed-marker:${index}`,
            reasonCode,
            value: 0,
          })),
        },
      })
      if (operation.kind !== 'damage') throw new Error('Expected damage operation.')
      return resolveMoveDamageType({
        context: resolvedContext,
        operation,
        script: { moveName: input.moveName, keywords: [] },
        recipientId: 'target',
      })
    }
    const rksMarker = 'ability.rks-system.normal-defense:target'
    const counterMarker = 'ability.wobble.resistance:target'
    const transistorMarker = 'ability.transistor.vulnerability:target'

    expect(resolve({ moveName: 'Thunder Shock', markerReasons: [rksMarker] }).finalMultiplier).toBe(0.5)
    expect(resolve({
      moveName: 'Thunder Shock', actorAbilities: ['Teravolt'], markerReasons: [rksMarker],
    }).finalMultiplier).toBe(1)
    expect(resolve({
      moveName: 'Thunder Shock', actorAbilities: ['Teravolt'], markerReasons: [counterMarker],
    }).finalMultiplier).toBe(1)
    expect(resolve({
      moveName: 'Thunder Shock', actorAbilities: ['Teravolt'],
      markerReasons: [rksMarker, transistorMarker],
    }).finalMultiplier).toBe(1.5)
    expect(resolve({
      moveName: 'Ember', actorAbilities: ['Teravolt'], markerReasons: [rksMarker],
    }).finalMultiplier).toBe(0.5)
    expect(resolve({
      moveName: 'Ember', actorAbilities: ['Turboblaze'], markerReasons: [rksMarker],
    }).finalMultiplier).toBe(1)
    expect(resolve({
      moveName: 'Thunder Shock', actorAbilities: ['Teravolt'],
      targetAbilities: ['Wonder Guard'],
    }).finalMultiplier).toBe(1)
    expect(resolve({
      moveName: 'Thunder Shock', targetAbilities: ['Wonder Guard'],
    }).finalMultiplier).toBe(0)
    expect(resolve({
      moveName: 'Thunder Shock', actorAbilities: ['Teravolt'],
      targetAbilities: ['Shadow Shield'], targetCurrentHp: 999,
    }).finalMultiplier).toBe(1)
    expect(resolve({
      moveName: 'Thunder Shock', targetAbilities: ['Shadow Shield'], targetCurrentHp: 999,
    }).finalMultiplier).toBe(0.5)
  })

  it('projects Pure Power, Quick Feet, RKS System, and Radiant Beam from effective abilities', () => {
    const ordinary = fixture({ actor: pokemon({ slug: 'ordinary', move: 'Razor Leaf' }) })
    const empowered = fixture({
      actor: pokemon({
        slug: 'empowered', move: 'Razor Leaf',
        abilities: ['Pure Power', 'Quick Feet', 'RKS System', 'Radiant Beam'],
        conditions: ['Paralysis'], heldItem: 'Fire Memory',
      }),
    })
    const base = projectedActor(ordinary)
    const result = projectedActor(empowered)
    expect(result.atk - base.atk).toBe(
      resolveStats(empowered.actor).find(stat => stat.key === 'atk')!.base,
    )
    expect(result.combatStages.spd).toBe(0)
    expect(context(empowered, 'Razor Leaf').queries.stats.combatStage('actor', {
      stage: 'spd', stageModifierPolicy: 'honor',
    })?.value).toBe(2)
    expect(result.defenderTypes).toEqual(['Fire'])
    expect(context(empowered, 'Razor Leaf').queries.rules.reviewedScriptFor('Razor Leaf')).toMatchObject({
      range: 'Cone 2',
      targetBranches: expect.arrayContaining([
        expect.objectContaining({
          id: AA085_RADIANT_BEAM_TARGET_BRANCH_ID,
          range: 'Line 4',
          targetMode: 'multi-target',
        }),
      ]),
    })
  })

  it('projects an exact Symbiosis item snapshot only while its binding remains active', () => {
    const base = capabilityEncounterEffectFixture()
    const source = fixture({
      actor: pokemon({ slug: 'actor', heldItem: 'Leftovers' }),
    })
    const actorPlacement = source.map.placements.find(placement => placement.id === 'actor')!
    const reference = authoritativeEquippedItemReferences(actorPlacement, source.actor)[0]!
    const shared = {
      ...base,
      id: 'effect.symbiosis.leftovers',
      source: { ...base.source, placementId: 'actor' },
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      duration: { kind: 'scene' as const, remaining: null },
      tags: [
        'ability', 'aa094-symbiosis-shared-item', 'aa094-symbiosis-item:leftovers',
        `aa094-symbiosis-binding:${moveItemEffectBindingId(reference)}`,
      ],
      payload: { capabilityId: 'aa094.symbiosis.shared-held-item', action: 'grant' as const },
    }
    const active = fixture({
      actor: pokemon({ slug: 'actor', heldItem: 'Leftovers' }),
      effects: [shared],
    })
    expect(context(active).queries.tokens.get('target')?.tokenItems).toContain('leftovers')

    const missingItem = fixture({ effects: [shared] })
    expect(context(missingItem).queries.tokens.get('target')?.tokenItems).not.toContain('leftovers')

    const suppressionSource = {
      ...base,
      id: 'effect.symbiosis.suppression-source',
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      payload: { capabilityId: 'test.symbiosis.suppression', action: 'grant' as const },
    }
    const suppressed = fixture({
      actor: pokemon({ slug: 'actor', heldItem: 'Leftovers' }),
      effects: [suppressionSource, {
        ...shared,
        suppression: { sources: [{
          effectId: suppressionSource.id, reasonCode: 'test-suppression',
        }] },
      }],
    })
    expect(context(suppressed).queries.tokens.get('target')?.tokenItems).not.toContain('leftovers')
  })

  it('lets White Smoke reject external Accuracy penalties while retaining self-authored penalties', () => {
    const numeric = numericEncounterEffectFixture()
    const external = {
      ...numeric,
      id: 'effect.white-smoke.external',
      source: { ...numeric.source, placementId: 'target' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      payload: { attribute: 'accuracy' as const, operation: 'add' as const, value: -4, rounding: 'none' as const },
    }
    const self = {
      ...numeric,
      id: 'effect.white-smoke.self',
      source: { ...numeric.source, placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      payload: { attribute: 'accuracy' as const, operation: 'add' as const, value: -2, rounding: 'none' as const },
    }
    const protectedState = fixture({
      actor: pokemon({ slug: 'protected', abilities: ['White Smoke'] }),
      effects: [external, self],
    })
    const plainState = fixture({
      actor: pokemon({ slug: 'plain' }), effects: [external, self],
    })
    const protectedContext = context(protectedState)
    const plainContext = context(plainState)
    expect(resolveAuthoritativeMoveUserAccuracy(protectedContext, {
      targetPlacementId: 'target',
      script: protectedContext.queries.rules.reviewedScriptFor('Tackle')!,
    }).value).toBe(-2)
    expect(resolveAuthoritativeMoveUserAccuracy(plainContext, {
      targetPlacementId: 'target',
      script: plainContext.queries.rules.reviewedScriptFor('Tackle')!,
    }).value).toBe(-6)

    const suppression = {
      ...creatureRuleOverlayEncounterEffectFixture({
        domain: 'ability', action: 'suppress', values: ['White Smoke'],
        referencePlacementId: null, suppressionScope: 'listed',
      }),
      id: 'effect.white-smoke.suppression',
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
    }
    const suppressedState = fixture({
      actor: pokemon({ slug: 'suppressed', abilities: ['White Smoke'] }),
      effects: [external, self, suppression],
    })
    const suppressedContext = context(suppressedState)
    expect(resolveAuthoritativeMoveUserAccuracy(suppressedContext, {
      targetPlacementId: 'target',
      script: suppressedContext.queries.rules.reviewedScriptFor('Tackle')!,
    }).value).toBe(-6)

    const externalEvasion = {
      ...numeric,
      id: 'effect.white-smoke.external-evasion',
      source: { ...numeric.source, placementId: 'actor' },
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      payload: { attribute: 'evasion' as const, operation: 'add' as const, value: -3, rounding: 'none' as const },
    }
    const targetState = fixture({
      target: pokemon({ slug: 'evasive', abilities: ['White Smoke'] }),
      effects: [externalEvasion],
    })
    const targetContext = context(targetState)
    const protectedTargetId = targetContext.queries.abilities.has('target', 'White Smoke')
      ? 'target' : undefined
    expect(applyEncounterNumericModifiers({
      map: targetState.map, placementId: 'target', attribute: 'evasion', baseValue: 2,
      ...(protectedTargetId ? { protectedFromExternalDecreasesPlacementId: protectedTargetId } : {}),
    }).value).toBe(2)
    expect(applyEncounterNumericModifiers({
      map: targetState.map, placementId: 'target', attribute: 'evasion', baseValue: 2,
    }).value).toBe(-1)
  })

  it('applies Simple and Contrary once to condition and environment-owned stage projections', () => {
    const simple = fixture({
      actor: pokemon({
        slug: 'simple-projections', abilities: ['Quick Feet', 'Wave Rider', 'Simple'],
        conditions: ['Paralysis'],
      }),
      voxels: [{ x: 6, y: 0, z: 6, materialId: 'water', tags: ['water'] }],
    })
    const simpleContext = context(simple)
    expect(simpleContext.actor.token.combatStages.spd).toBe(6)
    expect(simpleContext.queries.stats.combatStage('actor', {
      stage: 'spd', stageModifierPolicy: 'honor',
    })?.value).toBe(6)
    expect(aa085to100InitiativeProjection({
      map: simple.map, placement: simple.map.placements[0]!, sheet: simple.actor,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    }).speedCombatStageOffset).toBe(8)

    const contrary = fixture({
      actor: pokemon({
        slug: 'contrary-projections', abilities: ['Quick Feet', 'Wave Rider', 'Contrary'],
        conditions: ['Paralysis'],
      }),
      voxels: [{ x: 6, y: 0, z: 6, materialId: 'water', tags: ['water'] }],
    })
    const contraryContext = context(contrary)
    expect(contraryContext.actor.token.combatStages.spd).toBe(-4)
    expect(contraryContext.queries.stats.combatStage('actor', {
      stage: 'spd', stageModifierPolicy: 'honor',
    })?.value).toBe(-6)
  })

  it('consults post-Combat-Stage offensive Stats for Twisted and Weird Power damage', () => {
    const twistedSheet = pokemon({ slug: 'twisted', abilities: ['Twisted Power'] })
    twistedSheet.stats!.satk!.stage = 2
    const twistedState = fixture({ actor: twistedSheet })
    const twisted = context(twistedState)
    const operation = { id: 'tackle.damage' } as MoveDamageEffectOperation
    const physical = aa085to100MoveDamageModifiers({
      context: twisted, operation,
      script: twisted.queries.rules.reviewedScriptFor('Tackle')!,
      actor: twisted.actor.token, recipient: twisted.queries.tokens.get('target')!,
      moveType: 'normal', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    })
    expect(physical).toContainEqual(expect.objectContaining({
      reasonCode: 'ability.twisted-power.cross-stat-damage',
      value: Math.floor(applyCombatStageToStat(
        twisted.actor.token.satk,
        twisted.actor.token.combatStages.satk,
      ) / 2),
    }))

    const weirdSheet = pokemon({ slug: 'weird', abilities: ['Weird Power'] })
    weirdSheet.stats!.satk!.stage = 3
    const weirdState = fixture({ actor: weirdSheet })
    const weird = context(weirdState)
    const weirdPhysical = aa085to100MoveDamageModifiers({
      context: weird, operation,
      script: weird.queries.rules.reviewedScriptFor('Tackle')!,
      actor: weird.actor.token, recipient: weird.queries.tokens.get('target')!,
      moveType: 'normal', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    })
    expect(weirdPhysical).toContainEqual(expect.objectContaining({
      reasonCode: 'ability.weird-power.higher-offense-damage',
      value: applyCombatStageToStat(weird.actor.token.satk, weird.actor.token.combatStages.satk),
    }))
  })

  it('applies exact DB providers after reviewed bounds, including High Jump Kick Reckless aliasing', () => {
    const state = fixture({
      actor: pokemon({ slug: 'db', abilities: ['Punk Rock', 'Reckless', 'Strong Jaw', 'Technician', 'Tough Claws'] }),
    })
    const rules = context(state)
    expect(aa085to100DamageBaseBonus({
      context: rules,
      script: { moveName: 'Hyper Voice', damageBase: 9, range: 'Burst 1', keywords: ['Sonic'] },
      baseDamageBase: 9,
    })).toBe(2)
    expect(aa085to100DamageBaseBonus({
      context: rules,
      script: { moveName: 'High Jump Kick', damageBase: 13, range: 'Melee, 1 Target', keywords: [] },
      baseDamageBase: 13,
    })).toBe(5)
    expect(aa085to100DamageBaseBonus({
      context: rules,
      script: { moveName: 'Bite', damageBase: 6, range: 'Melee, 1 Target', keywords: [] },
      baseDamageBase: 6,
    })).toBe(6)
  })

  it('records each exact nonzero voluntary route segment without treating forced movement or Teleport as evidence', () => {
    const state = fixture({ actor: pokemon({ slug: 'movement-evidence' }) })
    const initial = state.map.encounterState!
    const zero = recordAa085to100MovementEvidence({
      encounterState: initial,
      placementId: 'actor', operationId: 'movement:zero', mode: 'voluntary',
      path: [{ x: 6, y: 0, z: 6 }, { x: 6, y: 0, z: 6 }],
    })
    expect(zero).toBe(initial)
    for (const mode of ['forced', 'teleport'] as const) {
      expect(recordAa085to100MovementEvidence({
        encounterState: initial,
        placementId: 'actor', operationId: `movement:${mode}`, mode,
        path: [{ x: 4, y: 0, z: 6 }, { x: 6, y: 0, z: 6 }],
      })).toBe(initial)
    }
    const first = recordAa085to100MovementEvidence({
      encounterState: initial,
      placementId: 'actor', operationId: 'movement:first', mode: 'voluntary',
      path: [{ x: 3, y: 0, z: 6 }, { x: 4, y: 0, z: 6 }],
    })
    const continued = recordAa085to100MovementEvidence({
      encounterState: first,
      placementId: 'actor', operationId: 'movement:continued', mode: 'voluntary',
      path: [{ x: 4, y: 0, z: 6 }, { x: 5, y: 0, z: 6 }, { x: 6, y: 0, z: 6 }],
    })
    const evidence = continued.effects.filter(effect => effect.tags.includes('aa085to100-movement-evidence'))
    expect(evidence).toHaveLength(2)
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({ operationId: 'movement:first' }),
        affected: expect.objectContaining({ placementIds: ['actor'], cells: [
          { x: 3, y: 0, z: 6 }, { x: 4, y: 0, z: 6 },
        ] }),
      }),
      expect.objectContaining({
        source: expect.objectContaining({ operationId: 'movement:continued' }),
        affected: expect.objectContaining({ placementIds: ['actor'], cells: [
          { x: 4, y: 0, z: 6 }, { x: 5, y: 0, z: 6 }, { x: 6, y: 0, z: 6 },
        ] }),
      }),
    ]))
  })

  it('binds Rock Head and Run Up to the exact straight voluntary route toward this target', () => {
    const state = fixture({
      actor: pokemon({ slug: 'runner', abilities: ['Rock Head', 'Run Up'] }),
    })
    const firstStraightSegment = recordAa085to100MovementEvidence({
      encounterState: state.map.encounterState!,
      placementId: 'actor', operationId: 'movement:straight:first', mode: 'voluntary',
      path: [2, 3, 4].map(x => ({ x, y: 0, z: 6 })),
    })
    state.map = {
      ...state.map,
      encounterState: recordAa085to100MovementEvidence({
        encounterState: firstStraightSegment,
        placementId: 'actor', operationId: 'movement:straight:second', mode: 'voluntary',
        path: [4, 5, 6].map(x => ({ x, y: 0, z: 6 })),
      }),
    }
    const rules = context(state)
    const operation = { id: 'tackle.damage' } as MoveDamageEffectOperation
    const modifiers = aa085to100MoveDamageModifiers({
      context: rules,
      operation,
      script: rules.queries.rules.reviewedScriptFor('Tackle')!,
      actor: rules.actor.token,
      recipient: rules.queries.tokens.get('target')!,
      moveType: 'normal', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    })
    expect(modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: 'ability.rock-head.straight-line-charge' }),
      expect.objectContaining({ reasonCode: 'ability.run-up.straight-line-distance', value: 4 }),
    ]))

    state.map = {
      ...state.map,
      encounterState: recordAa085to100MovementEvidence({
        encounterState: state.map.encounterState!,
        placementId: 'actor', operationId: 'movement:bent', mode: 'voluntary',
        path: [
          { x: 4, y: 0, z: 5 }, { x: 5, y: 0, z: 5 }, { x: 6, y: 0, z: 6 },
        ],
      }),
    }
    const bent = context(state)
    expect(aa085to100MoveDamageModifiers({
      context: bent,
      operation,
      script: bent.queries.rules.reviewedScriptFor('Tackle')!,
      actor: bent.actor.token,
      recipient: bent.queries.tokens.get('target')!,
      moveType: 'normal', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    }).some(modifier => modifier.reasonCode.includes('straight-line'))).toBe(false)
  })

  it('consumes generic curled-up state as exactly +10 to Rollout and Ice Ball damage rolls', () => {
    const curled = parseEncounterEffect({
      id: 'defense-curl.curled-up.test', kind: 'capability',
      source: { operationId: 'defense-curl.curled-up', moveId: 'defense-curl', placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['defense-curl', 'curled-up'],
      payload: { capabilityId: 'state.curled-up', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['curled-up'] },
      transferPolicy: 'expire', suppression: { sources: [] },
    }, 'test.curledUp')
    const state = fixture({
      actor: pokemon({ slug: 'curled', move: 'Rollout' }), effects: [curled],
    })
    const rules = context(state, 'Rollout')
    const actor = rules.actor.token
    const recipient = rules.queries.tokens.get('target')!
    const operation = { id: 'rollout.damage' } as MoveDamageEffectOperation
    const script = rules.queries.rules.reviewedScriptFor('Rollout')!
    const rollout = aa085to100MoveDamageModifiers({
      context: rules, operation, script, actor, recipient,
      moveType: 'rock', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    })
    expect(rollout).toContainEqual(expect.objectContaining({
      reasonCode: 'move.defense-curl.curled-up-damage', operation: 'add', value: 10,
    }))
    const iceBall = aa085to100MoveDamageModifiers({
      context: rules, operation, script: { ...script, moveName: 'Ice Ball' }, actor, recipient,
      moveType: 'ice', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    })
    expect(iceBall).toContainEqual(expect.objectContaining({
      reasonCode: 'move.defense-curl.curled-up-damage', operation: 'add', value: 10,
    }))
    const tackle = aa085to100MoveDamageModifiers({
      context: rules, operation, script: { ...script, moveName: 'Tackle' }, actor, recipient,
      moveType: 'normal', damageClass: 'physical', effectivenessMultiplier: 1, critical: false,
    })
    expect(tackle.some(entry => entry.reasonCode === 'move.defense-curl.curled-up-damage')).toBe(false)
  })

  it('scopes Teamwork and Victory Star to allied providers without stacking duplicate auras', () => {
    const selfOnly = fixture({
      actor: pokemon({ slug: 'self-aura', abilities: ['Teamwork', 'Victory Star'] }),
    })
    expect(aa085to100AccuracyModifiers({
      context: context(selfOnly), targetPlacementId: 'target',
      script: { range: 'Melee, 1 Target' },
    })).toEqual([])

    const state = fixture({ actor: pokemon({ slug: 'aura-actor' }) })
    for (const id of ['provider-a', 'provider-b']) {
      const provider = pokemon({ slug: id, abilities: ['Teamwork', 'Victory Star'] })
      state.pokemonSheets.set(id, provider)
      state.map.placements.push({
        id, sheetKind: 'pokemon', sheetSlug: id, sideId: 'heroes',
        position: { x: id === 'provider-a' ? 11 : 13, y: 0, z: 6 },
      })
    }
    const modifiers = aa085to100AccuracyModifiers({
      context: context(state), targetPlacementId: 'target',
      script: { range: 'Melee, 1 Target' },
    })
    expect(modifiers.filter(entry => entry.reason === 'Teamwork Accuracy')).toHaveLength(1)
    expect(modifiers.filter(entry => entry.reason === 'Victory Star Accuracy')).toHaveLength(1)

    const friendlyTarget = {
      ...state,
      map: {
        ...state.map,
        placements: state.map.placements.map(placement => placement.id === 'target'
          ? { ...placement, sideId: 'heroes' }
          : placement),
      },
    }
    expect(aa085to100AccuracyModifiers({
      context: context(friendlyTarget), targetPlacementId: 'target',
      script: { range: 'Melee, 1 Target' },
    }).some(entry => entry.reason === 'Teamwork Accuracy')).toBe(false)
  })

  it('uses effective ability authority for Quick Feet, Wave Rider, Unburden, and Slow Start Initiative', () => {
    const actor = pokemon({
      slug: 'initiative', species: 'Regigigas',
      abilities: ['Quick Feet', 'Wave Rider', 'Unburden', 'Slow Start'],
      conditions: ['Paralysis'],
    })
    const state = fixture({
      actor,
      voxels: [{ x: 6, y: 0, z: 6, materialId: 'water', tags: ['water'] }],
    })
    const projection = aa085to100InitiativeProjection({
      map: state.map,
      placement: state.map.placements[0]!,
      sheet: actor,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    expect(projection.speedCombatStageOffset).toBe(6)
    expect(projection.baseSpeedMultiplier).toBe(0.5)
    const projected = pokemonInitiativeOrderEntry(state.map.placements[0]!, actor, {
      conditionAbilityNames: projection.effectiveAbilityIds,
      speedCombatStageOffset: projection.speedCombatStageOffset,
      baseSpeedOffset: projection.baseSpeedOffset,
      baseSpeedMultiplier: projection.baseSpeedMultiplier,
    })
    const withoutAbilities = pokemonInitiativeOrderEntry(state.map.placements[0]!, actor, {
      conditionAbilityNames: [],
    })
    expect(projected.initiativeScore).toBeGreaterThan(withoutAbilities.initiativeScore)

    const fainted = {
      ...actor,
      combat: { ...actor.combat!, currentHp: 0, conditions: ['Fainted'] },
    }
    expect(aa085to100InitiativeProjection({
      map: state.map,
      placement: state.map.placements[0]!,
      sheet: fainted,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })).toMatchObject({
      effectiveAbilityIds: [],
      speedCombatStageOffset: 0,
      baseSpeedMultiplier: 1,
    })
  })

  it('applies Run Away trap immunity after temporary Shadow Tag projection', () => {
    const shadowTag = parseEncounterEffect({
      id: 'ability.shadow-tag.test', kind: 'capability',
      source: { operationId: 'shadow-tag:test', moveId: 'ability.shadow-tag', placementId: 'target' },
      affected: {
        placementIds: ['actor'], sideIds: [], cells: [{ x: 6, y: 0, z: 6 }],
      },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 5 },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa089-shadow-tag'],
      payload: { capabilityId: 'aa089.shadow-tag.pinned', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['aa089-shadow-tag'] },
      transferPolicy: 'expire', suppression: { sources: [] },
    }, 'test.shadowTag')
    const trapped = projectedActor(fixture({
      actor: pokemon({ slug: 'trapped' }), effects: [shadowTag],
    }))
    expect(trapped.conditions).toEqual(expect.arrayContaining(['Slowed', 'Trapped']))

    const escaped = projectedActor(fixture({
      actor: pokemon({ slug: 'escaped', abilities: ['Run Away'] }), effects: [shadowTag],
    }))
    expect(escaped.conditions).toContain('Slowed')
    expect(escaped.conditions).not.toContain('Trapped')
  })

  it('projects Schooling and canonical Solo reversion by Pokédex deltas without compounding', () => {
    const schoolSheet = pokemon({ slug: 'school', species: 'Wishiwashi Solo', abilities: ['Schooling'] })
    const school = fixture({
      actor: schoolSheet,
      temporaryHp: 20,
      effects: [formEffect({
        id: 'ability.schooling.form.test', tag: 'aa088-schooling', formId: 'wishiwashi-school-forme',
      })],
    })
    const raw = placementToSpawned(school.map.placements[0]!, {
      pokemon: school.pokemonSheets, trainer: new Map(),
    }, school.map)!
    const first = projectedActor(school)
    const second = projectedActor(school)
    expect(first.atk).toBe(projectedDelta(raw.atk, 'Wishiwashi Solo', 'Wishiwashi Schooling', 'atk'))
    expect(first.def).toBe(projectedDelta(raw.def, 'Wishiwashi Solo', 'Wishiwashi Schooling', 'def'))
    expect(first.base).toBe(3)
    expect(first.clearance).toBe(8)
    expect(first.movementCapabilities?.swim).toBe(1)
    expect(first.ruleCapabilities?.size).toBe('Huge')
    expect(first.ruleCapabilities?.other).toEqual(expect.arrayContaining(['Glow', 'Mindlock']))
    expect(first.movementTraits?.jump).toEqual({ long: 3, high: 3 })
    expect(first.movementProfile?.modes.find(mode => mode.mode === 'jump')).toMatchObject({
      available: true, longJump: 3, highJump: 3,
    })
    expect(second).toEqual(first)

    const transformedSheet = pokemon({
      slug: 'school-revert', species: 'Wishiwashi Schooling', abilities: ['Schooling'],
    })
    const revertedState = fixture({ actor: transformedSheet })
    const transformedRaw = placementToSpawned(revertedState.map.placements[0]!, {
      pokemon: revertedState.pokemonSheets, trainer: new Map(),
    }, revertedState.map)!
    const reverted = projectedActor(revertedState)
    expect(reverted.atk).toBe(projectedDelta(
      transformedRaw.atk, 'Wishiwashi Schooling', 'Wishiwashi Solo', 'atk',
    ))
    expect(reverted.base).toBe(1)
    expect(reverted.clearance).toBe(1)
    expect(reverted.movementCapabilities?.swim).toBe(3)
  })

  it('projects every form’s base Speed offset from the exact HP, THP, and form state', () => {
    const schooling = fixture({
      actor: pokemon({
        slug: 'school-initiative', species: 'Wishiwashi Solo', abilities: ['Schooling'], currentHp: 1,
      }),
      temporaryHp: 20,
      effects: [formEffect({
        id: 'ability.schooling.initiative', tag: 'aa088-schooling', formId: 'wishiwashi-school-forme',
      })],
    })
    expect(aa085to100InitiativeProjection({
      map: schooling.map,
      placement: schooling.map.placements[0]!,
      sheet: schooling.actor,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    }).baseSpeedOffset).toBe(-1)

    const minior = fixture({
      actor: pokemon({
        slug: 'minior-initiative', species: 'Minior Meteor',
        abilities: ['Shields Down'], currentHp: 1,
      }),
    })
    expect(aa085to100InitiativeProjection({
      map: minior.map,
      placement: minior.map.placements[0]!,
      sheet: minior.actor,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    }).baseSpeedOffset).toBe(6)

    const galar = fixture({
      actor: pokemon({
        slug: 'galar-initiative', species: 'Darmanitan Galar Standard Mode',
        abilities: ['Zen Snowed'],
      }),
      effects: [formEffect({
        id: 'ability.galar-zen.initiative', tag: 'aa100-zen-snowed',
        formId: 'galarian-darmanitan-zen-mode',
      })],
    })
    expect(aa085to100InitiativeProjection({
      map: galar.map,
      placement: galar.map.placements[0]!,
      sheet: galar.actor,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    }).baseSpeedOffset).toBe(4)
  })

  it('projects Shields Down and both Zen forms with stats, typing, weight, footprint, and movement', () => {
    const minior = fixture({
      actor: pokemon({
        slug: 'minior', species: 'Minior Meteor', abilities: ['Shields Down'], currentHp: 1,
      }),
    })
    const core = projectedActor(minior)
    expect(core.atk).toBeGreaterThan(core.def)
    expect(core.weightClass).toBe(1)
    expect(core.movementCapabilities?.sky).toBe(7)

    const zen = fixture({
      actor: pokemon({ slug: 'zen', species: 'Darmanitan', abilities: ['Zen Mode'] }),
      effects: [formEffect({
        id: 'ability.zen.form.test', tag: 'aa100-zen-mode', formId: 'darmanitan-zen-mode',
      })],
    })
    const zenToken = projectedActor(zen)
    expect(zenToken.defenderTypes).toEqual(['Fire', 'Psychic'])
    expect(zenToken.movementCapabilities?.overland).toBe(2)
    expect(zenToken.movementCapabilities?.levitate).toBe(6)
    expect(zenToken.movementProfile?.speeds.levitate).toBe(6)
    expect(zenToken.movementProfile?.modes.find(mode => mode.mode === 'levitate')).toMatchObject({
      available: true, speed: 6,
    })
    const zenInitiative = aa085to100InitiativeProjection({
      map: zen.map,
      placement: zen.map.placements[0]!,
      sheet: zen.actor,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    expect(zenInitiative.baseSpeedOffset).toBe(-4)
    expect(zenToken.ruleCapabilities?.movementSpeeds.levitate).toBe(6)
    expect(zenToken.ruleCapabilities?.other).toEqual(expect.arrayContaining(['Telekinetic', 'Telepath']))
    expect(zenToken.defenderCapabilities?.levitate).toBe(6)

    const galar = fixture({
      actor: pokemon({
        slug: 'galar-zen', species: 'Darmanitan Galar Standard Mode', abilities: ['Zen Snowed'],
      }),
      effects: [formEffect({
        id: 'ability.galar-zen.form.test', tag: 'aa100-zen-snowed',
        formId: 'galarian-darmanitan-zen-mode',
      })],
    })
    const galarToken = projectedActor(galar)
    expect(galarToken.defenderTypes).toEqual(['Ice', 'Fire'])
    expect(galarToken.movementCapabilities?.overland).toBe(7)
    expect(galarToken.clearance).toBe(2)
  })
})
