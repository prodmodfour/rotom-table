import { describe, expect, it } from 'vitest'
import { parseExecuteCapabilityActionCommand, type CapabilityServerRoll } from '#shared/capabilityAutomation/clientCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEmptyCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import { createCapabilityLifecycleHandler } from '../../server/domain/moveAutomation/capabilityLifecycle'
import { applyAuthoritativeMovementMapTransition } from '../../server/domain/movement/applyMovementTransition'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const actorPlacement: SheetPlacement = {
  id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 2, y: 1, z: 2 },
}
const actorSheet: CharacterSheet = {
  slug: 'actor-sheet', nickname: 'Actor', species: 'Shuckle', level: 30, revision: 1,
  items: { held: 'Oran Berry' },
}
const trainer: TrainerSheet = {
  slug: 'trainer', name: 'Trainer', level: 10, currentTeam: [actorSheet.slug],
  inventory: { keyItems: [{ id: 'jar', name: 'Collection Jar', qty: 1 }], pokemonItems: [] },
}
const map = (): TabletopMap => ({
  id: 'map', slug: 'capability-map', name: 'Map', schemaVersion: 2, revision: 4, updatedAt: 100,
  dimensions: { x: 10, y: 6, z: 10 }, groundLevelY: 0, placements: [actorPlacement],
  voxels: [
    { x: 3, y: 1, z: 2, materialId: 'grass', blocksMovement: false, tags: [] },
    { x: 1, y: 1, z: 2, materialId: 'grass', blocksMovement: false, tags: ['rough-terrain', 'slow-terrain'] },
  ],
  encounterState: createEmptyEncounterState(),
} as TabletopMap)

const command = (canonicalId: string, actionId: string, selections: Partial<ReturnType<typeof parseExecuteCapabilityActionCommand>['selections']> = {}) => (
  parseExecuteCapabilityActionCommand({
    schemaVersion: 1, operationId: `operation-${actionId}`, mapSlug: 'capability-map', baseRevision: 4,
    offerId: `offer-${actionId}`, actorPlacementId: actorPlacement.id,
    capabilityInstanceId: `capability:actor:${canonicalId.replaceAll(' ', '_')}:base`, canonicalId, actionId,
    selections: {
      targetPlacementIds: [], cells: [], optionId: null, recipientTrainerSlug: null,
      canonicalItemId: null, description: null, gmConfirmed: false, ...selections,
    },
  })
)
const rollDie = (rollId: string, sides: number, count = 1): CapabilityServerRoll => ({
  rollId: `roll-${rollId}`, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => sides),
  modifier: 0, total: sides * count,
})
const execute = (
  canonicalId: string,
  actionId: string,
  selections: Parameters<typeof command>[2] = {},
  sourceMap = map(),
  authoritativeRollDie: typeof rollDie = rollDie,
  now = 1_000,
) => {
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId).spec.actions.find(entry => entry.actionId === actionId)!
  return executeCapabilityMechanic({
    map: sourceMap, actorPlacement, actorSheet,
    pokemonSheets: new Map([[actorSheet.slug, actorSheet]]), trainerSheets: new Map([[trainer.slug, trainer]]),
    linkedTrainerSlugs: new Set([trainer.slug]), command: command(canonicalId, actionId, selections), action,
    now, rollDie: authoritativeRollDie,
  })
}

describe('native Capability mechanics', () => {
  it('applies independent Groundshaper choices to exact authoritative cardinal cells', () => {
    const result = execute('Groundshaper', 'shape-ground', {
      cells: [{ x: 3, y: 1, z: 2 }, { x: 1, y: 1, z: 2 }],
      optionId: 'per-cell:3,1,2=rough-and-slow;1,1,2=basic',
    })
    expect(result.map.voxels.find(voxel => voxel.x === 3)?.tags).toEqual(expect.arrayContaining(['rough-terrain', 'slow-terrain']))
    expect(result.map.voxels.find(voxel => voxel.x === 1)?.tags).toContain('basic-terrain')
    expect(() => execute('Groundshaper', 'shape-ground', {
      cells: [{ x: 4, y: 1, z: 2 }], optionId: 'rough',
    })).toThrow(/cardinally adjacent|authoritative terrain/i)
  })

  it('retains strict mode identity and branch parameters and removes them reversibly', () => {
    const invisible = execute('Invisibility', 'become-invisible')
    expect(invisible.map.encounterState?.capabilityRuntime?.modes[0]).toMatchObject({
      actorPlacementId: 'actor', mode: 'invisible', expiresAt: 241_000, configurationId: null,
    })
    const visible = execute('Invisibility', 'become-visible', {}, invisible.map)
    expect(visible.map.encounterState?.capabilityRuntime?.modes).toHaveLength(0)

    const shape = execute('Shapeshifter', 'change-shape', {
      optionId: 'mass-percent:125;kind:organic', description: 'A compact quadruped shape',
    })
    expect(shape.map.encounterState?.capabilityRuntime?.modes[0]).toMatchObject({
      mode: 'shapechanged', configurationId: 'mass-percent:125;kind:organic', description: 'A compact quadruped shape',
    })
  })

  it('projects Glow as a body-emitted map light through movement and source-owned dismissal', () => {
    const glowing = execute('Glow', 'emit-light')
    expect(glowing.map.lights).toEqual([{
      id: 'capability.glow:actor',
      kind: 'emissive',
      position: actorPlacement.position,
    }])

    const moved = applyAuthoritativeMovementMapTransition({
      map: glowing.map,
      placementId: actorPlacement.id,
      destination: { x: 4, y: 1, z: 2 },
      distance: 2,
      encounterState: glowing.map.encounterState!,
      timestamp: 2_000,
      userName: 'Actor',
    }).nextMap
    expect(moved.lights?.[0]?.position).toEqual({ x: 4, y: 1, z: 2 })

    const stopped = execute('Glow', 'stop-light', {}, moved)
    expect(stopped.map.lights).toEqual([])
    expect(stopped.map.encounterState?.capabilityRuntime?.modes).toEqual([])
  })

  it('separates a released linked participant into an adjacent legal cell', () => {
    const initialMap = map()
    const carried: SheetPlacement = {
      id: 'carried', sheetKind: 'trainer', sheetSlug: trainer.slug, position: { ...actorPlacement.position },
    }
    const capabilityInstanceId = 'capability:actor:As_One:base'
    const sourceMap: TabletopMap = {
      ...initialMap,
      placements: [...initialMap.placements, carried],
      encounterState: {
      ...initialMap.encounterState!,
      capabilityRuntime: {
        ...createEmptyCapabilityRuntimeState(),
        links: [{
          id: 'link', kind: 'as-one-mount', ownerPlacementId: actorPlacement.id,
          participantPlacementIds: [carried.id], capabilityInstanceId, canonicalId: 'As One',
          establishedAt: 10, configurationId: 'Run Away', sourceOperationId: 'mount-operation',
        }],
      },
      },
    }
    const result = execute('As One', 'dismount', {
      cells: [{ x: 3, y: 1, z: 2 }],
    }, sourceMap)
    expect(result.map.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(result.map.placements.find(placement => placement.id === carried.id)?.position).toEqual({ x: 3, y: 1, z: 2 })
  })

  it('resolves a retained close Shapeshifter examination as an opposed private check', () => {
    const changed = execute('Shapeshifter', 'change-shape', {
      optionId: 'mass-percent:100;kind:organic', description: 'A plain stone',
    })
    const examiner: SheetPlacement = {
      id: 'examiner', sheetKind: 'trainer', sheetSlug: trainer.slug, position: { x: 3, y: 1, z: 2 },
    }
    const examinationMap: TabletopMap = {
      ...changed.map,
      placements: [...changed.map.placements, examiner],
      metadata: {
        ...(changed.map.metadata ?? {}),
        capabilityCloseExaminations: [{
          subjectPlacementId: actorPlacement.id, examinerPlacementId: examiner.id, expiresAt: 10_000,
        }],
      },
    }
    const result = execute('Shapeshifter', 'oppose-examination', {
      targetPlacementIds: [examiner.id],
    }, examinationMap)
    expect(result.rolls).toHaveLength(2)
    expect(['capability.shapeshifter.revealed', 'capability.shapeshifter.concealed'])
      .toContain(result.reasonCode)
    expect(result.map.metadata?.capabilityPrivateNotices).toContainEqual(expect.objectContaining({
      canonicalId: 'Shapeshifter', revealToPlacementIds: [actorPlacement.id, examiner.id],
    }))
    expect(result.map.metadata?.capabilityCloseExaminations).toEqual([])
  })

  it('repositions a moving Illusion while retaining its source-owned authority', () => {
    const created = execute('Illusionist', 'create-illusion', {
      cells: [{ x: 3, y: 1, z: 2 }],
      optionId: 'size-mm:500x500x500;motion:minor',
      description: 'A dancing flame',
    })
    const moved = execute('Illusionist', 'reposition-illusion', {
      cells: [{ x: 4, y: 1, z: 2 }],
    }, created.map)
    expect(moved.reasonCode).toBe('capability.illusion.repositioned')
    expect(moved.map.metadata?.capabilityIllusions).toContainEqual(expect.objectContaining({
      ownerPlacementId: actorPlacement.id,
      position: { x: 4, y: 1, z: 2 },
      lastCapabilityOperationId: 'operation-reposition-illusion',
    }))
  })

  it('emits Phasing HP loss from the authoritative round lifecycle', () => {
    const phased = execute('Phasing', 'become-intangible')
    const effect = phased.map.encounterState!.effects[0]!
    const handler = createCapabilityLifecycleHandler(new Set([effect.id]))
    const triggers = handler.resolve({
      state: phased.map.encounterState!,
      event: {
        schemaVersion: 1, eventId: 'event-round-end', kind: 'round-end', sourceOperationId: 'initiative-operation',
        causalParentEventId: null, reasonCode: 'initiative.round-end', round: 1,
      },
      random: { roll: () => { throw new Error('Phasing tick does not roll.') } },
    } as Parameters<typeof handler.resolve>[0])
    expect(triggers).toHaveLength(1)
    expect(triggers[0]!.operations[0]).toMatchObject({
      kind: 'direct-hp', reasonCode: 'capability.phasing.round-end-tick',
      payload: { mode: 'lose', calculation: { kind: 'percent-max', percent: 10 }, bounds: { minimum: 1 } },
    })
  })

  it('emits Bleed! Tick loss only at the affected target’s next turn starts', () => {
    const encounter = createEmptyEncounterState()
    const effect = {
      id: 'effect.capability-weapon.bleed.target',
      kind: 'capability' as const,
      source: { moveId: 'move.bleed', operationId: 'bleed.bleed-three-turns', placementId: actorPlacement.id },
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      duration: { kind: 'turns' as const, subject: 'target' as const, boundary: 'start' as const, remaining: 3 },
      stacks: 1,
      charges: 3,
      suppression: { sources: [] },
      tags: ['capability-weapon-move', 'bleed', 'start-turn-tick'],
      payload: { capabilityId: 'weapon-move-bleed', action: 'grant' as const },
      dispel: { policy: 'matching-tags' as const, tags: ['capability-weapon-move', 'bleed'] },
      transferPolicy: 'expire' as const,
      createdRound: 1,
      sourceOperationId: 'operation:bleed',
    }
    const handler = createCapabilityLifecycleHandler(new Set())
    const trigger = (placementId: string) => handler.resolve({
      state: { ...encounter, effects: [effect] },
      event: {
        schemaVersion: 1, eventId: `event-turn-start-${placementId}`, kind: 'turn-start',
        sourceOperationId: 'initiative-operation', causalParentEventId: null,
        reasonCode: 'initiative.turn-start', round: 2, turn: 1, placementId,
      },
      random: { roll: () => { throw new Error('Bleed tick does not roll.') } },
    } as Parameters<typeof handler.resolve>[0])
    expect(trigger('other')).toEqual([])
    expect(trigger('target')[0]?.operations[0]).toMatchObject({
      kind: 'direct-hp',
      reasonCode: 'capability.weapon-move.bleed-start-turn-tick',
      payload: { calculation: { kind: 'percent-max', percent: 10 }, bounds: { minimum: 1 } },
    })
  })

  it('does not expose a manual Juicer conversion action', () => {
    const juicer = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Juicer')
    expect(juicer.spec.actions.find(action => action.actionId === 'consume-juicer-shell-juice-as-snack')?.itemOutputs).toEqual([])
    expect(juicer.spec.actions.find(action => action.actionId === 'collect-juicer-output')?.itemOutputs)
      .toEqual(['Shuckle’s Berry Juice', 'Rare Candy'])
    const actions = juicer.spec.actions.map(action => action.actionId)
    expect(actions).toEqual(expect.arrayContaining([
      'consume-juicer-shell-juice-as-snack', 'collect-juicer-output',
    ]))
    expect(actions).not.toContain('store-berry')
  })

  it('persists Alluring lure progress across exact 15-minute boundaries, abandonment, and success', () => {
    const start = execute('Alluring', 'lure-with-alluring', {
      cells: [{ x: 4, y: 1, z: 4 }],
      optionId: 'species:Pidgey;level:20',
      gmConfirmed: true,
    })
    expect(start).toMatchObject({
      rolls: [], outcome: 'applied', reasonCode: 'capability.alluring.lure-started',
    })
    expect(start.map.encounterState?.capabilityRuntime?.tasks).toContainEqual(expect.objectContaining({
      kind: 'alluring-lure', failedChecks: 0, startedAt: 1_000, completesAt: 901_000,
      encounterSpecies: 'Pidgey', encounterLevel: 20,
    }))

    const failedRoll: typeof rollDie = rollId => ({
      rollId: `roll-${rollId}`, expression: '1d20', dice: [14], modifier: 0, total: 14,
    })
    expect(() => execute(
      'Alluring', 'resolve-alluring-lure-check', {}, start.map, failedRoll, 900_999,
    )).toThrow(/not due/)
    const firstFailure = execute(
      'Alluring', 'resolve-alluring-lure-check', {}, start.map, failedRoll, 901_000,
    )
    expect(firstFailure).toMatchObject({
      outcome: 'applied', reasonCode: 'capability.alluring.lure-check-failed',
      rolls: [expect.objectContaining({ total: 14 })],
    })
    expect(firstFailure.map.encounterState?.capabilityRuntime?.tasks[0]).toMatchObject({
      failedChecks: 1, completesAt: 1_801_000,
    })

    const abandoned = execute(
      'Alluring', 'abandon-alluring-lure', {}, firstFailure.map, rollDie, 1_100_000,
    )
    expect(abandoned.reasonCode).toBe('capability.alluring.lure-abandoned')
    expect(abandoned.map.encounterState?.capabilityRuntime?.tasks).toEqual([])

    const restarted = execute('Alluring', 'lure-with-alluring', {
      cells: [{ x: 4, y: 1, z: 4 }],
      optionId: 'species:Pidgey;level:20',
      gmConfirmed: true,
    }, map(), rollDie, 2_000_000)
    let attempt = 0
    const succeedsSecond: typeof rollDie = rollId => {
      attempt += 1
      const total = attempt === 1 ? 14 : 15
      return { rollId: `roll-${rollId}`, expression: '1d20', dice: [total], modifier: 0, total }
    }
    const succeeded = execute(
      'Alluring', 'resolve-alluring-lure-check', {}, restarted.map, succeedsSecond, 3_800_000,
    )
    expect(succeeded.rolls.map(roll => roll.total)).toEqual([14, 15])
    expect(succeeded).toMatchObject({
      outcome: 'applied', reasonCode: 'capability.roll-resolved',
      adjudicationNote: expect.stringContaining('separately timed check 2'),
    })
    expect(succeeded.map.encounterState?.capabilityRuntime?.tasks).toEqual([])
    expect(succeeded.map.placements).toContainEqual(expect.objectContaining({
      sheetKind: 'pokemon', position: { x: 4, y: 1, z: 4 },
    }))
    expect(succeeded.produced).toEqual([expect.objectContaining({
      kind: 'summoned-creature', canonicalId: 'Pidgey', quantity: 1,
    })])
  })

  it('expires Alluring only after three elapsed failed checks and movement interrupts the lure', () => {
    const failedRoll: typeof rollDie = rollId => ({
      rollId: `roll-${rollId}`, expression: '1d20', dice: [1], modifier: 0, total: 1,
    })
    const start = execute('Alluring', 'lure-with-alluring', {
      cells: [{ x: 4, y: 1, z: 4 }], optionId: 'species:Pidgey;level:20', gmConfirmed: true,
    })
    const expired = execute(
      'Alluring', 'resolve-alluring-lure-check', {}, start.map, failedRoll, 2_701_000,
    )
    expect(expired.rolls.map(roll => roll.total)).toEqual([1, 1, 1])
    expect(expired).toMatchObject({
      outcome: 'no-op', reasonCode: 'capability.alluring.lure-expired',
      adjudicationNote: expect.stringContaining('separately timed'),
    })
    expect(expired.map.encounterState?.capabilityRuntime?.tasks).toEqual([])

    const moved = applyAuthoritativeMovementMapTransition({
      map: start.map,
      placementId: actorPlacement.id,
      destination: { x: 3, y: 1, z: 2 },
      distance: 1,
      encounterState: start.map.encounterState!,
      timestamp: 2_000,
      userName: 'Actor',
    }).nextMap
    expect(moved.encounterState?.capabilityRuntime?.tasks).toEqual([])
  })

  it('uses server rolls for the full Mushroom table and commits the output to linked inventory', () => {
    const result = execute('Mushroom Harvest', 'harvest-mushroom', { recipientTrainerSlug: trainer.slug })
    expect(result.rolls[0]).toMatchObject({ expression: '1d20', total: 20 })
    expect(result.produced).toEqual([{ kind: 'item', canonicalId: 'Balm Mushroom', quantity: 1, recipientSheetSlug: trainer.slug }])
    expect((result.sheetMutations[0]!.current as TrainerSheet).inventory?.pokemonItems).toContainEqual(expect.objectContaining({ name: 'Balm Mushroom', qty: 1 }))
  })

  it('persists accepted bounded world changes rather than returning a manual instruction', () => {
    const sourceMap = {
      ...map(),
      metadata: {
        capabilityObjects: [{ id: 'iron-latch', material: 'metal', position: { x: 2, y: 1, z: 2 }, weightClass: 1 }],
      },
    }
    const result = execute('Magnetic', 'manipulate-metal', {
      cells: [{ x: 3, y: 1, z: 2 }], optionId: 'objects:iron-latch',
      description: 'Pull the iron latch open', gmConfirmed: true,
    }, sourceMap)
    expect(result.map.metadata?.capabilityWorldChanges).toContainEqual(expect.objectContaining({
      canonicalId: 'Magnetic', actionId: 'manipulate-metal', description: 'Pull the iron latch open',
    }))
    expect(result.reasonCode).toBe('capability.bounded-adjudication-accepted')
  })
})
