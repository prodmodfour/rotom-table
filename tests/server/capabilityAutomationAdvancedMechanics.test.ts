import { describe, expect, it } from 'vitest'
import { parseExecuteCapabilityActionCommand, type CapabilityServerRoll } from '#shared/capabilityAutomation/clientCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { removeCapabilityPresenceGroup } from '../../server/domain/capabilityAutomation/presenceLifecycle'
import { rebindZygardeAssemblyOnPresence } from '../../server/domain/capabilityAutomation/zygardeAssembly'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import { validateCapabilityActionSelections } from '../../server/domain/capabilityAutomation/validateSelections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const rollDie = (rollId: string, sides: number, count = 1): CapabilityServerRoll => ({
  rollId, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => sides),
  modifier: 0, total: sides * count,
})
const baseMap = (placements: SheetPlacement[]): TabletopMap => ({
  schemaVersion: 2, id: 'map', slug: 'arena', name: 'Arena', revision: 1, updatedAt: 100,
  dimensions: { x: 12, y: 6, z: 12 }, groundLevelY: 0, voxels: [], placements,
  encounterState: createEmptyEncounterState(),
} as TabletopMap)
const selections = (overrides: Record<string, unknown> = {}) => ({
  targetPlacementIds: [], cells: [], optionId: null, recipientTrainerSlug: null,
  canonicalItemId: null, description: null, gmConfirmed: true, ...overrides,
})
const commandFor = (input: {
  canonicalId: string
  actionId: string
  map: TabletopMap
  actor: SheetPlacement
  selections?: Record<string, unknown>
  capabilityInstanceId?: string
}) => parseExecuteCapabilityActionCommand({
  schemaVersion: 1, operationId: `operation-${input.actionId}`, mapSlug: input.map.slug,
  baseRevision: input.map.revision ?? 0, offerId: 'offer', actorPlacementId: input.actor.id,
  capabilityInstanceId: input.capabilityInstanceId
    ?? `capability:${input.actor.id}:${input.canonicalId.replaceAll(' ', '_')}:base`,
  canonicalId: input.canonicalId, actionId: input.actionId,
  selections: selections(input.selections),
})

const run = (input: {
  canonicalId: string
  actionId: string
  map: TabletopMap
  actor: SheetPlacement
  sheets: readonly CharacterSheet[]
  trainers?: readonly TrainerSheet[]
  linkedTrainerSlugs?: readonly string[]
  selections?: Record<string, unknown>
  capabilityInstanceId?: string
  rollDie?: (rollId: string, sides: number, count?: number) => CapabilityServerRoll
}) => {
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(input.canonicalId).spec.actions
    .find(candidate => candidate.actionId === input.actionId)!
  const command = commandFor(input)
  const bySlug = new Map(input.sheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map((input.trainers ?? []).map(sheet => [sheet.slug, sheet]))
  return executeCapabilityMechanic({
    map: input.map, actorPlacement: input.actor, actorSheet: bySlug.get(input.actor.sheetSlug)!,
    pokemonSheets: bySlug, trainerSheets: trainerBySlug,
    linkedTrainerSlugs: new Set(input.linkedTrainerSlugs ?? []),
    command, action, now: 1_000, rollDie: input.rollDie ?? rollDie,
  })
}

const validateAction = (input: {
  canonicalId: string
  actionId: string
  map: TabletopMap
  actor: SheetPlacement
  sheets: readonly CharacterSheet[]
  trainers?: readonly TrainerSheet[]
  selections?: Record<string, unknown>
  capabilityInstanceId?: string
}): void => {
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(input.canonicalId).spec.actions
    .find(candidate => candidate.actionId === input.actionId)!
  const pokemonSheets = new Map(input.sheets.map(sheet => [sheet.slug, sheet]))
  const trainerSheets = new Map((input.trainers ?? []).map(sheet => [sheet.slug, sheet]))
  validateCapabilityActionSelections({
    map: input.map,
    actor: input.actor,
    actorSheet: input.actor.sheetKind === 'pokemon'
      ? pokemonSheets.get(input.actor.sheetSlug)!
      : trainerSheets.get(input.actor.sheetSlug)!,
    pokemonSheets,
    trainerSheets,
    command: commandFor(input),
    action,
    now: 1_000,
  })
}

describe('advanced Capability mechanics', () => {
  it('moves bounded world objects with Telekinetic Focus Power and retains drag residue', () => {
    const actor: SheetPlacement = { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 1, z: 1 } }
    const sheet: CharacterSheet = {
      slug: 'actor', nickname: 'Psychic', species: 'Abra', level: 20,
      skills: { focus: '2d6' }, capabilities: { other: ['Telekinetic'] },
    }
    const map = {
      ...baseMap([actor]),
      metadata: { capabilityObjects: [{ id: 'crate', position: { x: 2, y: 1, z: 1 }, pounds: 100, material: 'wood' }] },
    }
    const result = run({
      canonicalId: 'Telekinetic', actionId: 'manipulate-object', actor,
      map, sheets: [sheet], selections: { optionId: 'objects:crate', cells: [{ x: 4, y: 1, z: 1 }] },
    })
    expect(result.map.metadata?.capabilityObjects).toContainEqual(expect.objectContaining({
      id: 'crate', position: { x: 4, y: 1, z: 1 }, lastCapabilityOperationId: 'operation-manipulate-object',
    }))
    expect(result.map.metadata?.capabilityPsychicResidue).toContainEqual(expect.objectContaining({ kind: 'telekinetic-drag' }))
  })

  it('rejects independent Telekinetic and Threaded movement of attached physical load objects', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: 'actor', nickname: 'Manipulator', species: 'Spinarak', level: 20,
      skills: { focus: '3d6' }, capabilities: { other: ['Telekinetic', 'Threaded'] },
    }
    const map = {
      ...baseMap([actor]),
      metadata: { capabilityObjects: [{
        id: 'crate', pounds: 45, position: actor.position,
        attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
        attachedCapabilityInstanceId: 'capability:actor:Power:value-4', attachedToPlacementId: actor.id,
        physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
        physicalLoadLastCheckRound: null,
      }] },
    } as TabletopMap
    expect(() => validateAction({
      canonicalId: 'Telekinetic', actionId: 'manipulate-object', actor, map, sheets: [sheet],
      selections: { optionId: 'objects:crate', cells: [{ x: 2, y: 0, z: 1 }] },
    })).toThrow(/cannot move an object attached/i)
    expect(() => validateAction({
      canonicalId: 'Threaded', actionId: 'threaded-shift', actor, map, sheets: [sheet],
      selections: { optionId: 'object', canonicalItemId: 'crate', cells: [actor.position] },
    })).toThrow(/cannot independently move an object attached/i)
  })

  it('attaches and releases exact Power loads while rejecting the printed Drag Weight boundary', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 1, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: 'actor', nickname: 'Lifter', species: 'Machop', level: 20,
      skills: { athletics: '3d6' }, capabilities: { power: 4 },
    }
    const capabilityInstanceId = 'capability:actor:Power:value-4'
    const map = {
      ...baseMap([actor]),
      initiative: { activeId: 'actor', round: 2, manualOrderIds: ['actor'] },
      metadata: {
        capabilityObjects: [
          { id: 'crate', position: { x: 2, y: 1, z: 1 }, pounds: 45, material: 'wood' },
          { id: 'anvil', position: { x: 1, y: 1, z: 2 }, pounds: 280, material: 'iron' },
        ],
      },
    } as TabletopMap
    validateAction({
      canonicalId: 'Power', actionId: 'lift-load', actor, map, sheets: [sheet],
      capabilityInstanceId, selections: { optionId: 'objects:crate' },
    })
    const lifted = run({
      canonicalId: 'Power', actionId: 'lift-load', actor, map, sheets: [sheet],
      capabilityInstanceId, selections: { optionId: 'objects:crate' },
    })
    expect(lifted.reasonCode).toBe('capability.power.heavy-load-attached')
    expect(lifted.map.metadata?.capabilityObjects).toContainEqual(expect.objectContaining({
      id: 'crate',
      attachmentKind: 'physical-power-load',
      attachedToPlacementId: 'actor',
      attachedCapabilityInstanceId: capabilityInstanceId,
      position: actor.position,
    }))

    expect(() => validateAction({
      canonicalId: 'Power', actionId: 'lift-load', actor, map, sheets: [sheet],
      capabilityInstanceId, selections: { optionId: 'objects:anvil' },
    })).toThrow(/strictly lighter than the printed Drag Weight limit/i)

    validateAction({
      canonicalId: 'Power', actionId: 'release-load', actor, map: lifted.map, sheets: [sheet],
      capabilityInstanceId,
    })
    const released = run({
      canonicalId: 'Power', actionId: 'release-load', actor, map: lifted.map, sheets: [sheet],
      capabilityInstanceId,
    })
    expect(released.reasonCode).toBe('capability.power.load-released')
    expect(released.map.metadata?.capabilityObjects).toContainEqual(expect.objectContaining({ id: 'crate' }))
    expect((released.map.metadata?.capabilityObjects?.[0] as Record<string, unknown>).attachmentKind).toBeUndefined()
  })

  it('uses the current exact-source physical form footprint for Power adjacency', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: 'actor', nickname: 'Inflated Lifter', species: 'Machop', level: 20,
      capabilities: { power: 4, other: ['Inflatable'] },
    }
    const encounter = createEmptyEncounterState()
    const map = {
      ...baseMap([actor]),
      initiative: { activeId: 'actor', round: 1, manualOrderIds: ['actor'] },
      metadata: { capabilityObjects: [{ id: 'crate', position: { x: 3, y: 0, z: 1 }, pounds: 45 }] },
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'inflated-mode', actorPlacementId: actor.id,
            capabilityInstanceId: 'capability:actor:Inflatable:base', canonicalId: 'Inflatable',
            mode: 'inflated', description: null, configurationId: null,
            activatedAt: 100, expiresAt: null, sourceOperationId: 'inflate-operation',
          }],
        },
      },
    } as TabletopMap
    expect(() => validateAction({
      canonicalId: 'Power', actionId: 'lift-load', actor, map, sheets: [sheet],
      capabilityInstanceId: 'capability:actor:Power:value-4',
      selections: { optionId: 'objects:crate' },
    })).not.toThrow()
  })

  it('rolls Athletics before attaching Staggering Weight and leaves the load behind on failure', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 1, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: 'actor', nickname: 'Lifter', species: 'Machop', level: 20,
      skills: { athletics: '1d6' }, capabilities: { power: 4 },
    }
    const map = {
      ...baseMap([actor]),
      initiative: { activeId: 'actor', round: 1, manualOrderIds: ['actor'] },
      metadata: { capabilityObjects: [{ id: 'crate', position: { x: 2, y: 1, z: 1 }, pounds: 71 }] },
    } as TabletopMap
    const failed = run({
      canonicalId: 'Power', actionId: 'lift-load', actor, map, sheets: [sheet],
      capabilityInstanceId: 'capability:actor:Power:value-4',
      selections: { optionId: 'objects:crate' },
      rollDie: (rollId, sides, count = 1) => ({
        rollId, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => 1),
        modifier: 0, total: count,
      }),
    })
    expect(failed.reasonCode).toBe('capability.power.staggering-check-failed')
    expect(failed.rolls[0]?.total).toBe(1)
    expect(failed.map.metadata?.capabilityObjects).toContainEqual(expect.objectContaining({
      id: 'crate', position: { x: 2, y: 1, z: 1 },
    }))
    expect((failed.map.metadata?.capabilityObjects?.[0] as Record<string, unknown>).attachmentKind).toBeUndefined()
  })

  it('limits self-pulling Threaded movement by the actor’s exact physical Power load', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const threader: CharacterSheet = {
      slug: 'actor', nickname: 'Threader', species: 'Spinarak', level: 20,
      capabilities: { power: 4, other: ['Threaded'] },
    }
    const map = {
      ...baseMap([actor]),
      initiative: { activeId: 'actor', round: 2, manualOrderIds: ['actor'] },
      metadata: { capabilityObjects: [{
        id: 'crate', pounds: 71, position: actor.position,
        attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
        attachedCapabilityInstanceId: 'capability:actor:Power:value-4', attachedToPlacementId: 'actor',
        physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
        physicalLoadLastCheckRound: 2,
      }] },
    } as TabletopMap
    const result = run({
      canonicalId: 'Threaded', actionId: 'threaded-shift', actor, map, sheets: [threader],
      selections: { optionId: 'anchor', cells: [{ x: 5, y: 0, z: 1 }] },
    })
    expect(result.reasonCode).toBe('capability.threaded.shift-applied')
    expect(result.map.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(result.map.metadata?.capabilityObjects).toContainEqual(expect.objectContaining({
      id: 'crate', position: { x: 2, y: 0, z: 1 }, physicalLoadLastMovedRound: 2,
    }))
  })

  it('resolves Telekinetic maneuver Accuracy before opposed Focus and drops disarmed items on the map', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 },
    }
    const psychic: CharacterSheet = {
      slug: 'actor', nickname: 'Psychic', species: 'Abra', level: 20,
      skills: { focus: '6d6' }, capabilities: { other: ['Telekinetic'] },
    }
    const defender: CharacterSheet = {
      slug: 'target', nickname: 'Defender', species: 'Charmander', level: 5,
      skills: { combat: '1d6', stealth: '1d6' }, items: { held: 'Potion' },
    }
    const result = run({
      canonicalId: 'Telekinetic', actionId: 'telekinetic-maneuver', actor,
      map: baseMap([actor, target]), sheets: [psychic, defender],
      selections: { targetPlacementIds: ['target'], optionId: 'disarm' },
    })
    expect(result.reasonCode).toBe('capability.telekinetic.disarm-applied')
    expect(result.rolls).toHaveLength(3)
    expect((result.sheetMutations[0]?.current as CharacterSheet).items?.held).toBe('')
    expect(result.map.encounterState?.groundItems).toContainEqual(expect.objectContaining({
      canonicalItemName: 'Potion', quantity: 1, position: target.position,
    }))
  })

  it('honors natural-1 automatic misses for Capability-authored Accuracy Checks', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 },
    }
    const naturalOne = (rollId: string, sides: number, count = 1): CapabilityServerRoll => ({
      rollId, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => 1),
      modifier: 0, total: count,
    })
    const telekinetic: CharacterSheet = {
      slug: 'actor', nickname: 'Psychic', species: 'Abra', level: 20,
      skills: { focus: '6d6' }, combatStages: { acc: 6 }, capabilities: { other: ['Telekinetic'] },
    }
    const defender: CharacterSheet = {
      slug: 'target', nickname: 'Defender', species: 'Charmander', level: 5,
      skills: { combat: '1d6', stealth: '1d6' }, items: { held: 'Potion' },
    }
    const telekineticResult = run({
      canonicalId: 'Telekinetic', actionId: 'telekinetic-maneuver', actor,
      map: baseMap([actor, target]), sheets: [telekinetic, defender], rollDie: naturalOne,
      selections: { targetPlacementIds: ['target'], optionId: 'disarm' },
    })
    expect(telekineticResult.reasonCode).toBe('capability.telekinetic.maneuver-accuracy-missed')
    expect(telekineticResult.rolls).toHaveLength(1)

    const threader: CharacterSheet = {
      ...telekinetic, nickname: 'Threader', species: 'Spinarak',
      capabilities: { other: ['Threaded'] },
    }
    const threadedResult = run({
      canonicalId: 'Threaded', actionId: 'threaded-shift', actor,
      map: baseMap([actor, target]), sheets: [threader, defender], rollDie: naturalOne,
      selections: { targetPlacementIds: ['target'], optionId: 'unwilling-target' },
    })
    expect(threadedResult.reasonCode).toBe('capability.threaded.accuracy-missed')
    expect(threadedResult.rolls).toHaveLength(1)
  })

  it.each([
    ['Telekinetic', 'telekinetic-maneuver', 'disarm'],
    ['Threaded', 'threaded-shift', 'unwilling-target'],
  ] as const)('applies Heavy Weight to %s Capability-authored Accuracy', (canonicalId, actionId, optionId) => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 },
    }
    const attacker: CharacterSheet = {
      slug: 'actor', nickname: 'Attacker', species: canonicalId === 'Telekinetic' ? 'Abra' : 'Spinarak', level: 20,
      skills: { focus: '4d6' }, capabilities: { power: 4, other: [canonicalId] },
    }
    const defender: CharacterSheet = {
      slug: 'target', nickname: 'Target', species: 'Pichu', level: 5,
      skills: { combat: '1d6', stealth: '1d6' }, items: { held: 'Potion' },
    }
    const arena = baseMap([actor, target])
    const selections = { targetPlacementIds: ['target'], optionId }
    const unloaded = run({ canonicalId, actionId, actor, map: arena, sheets: [attacker, defender], selections })
    const loaded = run({
      canonicalId, actionId, actor,
      map: {
        ...arena,
        metadata: { capabilityObjects: [{
          id: 'crate', pounds: 45, position: actor.position,
          attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
          attachedCapabilityInstanceId: 'capability:actor:Power:value-4', attachedToPlacementId: 'actor',
          physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
          physicalLoadLastCheckRound: null,
        }] },
      },
      sheets: [attacker, defender], selections,
    })
    expect(loaded.rolls[0]?.modifier).toBe((unloaded.rolls[0]?.modifier ?? 0) - 2)
  })

  it.each([
    ['Telekinetic', 'telekinetic-maneuver', 'disarm'],
    ['Threaded', 'threaded-shift', 'unwilling-target'],
  ] as const)('prevents %s attacks from targeting an effectively intangible participant', (canonicalId, actionId, optionId) => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 },
    }
    const attacker: CharacterSheet = {
      slug: 'actor', nickname: 'Attacker', species: canonicalId === 'Telekinetic' ? 'Abra' : 'Spinarak', level: 20,
      skills: { focus: '4d6' }, capabilities: { other: [canonicalId] },
    }
    const defender: CharacterSheet = {
      slug: 'target', nickname: 'Ghost', species: 'Gastly', level: 20,
      capabilities: { other: ['Phasing'] },
    }
    const encounter = createEmptyEncounterState()
    const map: TabletopMap = {
      ...baseMap([actor, target]),
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'phasing-mode', actorPlacementId: target.id,
            capabilityInstanceId: 'capability:target:Phasing:base', canonicalId: 'Phasing',
            mode: 'intangible', description: null, configurationId: null,
            activatedAt: 500, expiresAt: null, sourceOperationId: 'operation-phasing',
          }],
        },
      },
    }
    expect(() => validateAction({
      canonicalId, actionId, actor, map, sheets: [attacker, defender],
      selections: { targetPlacementIds: [target.id], optionId },
    })).toThrow(/Intangible targets cannot be targeted/i)
  })

  it('allows Pokémon Telepaths to project thoughts to ordinary Trainers', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'trainer', sheetKind: 'trainer', sheetSlug: 'trainer', position: { x: 2, y: 0, z: 1 },
    }
    const telepath: CharacterSheet = {
      slug: 'actor', nickname: 'Telepath', species: 'Abra', level: 20,
      skills: { focus: '2d6' }, capabilities: { other: ['Telepath'] },
    }
    const trainer: TrainerSheet = { slug: 'trainer', name: 'Trainer', level: 10 }
    expect(() => validateAction({
      canonicalId: 'Telepath', actionId: 'project-thought', actor,
      map: baseMap([actor, target]), sheets: [telepath], trainers: [trainer],
      selections: { targetPlacementIds: [target.id], description: 'A short warning.' },
    })).not.toThrow()
  })

  it('rejects cross-device Wired exits without an exact authoritative network', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const wired: CharacterSheet = {
      slug: 'actor', nickname: 'Wired', species: 'Porygon', level: 20,
      capabilities: { other: ['Wired'] },
    }
    const encounter = createEmptyEncounterState()
    const map: TabletopMap = {
      ...baseMap([actor]),
      metadata: {
        capabilityDevices: [
          { id: 'source', position: { x: 1, y: 0, z: 1 } },
          { id: 'destination', position: { x: 4, y: 0, z: 1 } },
        ],
      },
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'wired-mode', actorPlacementId: actor.id,
            capabilityInstanceId: 'capability:actor:Wired:base', canonicalId: 'Wired',
            mode: 'inside-machine', description: null, configurationId: 'source',
            activatedAt: 500, expiresAt: null, sourceOperationId: 'operation-wired',
          }],
        },
      },
    }
    expect(() => validateAction({
      canonicalId: 'Wired', actionId: 'exit-machine', actor, map, sheets: [wired],
      selections: { optionId: 'destination', cells: [{ x: 4, y: 0, z: 1 }] },
    })).toThrow(/exact authoritative network/i)
    expect(() => validateAction({
      canonicalId: 'Wired', actionId: 'exit-machine', actor, map, sheets: [wired],
      selections: { optionId: 'source', cells: [{ x: 1, y: 0, z: 1 }] },
    })).not.toThrow()
  })

  it('uses exact Trainer weight for Telekinetic Push eligibility', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'trainer', sheetKind: 'trainer', sheetSlug: 'trainer', position: { x: 2, y: 0, z: 1 },
    }
    const telekinetic: CharacterSheet = {
      slug: 'actor', nickname: 'Psychic', species: 'Abra', level: 20,
      skills: { focus: '4d6' }, capabilities: { other: ['Telekinetic'] },
    }
    const trainer: TrainerSheet = {
      slug: 'trainer', name: 'Trainer', level: 10, weight: '70 lbs', skills: { athletics: '1d6', combat: '1d6' },
    }
    expect(() => validateAction({
      canonicalId: 'Telekinetic', actionId: 'telekinetic-maneuver', actor,
      map: baseMap([actor, target]), sheets: [telekinetic], trainers: [trainer],
      selections: { targetPlacementIds: [target.id], optionId: 'push' },
    })).not.toThrow()
  })

  it('rounds half of Focus Rank down to zero for Telekinetic Push', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 },
    }
    const telekinetic: CharacterSheet = {
      slug: 'actor', nickname: 'Psychic', species: 'Abra', level: 20,
      skills: { focus: '1d6+10' }, capabilities: { other: ['Telekinetic'] },
    }
    const defender: CharacterSheet = {
      slug: 'target', nickname: 'Defender', species: 'Charmander', level: 5,
      skills: { combat: '1d6', athletics: '1d6' },
    }
    const result = run({
      canonicalId: 'Telekinetic', actionId: 'telekinetic-maneuver', actor,
      map: baseMap([actor, target]), sheets: [telekinetic, defender],
      selections: { targetPlacementIds: [target.id], optionId: 'push' },
    })
    expect(result.reasonCode).toBe('capability.telekinetic.push-zero-range')
    expect(result.map.placements.find(candidate => candidate.id === target.id)?.position).toEqual(target.position)
  })

  it('compares authoritative object weight and pulls a lighter Threaded object toward the user', () => {
    const actor: SheetPlacement = { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 1, z: 1 } }
    const sheet: CharacterSheet = {
      slug: 'actor', nickname: 'Threader', species: 'Snorlax', level: 20,
      capabilities: { other: ['Threaded'] },
    }
    const map = {
      ...baseMap([actor]),
      metadata: { capabilityObjects: [{ id: 'spool', position: { x: 4, y: 1, z: 1 }, pounds: 10, material: 'wood' }] },
    }
    const result = run({
      canonicalId: 'Threaded', actionId: 'threaded-shift', actor, map, sheets: [sheet],
      selections: {
        optionId: 'object', canonicalItemId: 'spool', cells: [{ x: 4, y: 1, z: 1 }],
      },
    })
    expect(result.reasonCode).toBe('capability.threaded.object-shift-applied')
    expect(result.map.metadata?.capabilityObjects).toContainEqual(expect.objectContaining({
      id: 'spool', position: { x: 3, y: 1, z: 1 },
    }))
    expect(result.map.placements[0]?.position).toEqual(actor.position)
  })

  it('requires the resource-owning Zygarde Cube Trainer for disassembly and form changes', () => {
    const actor: SheetPlacement = {
      id: 'zygarde', sheetKind: 'pokemon', sheetSlug: 'zygarde', position: { x: 1, y: 0, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: 'zygarde', nickname: 'Zygarde', species: 'Zygarde 50% Forme', level: 30,
    }
    const trainer = (slug: string): TrainerSheet => ({
      slug, name: slug, level: 20, currentTeam: [sheet.slug],
      inventory: { keyItems: [{ id: `${slug}-cube`, name: 'Zygarde Cube', qty: 1 }] },
    })
    const owner = trainer('owner')
    const unrelated = trainer('unrelated')
    const map: TabletopMap = {
      ...baseMap([actor]),
      metadata: { capabilityZygardeAssemblies: [{
        actorPlacementId: actor.id, trainerSlug: owner.slug, cellCount: 50,
        form: '50-percent', powerConstruct: false, disassemblable: true,
      }] },
    }
    const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Zygarde Cells').spec.actions
      .find(candidate => candidate.actionId === 'disassemble-zygarde')!
    const commandFor = (recipientTrainerSlug: string) => parseExecuteCapabilityActionCommand({
      schemaVersion: 1, operationId: `operation-disassemble-${recipientTrainerSlug}`,
      mapSlug: map.slug, baseRevision: map.revision ?? 0, offerId: 'offer',
      actorPlacementId: actor.id, capabilityInstanceId: 'capability:zygarde:Zygarde_Cells:base',
      canonicalId: 'Zygarde Cells', actionId: 'disassemble-zygarde',
      selections: selections({ recipientTrainerSlug }),
    })
    const validate = (recipientTrainerSlug: string) => validateCapabilityActionSelections({
      map, actor, actorSheet: sheet, pokemonSheets: new Map([[sheet.slug, sheet]]),
      trainerSheets: new Map([[owner.slug, owner], [unrelated.slug, unrelated]]),
      command: commandFor(recipientTrainerSlug), action, now: 1_000,
    })
    expect(() => validate(unrelated.slug)).toThrow(/Cube owner whose Cell resources formed/i)
    expect(() => validate(owner.slug)).not.toThrow()
  })

  it('disassembles a Cube-created Zygarde into Cells without leaving a duplicate playable creature', () => {
    const actor: SheetPlacement = {
      id: 'zygarde', sheetKind: 'pokemon', sheetSlug: 'zygarde-sheet', position: { x: 1, y: 0, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Zygarde', species: 'Zygarde 50% Forme', level: 30,
      nature: 'Hardy', abilities: [{ name: 'Aura Break' }], capabilities: { other: ['Zygarde Cells'] },
    }
    const trainer: TrainerSheet = {
      slug: 'owner', name: 'Owner', level: 20, currentTeam: [sheet.slug], boxedPokemon: [sheet.slug],
      inventory: { keyItems: [{ id: 'cube', name: 'Zygarde Cube', qty: 1 }] },
    }
    const map: TabletopMap = {
      ...baseMap([actor]),
      metadata: {
        capabilityZygardeCells: [{ trainerSlug: trainer.slug, count: 3 }],
        capabilityZygardeAssemblies: [{
          actorPlacementId: actor.id, actorSheetSlug: sheet.slug, trainerSlug: trainer.slug,
          cellCount: 50, form: '50-percent', powerConstruct: false, disassemblable: true,
          previousSheet: { level: 1, nature: 'Quirky', abilities: [] }, sourceOperationId: 'assembly-operation',
        }],
      },
    }
    const result = run({
      canonicalId: 'Zygarde Cells', actionId: 'disassemble-zygarde', actor, map,
      sheets: [sheet], trainers: [trainer], linkedTrainerSlugs: [trainer.slug],
      selections: { recipientTrainerSlug: trainer.slug },
    })
    expect(result.map.placements).toEqual([])
    expect(result.map.metadata?.capabilityZygardeAssemblies).toEqual([])
    expect(result.map.metadata?.capabilityZygardeCells).toEqual([{ trainerSlug: trainer.slug, count: 53 }])
    const archived = result.sheetMutations.find(mutation => mutation.slug === sheet.slug)!.current as CharacterSheet
    expect(archived.zygardeDisassembledIntoCells).toMatchObject({ trainerSlug: trainer.slug, cellCount: 50 })
    const owner = result.sheetMutations.find(mutation => mutation.slug === trainer.slug)!.current as TrainerSheet
    expect(owner.currentTeam).toEqual([])
    expect(owner.boxedPokemon).toEqual([])
  })

  it('rebinds durable Zygarde assembly Forme authority after recall and a new placement identity', () => {
    const oldPlacement: SheetPlacement = {
      id: 'old-placement', sheetKind: 'pokemon', sheetSlug: 'zygarde-sheet', position: { x: 1, y: 0, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: oldPlacement.sheetSlug, nickname: 'Zygarde', species: 'Zygarde 50% Forme', level: 30,
      capabilities: { other: ['Zygarde Cells'] },
    }
    const encounter = createEmptyEncounterState()
    const map: TabletopMap = {
      ...baseMap([oldPlacement]),
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'old-mode', actorPlacementId: oldPlacement.id,
            capabilityInstanceId: 'capability:old-placement:Zygarde_Cells:base', canonicalId: 'Zygarde Cells',
            mode: 'zygarde-form', description: '50-percent', configurationId: 'power-construct',
            activatedAt: 100, expiresAt: null, sourceOperationId: 'assembly-operation',
          }],
        },
      },
      metadata: { capabilityZygardeAssemblies: [{
        actorPlacementId: oldPlacement.id, trainerSlug: 'owner', cellCount: 100,
        form: '50-percent', powerConstruct: true, disassemblable: false,
        sourceOperationId: 'assembly-operation',
      }] },
    }
    const recalled = removeCapabilityPresenceGroup({ map, ownerPlacementId: oldPlacement.id }).map
    expect(recalled.metadata?.capabilityZygardeAssemblies).toContainEqual(expect.objectContaining({
      actorSheetSlug: sheet.slug,
    }))
    const nextPlacement: SheetPlacement = {
      ...oldPlacement, id: 'new-placement', position: { x: 3, y: 0, z: 3 },
    }
    const presentMap: TabletopMap = { ...recalled, placements: [nextPlacement] }
    const rebound = rebindZygardeAssemblyOnPresence({
      map: presentMap, placement: nextPlacement, sheet,
      pokemonSheets: new Map([[sheet.slug, sheet]]), trainerSheets: new Map(),
      now: 500, operationId: 'send-out-operation',
    })
    expect(rebound.metadata?.capabilityZygardeAssemblies).toContainEqual(expect.objectContaining({
      actorPlacementId: nextPlacement.id, actorSheetSlug: sheet.slug, form: '50-percent',
    }))
    expect(rebound.encounterState?.capabilityRuntime?.modes).toContainEqual(expect.objectContaining({
      actorPlacementId: nextPlacement.id, mode: 'zygarde-form', description: '50-percent',
      capabilityInstanceId: 'capability:new-placement:Zygarde_20Cells:base',
    }))
  })

  it('persists Power Construct Zygarde Forme changes in durable assembly authority', () => {
    const actor: SheetPlacement = {
      id: 'zygarde', sheetKind: 'pokemon', sheetSlug: 'zygarde-sheet', position: { x: 1, y: 0, z: 1 },
    }
    const sheet: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Zygarde', species: 'Zygarde 50% Forme', level: 30,
      capabilities: { other: ['Zygarde Cells'] },
    }
    const map: TabletopMap = {
      ...baseMap([actor]),
      metadata: { capabilityZygardeAssemblies: [{
        actorPlacementId: actor.id, actorSheetSlug: sheet.slug, trainerSlug: 'owner', cellCount: 100,
        form: '50-percent', powerConstruct: true, disassemblable: false, sourceOperationId: 'assembly-operation',
      }] },
    }
    const result = run({
      canonicalId: 'Zygarde Cells', actionId: 'change-zygarde-form', actor, map, sheets: [sheet],
      selections: { optionId: '10-percent', recipientTrainerSlug: 'owner' },
    })
    expect(result.map.metadata?.capabilityZygardeAssemblies).toContainEqual(expect.objectContaining({
      actorSheetSlug: sheet.slug, form: '10-percent',
    }))
  })

  it('requires a Level 20 Pokémon before starting a Fortune roam', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'fortune-mon', position: { x: 1, y: 1, z: 1 },
    }
    const pokemon: CharacterSheet = {
      slug: actor.sheetSlug, species: 'Meowth', level: 19,
      capabilities: { other: ['Fortune'] },
    }
    const map = { ...baseMap([actor]), metadata: { capabilityContexts: ['city-or-town'] } }
    expect(() => validateAction({
      canonicalId: 'Fortune', actionId: 'roam-for-fortune', actor, map,
      sheets: [pokemon], selections: { gmConfirmed: false },
    })).toThrow(/at least Level 20/i)
  })

  it('invalidates a pending Fortune decision when its exact roam is abandoned', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'fortune-mon', position: { x: 1, y: 1, z: 1 },
    }
    const pokemon: CharacterSheet = {
      slug: actor.sheetSlug, species: 'Meowth', level: 20,
      capabilities: { other: ['Fortune'] },
    }
    const map = baseMap([actor])
    map.encounterState = {
      ...map.encounterState!,
      capabilityRuntime: {
        ...map.encounterState!.capabilityRuntime!,
        tasks: [{
          id: 'capability.task.actor.fortune-roam', kind: 'fortune-roam',
          actorPlacementId: actor.id, capabilityInstanceId: 'capability:actor:Fortune:base',
          canonicalId: 'Fortune', startedAt: 1, completesAt: 999,
          sourceOperationId: 'operation-roam-for-fortune',
        }],
        pendingAdjudications: [{
          requestId: 'operation-resolve-old-roam', actorPlacementId: actor.id,
          capabilityInstanceId: 'capability:actor:Fortune:base', canonicalId: 'Fortune',
          actionId: 'resolve-fortune-roam', requestedAt: 1_000, expiresAt: 100_000,
          sourceOperationId: 'operation-resolve-old-roam',
        }],
      },
    }
    const result = run({
      canonicalId: 'Fortune', actionId: 'abandon-fortune-roam', actor,
      map, sheets: [pokemon],
    })
    expect(result.map.encounterState?.capabilityRuntime?.tasks).toEqual([])
    expect(result.map.encounterState?.capabilityRuntime?.pendingAdjudications).toEqual([])
  })

  it('removes a low-Loyalty Fortune runaway from play and every linked Trainer roster without rolling money', () => {
    const actor: SheetPlacement = { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'fortune-mon', position: { x: 1, y: 1, z: 1 } }
    const pokemon: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Runner', species: 'Meowth', level: 20, loyalty: 1,
      capabilities: { other: ['Fortune'] },
    }
    const first: TrainerSheet = {
      slug: 'first', name: 'First', level: 10, currentTeam: [pokemon.slug], boxedPokemon: [pokemon.slug],
    }
    const second: TrainerSheet = {
      slug: 'second', name: 'Second', level: 10, currentTeam: [], boxedPokemon: [pokemon.slug],
    }
    const fortuneMap = baseMap([actor])
    fortuneMap.encounterState = {
      ...fortuneMap.encounterState!,
      capabilityRuntime: {
        ...fortuneMap.encounterState!.capabilityRuntime!,
        tasks: [{
          id: 'capability.task.actor.fortune-roam', kind: 'fortune-roam',
          actorPlacementId: actor.id, capabilityInstanceId: 'capability:actor:Fortune:base',
          canonicalId: 'Fortune', startedAt: 1, completesAt: 999,
          sourceOperationId: 'operation-roam-for-fortune',
        }],
      },
    }
    const result = run({
      canonicalId: 'Fortune', actionId: 'resolve-fortune-roam', actor,
      map: fortuneMap, sheets: [pokemon], trainers: [first, second],
      linkedTrainerSlugs: [first.slug, second.slug], selections: { optionId: 'runs-away' },
    })
    expect(result.reasonCode).toBe('capability.fortune.user-ran-away')
    expect(result.rolls).toEqual([])
    expect(result.map.placements).toEqual([])
    expect(result.sheetMutations).toHaveLength(2)
    for (const mutation of result.sheetMutations) {
      const current = mutation.current as TrainerSheet
      expect(current.currentTeam).not.toContain(pokemon.slug)
      expect(current.boxedPokemon).not.toContain(pokemon.slug)
    }
  })

  it('creates Gather Unown at authoritative geometry without inheriting the summoner side', () => {
    const actor: SheetPlacement = {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'summoner', position: { x: 1, y: 1, z: 1 }, sideId: 'heroes',
    }
    const pokemon: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Summoner', species: 'Sigilyph', level: 10,
      capabilities: { other: ['Gather Unown'] },
    }
    const result = run({
      canonicalId: 'Gather Unown', actionId: 'gather-unown', actor,
      map: baseMap([actor]), sheets: [pokemon], selections: { cells: [{ x: 4, y: 1, z: 1 }] },
    })
    const summonedPlacement = result.map.placements.find(candidate => candidate.id !== actor.id)!
    expect(summonedPlacement.position).toEqual({ x: 4, y: 1, z: 1 })
    expect(summonedPlacement.sideId).toBeUndefined()
    const summoned = result.sheetMutations.find(mutation => mutation.previous === null)?.current as CharacterSheet
    expect(summoned.species).toBe('Unown')
    expect(summoned.level).toBe(10)
    expect(summoned.movelist).toEqual([{ name: 'Hidden Power' }])
  })

  it('rejects an existing Prime Unown as a Letter Press participant', () => {
    const actor: SheetPlacement = {
      id: 'prime', sheetKind: 'pokemon', sheetSlug: 'prime', position: { x: 1, y: 1, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'nested-prime', sheetKind: 'pokemon', sheetSlug: 'nested-prime', position: { x: 2, y: 1, z: 1 },
    }
    const prime: CharacterSheet = {
      slug: 'prime', nickname: 'Prime', species: 'Unown', level: 20,
      capabilities: { other: ['Letter Press'] }, movelist: [{ name: 'Hidden Power' }],
    }
    const nestedPrime: CharacterSheet = {
      slug: 'nested-prime', nickname: 'Nested Prime', species: 'Unown', level: 20,
      movelist: [{ name: 'Hidden Power' }],
      capabilityCampaignState: {
        schemaVersion: 1, storedItems: [], planter: null, keystoneSynchronizations: [],
        letterPress: {
          combinedUnownCount: 2, statBonuses: { hp: 5 }, hiddenPowers: [],
          sourceOperationIds: ['prior-combination'],
        },
        marsupialPouch: null,
      },
    }
    const map: TabletopMap = {
      ...baseMap([actor, target]),
      metadata: { capabilityWillingTargets: [`${actor.id}:${target.id}`] },
    }
    expect(() => validateAction({
      canonicalId: 'Letter Press', actionId: 'combine-unown', actor, map,
      sheets: [prime, nestedPrime],
      selections: {
        targetPlacementIds: [target.id],
        optionId: 'stats:hp;hidden-power:attack,special',
      },
    })).toThrow(/cannot consume an existing Prime Unown/i)
  })

  it('retains a bounded rolling window of Letter Press operation evidence', () => {
    const actor: SheetPlacement = {
      id: 'prime', sheetKind: 'pokemon', sheetSlug: 'prime', position: { x: 1, y: 1, z: 1 },
    }
    const target: SheetPlacement = {
      id: 'next', sheetKind: 'pokemon', sheetSlug: 'next', position: { x: 2, y: 1, z: 1 },
    }
    const sourceOperationIds = Array.from({ length: 16 }, (_, index) => `prior-operation-${index + 1}`)
    const prime: CharacterSheet = {
      slug: 'prime', nickname: 'Prime Unown', species: 'Unown', level: 20,
      capabilities: { other: ['Letter Press'] },
      capabilityCampaignState: {
        schemaVersion: 1,
        storedItems: [],
        planter: null,
        keystoneSynchronizations: [],
        letterPress: {
          combinedUnownCount: 17,
          statBonuses: { hp: 20 },
          hiddenPowers: [],
          sourceOperationIds,
        },
        marsupialPouch: null,
      },
    }
    const next: CharacterSheet = {
      slug: 'next', nickname: 'Next', species: 'Unown', level: 10,
    }
    const result = run({
      canonicalId: 'Letter Press', actionId: 'combine-unown', actor,
      map: baseMap([actor, target]), sheets: [prime, next],
      selections: {
        targetPlacementIds: [target.id],
        optionId: 'stats:none;hidden-power:none',
      },
    })
    const current = result.sheetMutations.find(mutation => mutation.slug === prime.slug)!.current as CharacterSheet
    expect(current.capabilityCampaignState?.letterPress?.sourceOperationIds).toEqual([
      ...sourceOperationIds.slice(-15),
      'operation-combine-unown',
    ])
    expect(current.capabilityCampaignState?.letterPress?.combinedUnownCount).toBe(18)
  })

  it('permanently combines Unown, applies four bounded stat bonuses, and suppresses Underdog', () => {
    const actor: SheetPlacement = { id: 'prime', sheetKind: 'pokemon', sheetSlug: 'prime', position: { x: 1, y: 1, z: 1 } }
    const targetIds = ['u1', 'u2', 'u3', 'u4']
    const targetPlacements = targetIds.map((id, index): SheetPlacement => ({
      id, sheetKind: 'pokemon', sheetSlug: id, position: { x: index + 2, y: 1, z: 1 },
    }))
    const hiddenPower = { name: 'Hidden Power', category: 'Special' as const }
    const prime: CharacterSheet = {
      slug: 'prime', nickname: 'Unown', species: 'Unown', level: 20,
      capabilities: { other: ['Letter Press', 'Underdog'] }, movelist: [hiddenPower],
    }
    const targets = targetIds.map(id => ({
      slug: id, nickname: id, species: 'Unown', level: 10, movelist: [hiddenPower],
    } satisfies CharacterSheet))
    const result = run({
      canonicalId: 'Letter Press', actionId: 'combine-unown', actor,
      map: baseMap([actor, ...targetPlacements]), sheets: [prime, ...targets],
      selections: {
        targetPlacementIds: targetIds,
        optionId: 'stats:hp,atk,satk,spd;hidden-power:special,attack,special,attack,special',
      },
    })
    const current = result.sheetMutations.find(mutation => mutation.slug === 'prime')!.current as CharacterSheet
    expect(current.capabilityCampaignState?.letterPress).toMatchObject({
      combinedUnownCount: 5,
      statBonuses: { hp: 5, atk: 5, satk: 5, spd: 5 },
      hiddenPowers: [
        { sourceSheetSlug: 'prime', attackStat: 'special-attack' },
        { sourceSheetSlug: 'u1', attackStat: 'attack' },
        { sourceSheetSlug: 'u2', attackStat: 'special-attack' },
        { sourceSheetSlug: 'u3', attackStat: 'attack' },
        { sourceSheetSlug: 'u4', attackStat: 'special-attack' },
      ],
    })
    expect(current.movelist?.map(move => [move.name, move.category])).toEqual([
      ['Hidden Power [Letter Press:prime]', 'Special'],
      ['Hidden Power [Letter Press:u1]', 'Physical'],
      ['Hidden Power [Letter Press:u2]', 'Special'],
      ['Hidden Power [Letter Press:u3]', 'Physical'],
      ['Hidden Power [Letter Press:u4]', 'Special'],
    ])
    expect(result.sheetMutations.filter(mutation => mutation.slug !== 'prime')).toHaveLength(4)
    expect(result.map.placements.map(placement => placement.id)).toEqual(['prime'])
    expect(result.map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', payload: { capabilityId: 'underdog', action: 'suppress' },
    }))
    const cleanEncounterMap = {
      ...result.map,
      encounterState: { ...result.map.encounterState!, effects: [] },
    }
    expect(resolveEffectiveCapabilities({
      map: cleanEncounterMap,
      placement: actor,
      sheet: current,
      sheets: { pokemon: new Map([[current.slug, current]]), trainer: new Map() },
    }).instances.find(instance => instance.canonicalId === 'Underdog')).toMatchObject({
      effective: false,
      suppressionReasons: [`sheet:pokemon:${current.slug}:capabilityCampaignState.letterPress`],
    })
  })
})
