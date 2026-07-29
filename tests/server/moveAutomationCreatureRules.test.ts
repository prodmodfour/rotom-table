import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  projectEncounterCreatureRules,
} from '#shared/moveAutomation/creatureRuleOverlays'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  createMoveAutomationCreatureRuleResolver,
  MoveAutomationCreatureRuleQueryError,
} from '~~/server/domain/moveAutomation/creatureRules'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const placement = (id = 'target-token'): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  position: { x: 0, y: 0, z: 0 },
})

const token = (id = 'target-token'): SpawnedPokemon => {
  const sonic = {
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'sonic-lock',
      action: 'lock',
    }),
    id: 'effect.throat-chop.sonic-lock',
  }
  const creatureRules = projectEncounterCreatureRules({
    base: {
      typeIds: ['water'],
      abilityNames: ['Torrent'],
      formId: 'school-form',
      size: 'large',
      capabilityIds: ['movement.swim', 'capability.fountain'],
      grounding: 'airborne',
    },
    effects: [sonic],
    target: { placementId: id, position: { x: 0, y: 0, z: 0 } },
  })
  return {
    id,
    species: id,
    size: 'Large',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    slug: id,
    spriteUrl: `/sprites/${id}.png`,
    entityKind: 'pokemon',
    position: { x: 0, y: 0, z: 0 },
    sheetKind: 'pokemon',
    sheetSlug: id,
    level: 20,
    currentHp: 50,
    maxHp: 50,
    atk: 10,
    satk: 10,
    def: 10,
    sdef: 10,
    defenderTypes: ['water'],
    abilityNames: ['Torrent'],
    movementCapabilities: { swim: 6 },
    movementTraits: { phasing: false, jump: { long: 1, high: 1 } },
    movementProfile: {
      speeds: { swim: 6 },
      traits: { phasing: false, jump: { long: 1, high: 1 } },
      state: { grounding: 'airborne', semiInvulnerable: 'none' },
      modes: [],
      sourceEffectIds: [],
    },
    creatureRules,
    combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
    conditions: [],
    tokenItems: [],
  }
}

describe('authoritative creature-rule queries', () => {
  it('queries projected type, ability, form, size, capability, grounding, and Sonic state by placement ID', () => {
    const consulted: string[] = []
    const resolver = createMoveAutomationCreatureRuleResolver({
      placements: [placement()],
      tokens: [token()],
      resolveGrounding: () => 'grounded',
      recordSheetRead: sheet => consulted.push(`${sheet.sheetKind}:${sheet.sheetSlug}`),
    })

    expect(resolver.resolve('target-token')).toMatchObject({
      typeIds: ['water'],
      abilityNames: ['Torrent'],
      formId: 'school-form',
      size: 'large',
      capabilityIds: ['movement.swim', 'capability.fountain'],
      grounding: 'grounded',
      sonicLocked: true,
    })
    expect(resolver.hasType('target-token', 'Water')).toBe(true)
    expect(resolver.hasAbility('target-token', 'torrent')).toBe(true)
    expect(resolver.hasCapability('target-token', 'movement.swim')).toBe(true)
    expect(resolver.sonicUse('target-token')).toEqual({
      allowed: false,
      reasonCode: 'creature.sonic-locked',
      sourceEffectIds: ['effect.throat-chop.sonic-lock'],
    })
    expect(resolver.resolve('missing')).toBeNull()
    expect(consulted).toEqual([
      'pokemon:target-token',
      'pokemon:target-token',
      'pokemon:target-token',
      'pokemon:target-token',
      'pokemon:target-token',
    ])
  })

  it('uses exact canonical capability identities for Pokémon and Trainers despite unrelated overlays', () => {
    const pokemonId = 'pokemon-token'
    const trainerId = 'trainer-token'
    const identities = (id: string) => [{
      instanceId: `capability:${id}:Jump:jump-0-0`,
      canonicalId: 'Jump',
    }, {
      instanceId: `capability:${id}:Teleporter:value-4`,
      canonicalId: 'Teleporter',
    }]
    const resolver = createMoveAutomationCreatureRuleResolver({
      placements: [
        placement(pokemonId),
        { ...placement(trainerId), sheetKind: 'trainer' },
      ],
      tokens: [
        token(pokemonId),
        { ...token(trainerId), sheetKind: 'trainer' },
      ],
      effectiveCapabilityIdentitiesByPlacement: new Map([
        [pokemonId, identities(pokemonId)],
        [trainerId, identities(trainerId)],
      ]),
    })

    for (const id of [pokemonId, trainerId]) {
      expect(resolver.resolve(id)?.capabilityIds).toEqual([
        'Jump',
        'capability.jump',
        'movement.jump',
        'Teleporter',
        'capability.teleporter',
        'movement.teleport',
      ])
      expect(resolver.hasCapability(id, 'Jump')).toBe(true)
      expect(resolver.hasCapability(id, 'movement.jump')).toBe(true)
      expect(resolver.hasCapability(id, 'capability.teleporter')).toBe(true)
      expect(resolver.hasCapability(id, 'movement.teleport')).toBe(true)
      expect(resolver.hasCapability(id, 'Swim')).toBe(false)
      expect(resolver.hasCapabilityInstance(
        id,
        `capability:${id}:Jump:jump-0-0`,
        'Jump',
      )).toBe(true)
      expect(resolver.hasCapabilityInstance(
        id,
        `capability:${id}:Jump:jump-0-0`,
        'Teleporter',
      )).toBe(false)
      expect(resolver.hasCapabilityInstance(
        id,
        `capability:${id}:Teleporter:value-4`,
        'Jump',
      )).toBe(false)
    }
  })

  it('wires canonical Pokémon and Trainer identities through the authoritative context', () => {
    const pokemonPlacement = placement('pokemon-token')
    const trainerPlacement: SheetPlacement = {
      ...placement('trainer-token'),
      sheetKind: 'trainer',
    }
    const unrelatedOverlay = {
      ...creatureRuleOverlayEncounterEffectFixture({
        domain: 'sonic-lock',
        action: 'lock',
      }),
      affected: {
        placementIds: [pokemonPlacement.id, trainerPlacement.id],
        sideIds: [],
        cells: [],
      },
    }
    const map: TabletopMap = {
      schemaVersion: 2,
      slug: 'canonical-capability-arena',
      name: 'Canonical Capability Arena',
      revision: 1,
      dimensions: { x: 8, y: 3, z: 8 },
      voxels: [],
      placements: [pokemonPlacement, trainerPlacement],
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [unrelatedOverlay],
      },
    }
    const pokemon: CharacterSheet = {
      slug: pokemonPlacement.sheetSlug,
      nickname: 'Jumper',
      species: 'Ditto',
      level: 20,
      movelist: [{ name: 'Tackle' }],
      capabilities: { jump: '0/0', other: ['Teleporter 4'] },
    }
    const trainer: TrainerSheet = {
      slug: trainerPlacement.sheetSlug,
      name: 'Trainer Jumper',
      level: 20,
      capabilities: { highJump: 0, longJump: 0, other: ['Teleporter 4'] },
    }
    const context = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: pokemonPlacement.id,
        moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: trainerPlacement.id },
      },
      candidatePlacementIds: [trainerPlacement.id],
      selectedPlacementIds: [trainerPlacement.id],
      random: () => 0.5,
      time: 1_000,
    })

    for (const placementId of [pokemonPlacement.id, trainerPlacement.id]) {
      const jumpInstanceId = `capability:${placementId}:Jump:jump-0-0`
      const teleporterInstanceId = `capability:${placementId}:Teleporter:value-4`
      expect(context.queries.creatureRules.resolve(placementId)?.capabilityIds).toEqual(
        expect.arrayContaining(['Jump', 'movement.jump', 'Teleporter', 'movement.teleport']),
      )
      expect(context.queries.creatureRules.hasCapability(placementId, 'Jump')).toBe(true)
      expect(context.queries.creatureRules.hasCapability(placementId, 'Teleporter')).toBe(true)
      expect(context.queries.creatureRules.hasCapabilityInstance(
        placementId,
        jumpInstanceId,
        'Jump',
      )).toBe(true)
      expect(context.queries.creatureRules.hasCapabilityInstance(
        placementId,
        jumpInstanceId,
        'Teleporter',
      )).toBe(false)
      expect(context.queries.creatureRules.hasCapabilityInstance(
        placementId,
        teleporterInstanceId,
        'Teleporter',
      )).toBe(true)
    }
  })

  it('expires through ordinary lifecycle timing and recomputes the underlying rules', () => {
    const activeEffect = {
      ...creatureRuleOverlayEncounterEffectFixture({
        domain: 'type',
        action: 'replace',
        values: ['water'],
        referencePlacementId: null,
        suppressionScope: null,
      }),
      duration: { kind: 'turns' as const, subject: 'target' as const, boundary: 'end' as const, remaining: 1 },
    }
    const active = projectEncounterCreatureRules({
      base: {
        typeIds: ['fire'],
        abilityNames: [],
        formId: 'base-form',
        size: 'medium',
        capabilityIds: [],
        grounding: 'grounded',
      },
      effects: [activeEffect],
      target: { placementId: 'target-token' },
    })
    const expiredEffects = applyEncounterEffectLifecycleEvent(
      { effects: [activeEffect] },
      { kind: 'turn-end', placementId: 'target-token' },
    ).effects
    const restored = projectEncounterCreatureRules({
      base: {
        typeIds: ['fire'],
        abilityNames: [],
        formId: 'base-form',
        size: 'medium',
        capabilityIds: [],
        grounding: 'grounded',
      },
      effects: expiredEffects,
      target: { placementId: 'target-token' },
    })

    expect(active.typeIds).toEqual(['water'])
    expect(expiredEffects).toEqual([])
    expect(restored.typeIds).toEqual(['fire'])
    expect(restored.sources).toEqual([])
  })

  it('fails closed for mismatched snapshots and duplicate identities', () => {
    const mismatched = createMoveAutomationCreatureRuleResolver({
      placements: [placement()],
      tokens: [{ ...token(), sheetSlug: 'other' }],
    })
    expect(mismatched.resolve('target-token')).toBeNull()
    expect(mismatched.sonicUse('target-token')).toMatchObject({
      allowed: false,
      reasonCode: 'creature.rules-unresolved',
    })

    expect(() => createMoveAutomationCreatureRuleResolver({
      placements: [placement(), placement()],
      tokens: [token()],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationCreatureRuleQueryError.name,
      code: 'duplicate-placement-id',
    }))
    expect(() => createMoveAutomationCreatureRuleResolver({
      placements: [placement()],
      tokens: [token(), token()],
    })).toThrowError(expect.objectContaining({ code: 'duplicate-token-id' }))
  })
})
