import { describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { placementToSpawned } from '~/utils/placement'
import {
  capabilityEncounterEffectFixture,
  transformationEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const placement: SheetPlacement = {
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'morph',
  position: { x: 2, y: 0, z: 2 },
  sideId: 'heroes',
}

const sheet = (): CharacterSheet => ({
  revision: 7,
  slug: 'morph',
  nickname: 'Morph',
  species: 'Ditto',
  level: 22,
  totalExp: 55,
  gender: 'Genderless',
  loyalty: 4,
  stats: {
    hp: { added: 3, stage: 0 },
    atk: { added: 4, stage: 2 },
    def: { added: 5, stage: -1 },
    satk: { added: 6, stage: 1 },
    sdef: { added: 7, stage: 0 },
    spd: { added: 8, stage: 3 },
  },
  combat: { currentHp: 17, injuries: 1, conditions: ['Burned'] },
  combatStages: { acc: 2 },
  items: { held: 'Leftovers' },
  abilities: [{ name: 'Limber' }],
  movelist: [{ name: 'Transform' }, { name: 'Pound' }],
})

const map = (effects: readonly EncounterEffect[]): TabletopMap => ({
  schemaVersion: 2,
  slug: 'transformation-arena',
  name: 'Transformation Arena',
  revision: 4,
  dimensions: { x: 12, y: 4, z: 12 },
  voxels: [],
  placements: [placement],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
    },
    effects,
  },
})

describe('reversible encounter transformation projection', () => {
  it('copies only form facts while retaining every user-owned stat and state value', () => {
    const sourceSheet = sheet()
    const originalSheet = structuredClone(sourceSheet)
    const base = placementToSpawned(placement, {
      pokemon: new Map([['morph', sourceSheet]]),
      trainer: new Map(),
    })!
    const levitate = parseEncounterEffect({
      ...capabilityEncounterEffectFixture(),
      id: 'effect.capability.transformed-levitate',
      affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
      payload: { capabilityId: 'movement.levitate', action: 'grant', value: 4 },
    })
    const transformed = placementToSpawned(placement, {
      pokemon: new Map([['morph', sourceSheet]]),
      trainer: new Map(),
    }, map([transformationEncounterEffectFixture(), levitate]))!

    expect(transformed).toMatchObject({
      id: 'actor-token',
      sheetKind: 'pokemon',
      sheetSlug: 'morph',
      species: 'Morph',
      level: 22,
      currentHp: base.currentHp,
      maxHp: base.maxHp,
      injuries: 1,
      atk: base.atk,
      def: base.def,
      satk: base.satk,
      sdef: base.sdef,
      spd: base.spd,
      combatStages: base.combatStages,
      conditions: base.conditions,
      tokenItems: base.tokenItems,
      size: 'Large',
      width: 2.1,
      height: 2.1,
      base: 2,
      clearance: 2,
      slug: 'snorlax',
      spriteUrl: '/sprites/snorlax.gif',
      defenderTypes: ['normal'],
      abilityNames: ['Thick Fat', 'Immunity'],
      weightClass: 6,
      movementCapabilities: { overland: 5, swim: 1, levitate: 4 },
      transformation: {
        effectId: 'effect.transformation.actor-token',
        copiedFromPlacementId: 'target-token',
        appearanceSpecies: 'Snorlax',
      },
    })
    expect(transformed.ruleCapabilities).toMatchObject({
      power: 12,
      size: 'Large',
      naturewalk: 'Forest, Mountain',
      other: ['Tracker'],
      movementSpeeds: { overland: 5, swim: 1, levitate: 4 },
    })
    expect(sourceSheet).toEqual(originalSheet)
    expect(base).not.toHaveProperty('transformation')
    expect(base.slug).not.toBe(transformed.slug)
  })

  it('reconstructs the same active form after a JSON reload and restores from sheet state after expiry', () => {
    const sourceSheet = sheet()
    const transformation = transformationEncounterEffectFixture()
    const activeMap = map([transformation])
    const reloadedState = parseEncounterState(
      JSON.parse(JSON.stringify(activeMap.encounterState)),
    )
    const reloadedMap = { ...activeMap, encounterState: reloadedState }
    const lookups = {
      pokemon: new Map([['morph', sourceSheet]]),
      trainer: new Map(),
    }

    const beforeReload = placementToSpawned(placement, lookups, activeMap)!
    const afterReload = placementToSpawned(placement, lookups, reloadedMap)!
    const restored = placementToSpawned(placement, lookups, {
      ...reloadedMap,
      encounterState: { ...reloadedState, effects: [] },
    })!

    expect(afterReload).toEqual(beforeReload)
    expect(afterReload.transformation?.appearanceSpecies).toBe('Snorlax')
    expect(restored.transformation).toBeUndefined()
    expect(restored.slug).toBe('ditto')
    expect(restored.defenderTypes.map(type => type.toLowerCase())).toEqual(['normal'])
    expect(restored.abilityNames).toEqual(['Limber'])
    expect(restored.currentHp).toBe(afterReload.currentHp)
    expect(restored.atk).toBe(afterReload.atk)
    expect(restored.combatStages).toEqual(afterReload.combatStages)
  })
})
