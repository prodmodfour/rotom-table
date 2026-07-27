import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { applyAa091SprintTrigger } from '~~/server/domain/abilityAutomation/mechanics/aa085to100ActionIntegration'
import { REMAINING_ABILITY_TEST_REGISTRY } from '../fixtures/abilityAutomation/remainingRegistry'

const sprintSheet = (): CharacterSheet => ({
  slug: 'sprinter', nickname: 'Sprinter', species: 'Eevee', level: 20, revision: 1,
  types: ['Normal'],
  abilities: [{
    name: 'Sprint',
    automation: {
      schemaVersion: 1, instanceId: 'base:sprint', canonicalId: 'Sprint',
      definitionVersion: null, selections: [],
    },
  }],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 10 }, atk: { added: 10 }, def: { added: 10 },
    satk: { added: 10 }, sdef: { added: 10 }, spd: { added: 10 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 50, injuries: 0, conditions: [] },
})

const placement: SheetPlacement = {
  id: 'actor', sheetKind: 'pokemon', sheetSlug: 'sprinter', sideId: 'heroes',
  position: { x: 2, y: 0, z: 2 },
}

const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'sprint-trigger', name: 'Sprint trigger', revision: 1,
    dimensions: { x: 10, y: 4, z: 10 }, groundLevelY: 0,
    voxels: [], hazards: [], placements: [placement],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    activeScene: { name: 'Scene', startedAt: 1 },
    initiative: { activeId: 'actor', round: 1 },
    encounterState: {
      ...encounter,
      history: {
        ...encounter.history,
        sceneId: 'scene:sprint-trigger', currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
    },
  }
}

describe('AA-085 through AA-100 action conformance', () => {
  it('records Sprint trigger evidence exactly once without applying stages or payment', () => {
    const sheet = sprintSheet()
    const combatStages = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }
    const first = applyAa091SprintTrigger({
      map: map(), placement, sheet, combatStages,
      operationId: 'maneuver:sprint:accepted:1',
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    expect(first.applied).toBe(true)
    expect(first.sheet).toBe(sheet)
    expect(first.sheet.combatStages).toEqual(sheet.combatStages)
    expect(first.map.encounterState?.effects).toHaveLength(1)
    expect(first.map.encounterState?.effects[0]).toMatchObject({
      source: { operationId: 'maneuver:sprint:accepted:1', placementId: 'actor' },
      tags: expect.arrayContaining(['aa091-sprint-trigger', 'maneuver-sprint']),
      affected: { placementIds: ['actor'] },
      charges: 1,
    })
    expect(first.map.encounterState?.turnResources).toEqual({})

    const repeated = applyAa091SprintTrigger({
      map: first.map, placement, sheet, combatStages,
      operationId: 'maneuver:sprint:accepted:1',
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    expect(repeated.applied).toBe(false)
    expect(repeated.map).toBe(first.map)
    expect(repeated.map.encounterState?.effects).toHaveLength(1)
  })
})
