import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  AA069_FADE_AWAY_SHIFT_MARK,
} from '#shared/abilityAutomation/aa069'
import { reduceAbilityOwnedStateCommand } from '../../server/domain/abilityAutomation/ownedState'
import { resolveMovement } from '../../server/domain/movement/resolveMovement'
import { planAuthoritativeMovementResources } from '../../server/domain/movement/planMovementResources'

const actorSheet = (): CharacterSheet => ({
  slug: 'actor', nickname: 'actor', species: 'Bulbasaur', level: 10, revision: 1,
  capabilities: { overland: 4, swim: 0, sky: 0, levitate: 0 },
})
const mapFixture = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa069-movement', name: 'AA-069 Movement', revision: 7,
    dimensions: { x: 10, y: 4, z: 4 }, groundLevelY: 0, voxels: [],
    placements: [{
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes',
      position: { x: 0, y: 0, z: 0 },
    }],
    encounterState: {
      ...encounter,
      history: {
        ...encounter.history, sceneId: 'scene:aa069', currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: {
        actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }),
      },
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 1 },
  }
}
const withMark = (map: TabletopMap, input: {
  canonicalId: string
  abilityInstanceId: string
  markId: string
  stateId: string
}): TabletopMap => {
  const encounter = parseEncounterState(map.encounterState)
  const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
    operationId: `op:${input.stateId}`,
    kind: 'create', stateId: input.stateId, expectedVersion: null,
    entry: {
      stateId: input.stateId, ownerPlacementId: 'actor',
      sourceAbilityInstanceId: input.abilityInstanceId,
      canonicalId: input.canonicalId, targetPlacementIds: [],
      lifecycle: { kind: 'turn', targetPolicy: null },
      payload: { kind: 'mark', markId: input.markId },
    },
  })
  return { ...map, encounterState: parseEncounterState({ ...encounter, abilityOwnedState: reduced.state }) }
}
const resolve = (map: TabletopMap, destinationX: number) => resolveMovement({
  map,
  sheets: { pokemon: new Map([['actor', actorSheet()]]), trainer: new Map() },
  placementId: 'actor', mode: 'shift', destination: { x: destinationX, y: 0, z: 0 },
})

describe('AA-069 movement integration', () => {
  it('aa069.electrodash.reviewed authoritatively raises every Movement Speed by 50% for the marked turn', () => {
    const base = resolve(mapFixture(), 6)
    expect(base).toMatchObject({ ok: false, reasonCode: 'movement-cost-exceeds-limit' })

    const activeMap = mapFixture()
    const encounter = parseEncounterState(activeMap.encounterState)
    const sprintEffect = parseEncounterEffect({
      id: 'effect.electrodash.sprint', kind: 'numeric-modifier',
      source: { operationId: 'op_electrodash', moveId: 'ability.electrodash', placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'electrodash', 'sprint'],
      payload: { attribute: 'movement', operation: 'multiply', value: 1.5, rounding: 'floor' },
      dispel: { policy: 'matching-tags', tags: ['electrodash', 'sprint'] },
      transferPolicy: 'expire', suppression: { sources: [] },
    })
    const active = {
      ...activeMap,
      encounterState: parseEncounterState({ ...encounter, effects: [sprintEffect] }),
    }
    const sprint = resolve(active, 6)
    expect(sprint).toMatchObject({
      ok: true, capabilityLimit: 6, effectiveLimit: 6,
      capabilities: { used: [{ key: 'overland', label: 'Overland', speed: 6 }] },
    })
  })

  it('aa069.fade-away.reviewed consumes either durable Shift authority without spending a Shift Action', () => {
    const owned = withMark(mapFixture(), {
      canonicalId: 'Fade Away', abilityInstanceId: 'base:fade-away',
      markId: AA069_FADE_AWAY_SHIFT_MARK, stateId: 'base:fade-away:shift',
    })
    const movement = resolve(owned, 2)
    if (!movement.ok) throw new Error('Expected legal Fade Away movement.')
    const planned = planAuthoritativeMovementResources({
      map: owned, movement, sourceOperationId: 'op_fade_owned_shift',
    })
    expect(planned.currentEncounterState.turnResources.actor?.actions.shift.spent).toBe(0)
    expect(planned.currentEncounterState.turnResources.actor?.movement.spent).toBe(2)
    expect(planned.currentEncounterState.abilityOwnedState?.entries).toHaveLength(0)

    const base = mapFixture()
    const encounter = parseEncounterState(base.encounterState)
    const effect = parseEncounterEffect({
      id: 'effect.fade-away.shift', kind: 'capability',
      source: { operationId: 'op_fade_effect', moveId: 'ability.fade-away', placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
      stacks: 1, charges: 1,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['ability', 'fade-away'],
      payload: { capabilityId: AA069_FADE_AWAY_SHIFT_MARK, action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['fade-away'] },
      transferPolicy: 'expire', suppression: { sources: [] },
    })
    const effectMap = {
      ...base,
      encounterState: parseEncounterState({ ...encounter, effects: [effect] }),
    }
    const effectMovement = resolve(effectMap, 2)
    if (!effectMovement.ok) throw new Error('Expected legal triggered Fade Away movement.')
    const effectPlanned = planAuthoritativeMovementResources({
      map: effectMap, movement: effectMovement, sourceOperationId: 'op_fade_effect_shift',
    })
    expect(effectPlanned.currentEncounterState.turnResources.actor?.actions.shift.spent).toBe(0)
    expect(effectPlanned.currentEncounterState.effects).toHaveLength(0)
  })
})
