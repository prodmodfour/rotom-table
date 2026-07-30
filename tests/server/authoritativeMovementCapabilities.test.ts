import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import {
  resolveMovement,
  type AuthoritativeMovementSheets,
} from '~~/server/domain/movement/resolveMovement'
import { applyAuthoritativeMovementMapTransition } from '~~/server/domain/movement/applyMovementTransition'
import { resolveEffectiveCapabilities } from '~~/server/domain/capabilityAutomation/effectiveCapabilities'

const placement = (position = { x: 0, y: 0, z: 0 }): SheetPlacement => ({
  id: 'actor',
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  position,
})

const pokemonSheet = (
  capabilities: NonNullable<CharacterSheet['capabilities']>,
): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Actor',
  species: 'Bulbasaur',
  level: 10,
  revision: 3,
  capabilities,
})

const sheets = (sheet: CharacterSheet): AuthoritativeMovementSheets => ({
  pokemon: new Map([[sheet.slug, sheet]]),
  trainer: new Map<string, TrainerSheet>(),
})

const map = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'movement-capability-arena',
  name: 'Movement Capability Arena',
  revision: 4,
  dimensions: { x: 6, y: 4, z: 4 },
  groundLevelY: 0,
  voxels: [],
  placements: [placement()],
  ...overrides,
})

const movementEffect = (options: {
  readonly id: string
  readonly capabilityId: string
  readonly action?: 'grant' | 'suppress'
  readonly value?: number
}): EncounterCapabilityEffect => ({
  id: options.id,
  kind: 'capability',
  source: {
    operationId: `${options.id}.operation`,
    moveId: 'move.temporary-movement',
    placementId: 'actor',
  },
  affected: { placementIds: ['actor'], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['movement'],
  payload: {
    capabilityId: options.capabilityId,
    action: options.action ?? 'grant',
    ...(options.value === undefined ? {} : { value: options.value }),
  },
  dispel: { policy: 'matching-tags', tags: ['movement'] },
  suppression: { sources: [] },
})

const resolve = (
  arena: TabletopMap,
  sheet: CharacterSheet,
  destination: { x: number; y: number; z: number },
) => resolveMovement({
  map: arena,
  sheets: sheets(sheet),
  placementId: 'actor',
  mode: 'shift',
  destination,
})

describe('authoritative movement capabilities', () => {
  it('projects sheet phasing, jump, and Wallclimber capabilities into movement queries', () => {
    const sheet = pokemonSheet({
      overland: 6,
      jump: '3/2',
      other: ['Phasing', 'Wallclimber'],
    })
    const slow = resolve(map({
      voxels: [{
        x: 1,
        y: 0,
        z: 0,
        materialId: 'mud',
        blocksMovement: false,
      }],
    }), sheet, { x: 1, y: 0, z: 0 })

    expect(slow).toMatchObject({
      ok: true,
      cost: 1,
      movementProfile: {
        speeds: { overland: 6, climb: 3 },
        traits: { phasing: true, jump: { long: 3, high: 2 } },
        state: { grounding: 'grounded', semiInvulnerable: 'none' },
      },
    })

    const climb = resolve(map({
      voxels: [{ x: 1, y: 1, z: 0, materialId: 'airship_wall_bulkhead' }],
    }), sheet, { x: 0, y: 1, z: 0 })
    expect(climb).toMatchObject({
      ok: true,
      cost: 1,
      capabilityLimit: 3,
      capabilities: {
        used: [{ key: 'climb', label: 'Climb', speed: 3 }],
      },
    })
  })

  it('does not restore raw Phasing traits while the exact Capability is suppressed', () => {
    const sheet = pokemonSheet({ overland: 6, other: ['Phasing'] })
    const suppressed = movementEffect({
      id: 'effect.suppress-phasing', capabilityId: 'phasing', action: 'suppress',
    })
    const result = resolve(map({
      voxels: [{ x: 1, y: 0, z: 0, materialId: 'mud', blocksMovement: false }],
      encounterState: { ...createEmptyEncounterState(), effects: [suppressed] },
    }), sheet, { x: 1, y: 0, z: 0 })
    expect(result).toMatchObject({
      ok: true,
      cost: 2,
      movementProfile: { traits: { phasing: false } },
    })
  })

  it('lets a valued typed effect grant aerial movement and restores legality on expiry', () => {
    const sheet = pokemonSheet({ overland: 5 })
    const levitate = movementEffect({
      id: 'effect.temporary-levitate',
      capabilityId: 'movement.levitate',
      value: 4,
    })
    const encounterState = {
      ...createEmptyEncounterState(),
      effects: [levitate],
    }
    const activeMap = map({ encounterState })

    const active = resolve(activeMap, sheet, { x: 0, y: 1, z: 0 })
    expect(active).toMatchObject({
      ok: true,
      capabilities: {
        used: [{ key: 'levitate', label: 'Levitate', speed: 4 }],
      },
      movementProfile: {
        state: { grounding: 'airborne', semiInvulnerable: 'none' },
        sourceEffectIds: ['effect.temporary-levitate'],
      },
    })

    const expired = applyEncounterEffectLifecycleEvent(
      { effects: encounterState.effects },
      { kind: 'round-end' },
    )
    expect(expired.effects).toEqual([])

    const restored = resolve(map({
      encounterState: { ...encounterState, effects: expired.effects },
    }), sheet, { x: 0, y: 1, z: 0 })
    expect(restored).toMatchObject({
      ok: false,
      reasonCode: 'movement-capability-missing',
    })
  })

  it('moves an exact source-effective linked companion with the authoritative transition', () => {
    const actorSheet = pokemonSheet({ overland: 5, other: ['As One'] })
    const mountSheet: CharacterSheet = {
      slug: 'mount', nickname: 'Mount', species: 'Bulbasaur', level: 10,
      capabilities: { overland: 5 },
    }
    const actor = placement()
    const mount: SheetPlacement = {
      id: 'mount', sheetKind: 'pokemon', sheetSlug: 'mount', position: { x: 0, y: 0, z: 0 },
    }
    const baseMap = map({ placements: [actor, mount], encounterState: createEmptyEncounterState() })
    const lookup = {
      pokemon: new Map([[actorSheet.slug, actorSheet], [mountSheet.slug, mountSheet]]),
      trainer: new Map<string, TrainerSheet>(),
    }
    const instance = resolveEffectiveCapabilities({
      map: baseMap, placement: actor, sheet: actorSheet, sheets: lookup,
    }).instances.find(candidate => candidate.effective && candidate.canonicalId === 'As One')!
    const encounter = createEmptyEncounterState()
    const linkedMap = map({
      placements: [actor, mount],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'active-link', kind: 'as-one-mount', ownerPlacementId: 'actor',
            participantPlacementIds: ['mount'], capabilityInstanceId: instance.instanceId,
            canonicalId: 'As One', establishedAt: 1, configurationId: null,
            sourceOperationId: 'operation',
          }],
        },
      },
    })
    const result = resolveMovement({
      map: linkedMap, sheets: lookup, placementId: 'actor', mode: 'shift',
      destination: { x: 1, y: 0, z: 0 },
    })
    expect(result).toMatchObject({ ok: true, linkedCompanionPlacementIds: ['mount'] })
    if (!result.ok) throw new Error(result.message)
    const transition = applyAuthoritativeMovementMapTransition({
      map: linkedMap, placementId: 'actor', destination: result.destination,
      distance: result.cost, encounterState: linkedMap.encounterState!, timestamp: 10,
      userName: 'Actor', linkedCompanionPlacementIds: result.linkedCompanionPlacementIds,
    })
    expect(transition.nextMap.placements.find(candidate => candidate.id === 'mount')?.position)
      .toEqual({ x: 1, y: 0, z: 0 })
  })

  it('marks physical contact as a noticeable Illusion disruption without destroying source authority', () => {
    const encounter = createEmptyEncounterState()
    const arena = map({
      placements: [
        placement(),
        { id: 'illusionist', sheetKind: 'pokemon', sheetSlug: 'illusionist', position: { x: 3, y: 0, z: 0 } },
      ],
      metadata: {
        capabilityIllusions: [{
          id: 'capability-illusion:illusionist', ownerPlacementId: 'illusionist',
          position: { x: 1, y: 0, z: 0 }, description: 'a candle flame',
          sourceOperationId: 'operation:create-illusion',
        }],
      },
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'capability.mode.illusionist.illusion', actorPlacementId: 'illusionist',
            capabilityInstanceId: 'capability:illusionist:Illusionist:base', canonicalId: 'Illusionist',
            mode: 'illusion', description: 'a candle flame', configurationId: 'motion:minor',
            activatedAt: 1, expiresAt: null, sourceOperationId: 'operation:create-illusion',
          }],
        },
      },
    })
    const transition = applyAuthoritativeMovementMapTransition({
      map: arena, placementId: 'actor', destination: { x: 2, y: 0, z: 0 }, distance: 2,
      encounterState: arena.encounterState!, timestamp: 42, userName: 'Actor',
      movementEvidence: {
        operationId: 'operation:move-through-illusion', mode: 'voluntary',
        path: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      },
    })

    expect(transition.nextMap.metadata?.capabilityIllusions).toContainEqual(expect.objectContaining({
      ownerPlacementId: 'illusionist', disrupted: true, disruptedAt: 42,
      disruptedByPlacementId: 'actor',
    }))
    expect(transition.nextMap.encounterState?.capabilityRuntime?.modes).toContainEqual(expect.objectContaining({
      actorPlacementId: 'illusionist', mode: 'illusion',
      capabilityInstanceId: 'capability:illusionist:Illusionist:base',
    }))
  })

  it('does not let a source-lost link hide collisions or move stale companions', () => {
    const actorSheet = pokemonSheet({ overland: 5, other: [] })
    const mountSheet: CharacterSheet = {
      slug: 'mount', nickname: 'Mount', species: 'Bulbasaur', level: 10,
      capabilities: { overland: 5 },
    }
    const encounter = createEmptyEncounterState()
    const arena = map({
      placements: [
        placement(),
        { id: 'mount', sheetKind: 'pokemon', sheetSlug: 'mount', position: { x: 1, y: 0, z: 0 } },
      ],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'stale-link', kind: 'as-one-mount', ownerPlacementId: 'actor',
            participantPlacementIds: ['mount'], capabilityInstanceId: 'lost-as-one-source',
            canonicalId: 'As One', establishedAt: 1, configurationId: null,
            sourceOperationId: 'old-operation',
          }],
        },
      },
    })
    const result = resolveMovement({
      map: arena,
      sheets: {
        pokemon: new Map([[actorSheet.slug, actorSheet], [mountSheet.slug, mountSheet]]),
        trainer: new Map(),
      },
      placementId: 'actor', mode: 'shift', destination: { x: 1, y: 0, z: 0 },
    })
    expect(result).toMatchObject({ ok: false, reasonCode: 'movement-destination-occupied' })
  })

  it('temporarily suppresses a sheet mode without rewriting the sheet', () => {
    const sheet = pokemonSheet({ overland: 5 })
    const suppress = movementEffect({
      id: 'effect.suppress-overland',
      capabilityId: 'movement.overland',
      action: 'suppress',
    })
    const encounterState = { ...createEmptyEncounterState(), effects: [suppress] }

    expect(resolve(map({ encounterState }), sheet, { x: 1, y: 0, z: 0 })).toMatchObject({
      ok: false,
      reasonCode: 'movement-capability-missing',
    })
    expect(sheet.capabilities?.overland).toBe(5)

    const expired = applyEncounterEffectLifecycleEvent(
      { effects: encounterState.effects },
      { kind: 'round-end' },
    )
    expect(resolve(map({
      encounterState: { ...encounterState, effects: expired.effects },
    }), sheet, { x: 1, y: 0, z: 0 })).toMatchObject({
      ok: true,
      cost: 1,
      movementProfile: { sourceEffectIds: [] },
    })
    expect(sheet.capabilities?.overland).toBe(5)
  })
})
