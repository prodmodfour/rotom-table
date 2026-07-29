import { describe, expect, it } from 'vitest'
import { parseExecuteCapabilityActionCommand, type CapabilityServerRoll } from '#shared/capabilityAutomation/clientCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import {
  CapabilitySelectionValidationError,
  validateCapabilityActionSelections,
} from '../../server/domain/capabilityAutomation/validateSelections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (kind: 'pokemon' | 'trainer' = 'pokemon'): SheetPlacement => ({
  id: 'actor', sheetKind: kind, sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 },
})

const mapFixture = (actor: SheetPlacement, overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2, id: 'map', slug: 'arena', name: 'Arena', revision: 1, updatedAt: 1_000,
  dimensions: { x: 10, y: 6, z: 10 }, groundLevelY: 0, voxels: [], placements: [actor],
  encounterState: createEmptyEncounterState(),
  ...overrides,
} as TabletopMap)

const actionInput = (input: {
  map: TabletopMap
  actor: SheetPlacement
  actorSheet: CharacterSheet | TrainerSheet
  canonicalId: 'Jump' | 'Teleporter'
  actionId: 'jump' | 'teleport'
  cells: readonly { x: number; y: number; z: number }[]
  optionId?: string | null
}) => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  if (input.actor.sheetKind === 'pokemon') pokemon.set(input.actor.sheetSlug, input.actorSheet as CharacterSheet)
  else trainer.set(input.actor.sheetSlug, input.actorSheet as TrainerSheet)
  const effective = resolveEffectiveCapabilities({
    map: input.map, placement: input.actor, sheet: input.actorSheet,
    sheets: { pokemon, trainer },
  })
  const instance = effective.instances.find(candidate => candidate.canonicalId === input.canonicalId && candidate.effective)!
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(input.canonicalId).spec.actions
    .find(candidate => candidate.actionId === input.actionId)!
  const command = parseExecuteCapabilityActionCommand({
    schemaVersion: 1,
    operationId: `operation-${input.actionId}`,
    mapSlug: input.map.slug,
    baseRevision: input.map.revision ?? 0,
    offerId: 'offer',
    actorPlacementId: input.actor.id,
    capabilityInstanceId: instance.instanceId,
    canonicalId: input.canonicalId,
    actionId: input.actionId,
    selections: {
      targetPlacementIds: [], cells: input.cells, optionId: input.optionId ?? null,
      recipientTrainerSlug: null, canonicalItemId: null, description: null, gmConfirmed: false,
    },
  })
  return { map: input.map, actor: input.actor, actorSheet: input.actorSheet, pokemon, trainer, action, command }
}

const validate = (input: ReturnType<typeof actionInput>): void => validateCapabilityActionSelections({
  map: input.map,
  actor: input.actor,
  actorSheet: input.actorSheet,
  pokemonSheets: input.pokemon,
  trainerSheets: input.trainer,
  command: input.command,
  action: input.action,
  now: 1_000,
})

const execute = (
  input: ReturnType<typeof actionInput>,
  totalPerDie: number,
) => executeCapabilityMechanic({
  map: input.map,
  actorPlacement: input.actor,
  actorSheet: input.actorSheet,
  pokemonSheets: input.pokemon,
  trainerSheets: input.trainer,
  linkedTrainerSlugs: new Set(),
  command: input.command,
  action: input.action,
  now: 1_000,
  rollDie: (rollId, sides, count = 1): CapabilityServerRoll => ({
    rollId, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => totalPerDie),
    modifier: 0, total: count * totalPerDie,
  }),
})

describe('authoritative Capability movement actions', () => {
  it('enforces Teleporter LOS, supported endpoints, parameterized range, and one use per Scene round', () => {
    const actor = placement()
    const sheet: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Teleporter', species: 'Abra', level: 20,
      capabilities: { other: ['Teleporter 4'] },
    }
    const scene = { name: 'Battle', startedAt: 500 }
    const base = mapFixture(actor, { activeScene: scene, initiative: { round: 2 } as TabletopMap['initiative'] })
    const legal = actionInput({ map: base, actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport', cells: [{ x: 4, y: 0, z: 1 }] })
    expect(() => validate(legal)).not.toThrow()
    const applied = execute(legal, 1)
    expect(applied.map.placements[0]?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(applied.map.metadata?.capabilityTeleportRoundUses).toContainEqual(expect.objectContaining({
      placementId: 'actor', round: 2, sceneStartedAt: 500, sceneName: 'Battle',
    }))

    const spent = actionInput({ map: { ...base, metadata: applied.map.metadata }, actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport', cells: [{ x: 3, y: 0, z: 1 }] })
    expect(() => validate(spent)).toThrowError(CapabilitySelectionValidationError)
    const nextRound = actionInput({
      map: { ...base, initiative: { round: 3 } as TabletopMap['initiative'], metadata: applied.map.metadata },
      actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport', cells: [{ x: 3, y: 0, z: 1 }],
    })
    expect(() => validate(nextRound)).not.toThrow()
    const outOfRange = actionInput({
      map: base, actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport',
      cells: [{ x: 6, y: 0, z: 1 }],
    })
    expect(() => validate(outOfRange)).toThrow(/within 4 metres/i)

    const blocked = actionInput({
      map: mapFixture(actor, { voxels: [{ x: 3, y: 0, z: 1, materialId: 'airship_wall_bulkhead', blocksMovement: true, blocksSight: true }] }),
      actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport', cells: [{ x: 4, y: 0, z: 1 }],
    })
    expect(() => validate(blocked)).toThrow(/line of sight/i)

    const airborne = actionInput({ map: mapFixture(actor), actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport', cells: [{ x: 2, y: 2, z: 1 }] })
    expect(() => validate(airborne)).toThrow(/touching a surface/i)
    const levitatingSheet: CharacterSheet = { ...sheet, capabilities: { other: ['Teleporter 4', 'Levitate 4'] } }
    expect(() => validate(actionInput({
      map: mapFixture(actor), actor, actorSheet: levitatingSheet,
      canonicalId: 'Teleporter', actionId: 'teleport', cells: [{ x: 2, y: 2, z: 1 }],
    }))).not.toThrow()
  })

  it('relocates an exact source-effective As One companion with Teleporter', () => {
    const actor = placement()
    const mount: SheetPlacement = {
      id: 'mount', sheetKind: 'pokemon', sheetSlug: 'mount-sheet', position: { ...actor.position },
    }
    const sheet: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Rider', species: 'Abra', level: 20,
      capabilities: { other: ['Teleporter 4', 'As One'] },
    }
    const mountSheet: CharacterSheet = {
      slug: mount.sheetSlug, nickname: 'Mount', species: 'Ponyta', level: 20,
      capabilities: { overland: 8, other: ['Mountable 1'] },
    }
    const unlinkedMap = mapFixture(actor, { placements: [actor, mount] })
    const lookup = {
      pokemon: new Map([[sheet.slug, sheet], [mountSheet.slug, mountSheet]]),
      trainer: new Map<string, TrainerSheet>(),
    }
    const asOne = resolveEffectiveCapabilities({
      map: unlinkedMap, placement: actor, sheet, sheets: lookup,
    }).instances.find(candidate => candidate.effective && candidate.canonicalId === 'As One')!
    const encounter = createEmptyEncounterState()
    const linkedMap = {
      ...unlinkedMap,
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'as-one-link', kind: 'as-one-mount' as const, ownerPlacementId: actor.id,
            participantPlacementIds: [mount.id], capabilityInstanceId: asOne.instanceId,
            canonicalId: 'As One', establishedAt: 1, configurationId: 'Run Away',
            sourceOperationId: 'mount-operation',
          }],
        },
      },
    }
    const request = actionInput({
      map: linkedMap, actor, actorSheet: sheet, canonicalId: 'Teleporter', actionId: 'teleport',
      cells: [{ x: 4, y: 0, z: 1 }],
    })
    request.pokemon.set(mountSheet.slug, mountSheet)
    expect(() => validate(request)).not.toThrow()
    const result = execute(request, 1)
    expect(result.map.placements.find(candidate => candidate.id === actor.id)?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(result.map.placements.find(candidate => candidate.id === mount.id)?.position).toEqual({ x: 4, y: 0, z: 1 })
  })

  it('rolls DC 16 only for a one-metre Jump extension and relocates only on success', () => {
    const actor = placement()
    const sheet: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Jumper', species: 'Pikachu', level: 20,
      skills: { acrobatics: '3d6' }, capabilities: { jump: '2/1' },
    }
    const request = actionInput({
      map: mapFixture(actor), actor, actorSheet: sheet, canonicalId: 'Jump', actionId: 'jump',
      cells: [{ x: 4, y: 0, z: 1 }], optionId: 'acrobatics-extension',
    })
    expect(() => validate(request)).not.toThrow()
    const failed = execute(request, 5)
    expect(failed.outcome).toBe('no-op')
    expect(failed.map.placements[0]?.position).toEqual(actor.position)
    const succeeded = execute(request, 6)
    expect(succeeded.outcome).toBe('applied')
    expect(succeeded.map.placements[0]?.position).toEqual({ x: 4, y: 0, z: 1 })
  })

  it('derives a one-cell Running Start inside the same Trainer Shift and rejects blocked or Pokémon branches', () => {
    const actor = placement('trainer')
    const trainer: TrainerSheet = {
      slug: actor.sheetSlug, name: 'Runner', level: 10,
      capabilities: { overland: 5, longJump: 2, highJump: 1 },
      skills: { acrobatics: { value: 4, dice: '4d6' } },
    }
    const request = actionInput({
      map: mapFixture(actor), actor, actorSheet: trainer, canonicalId: 'Jump', actionId: 'jump',
      cells: [{ x: 4, y: 0, z: 1 }], optionId: 'running-start',
    })
    expect(() => validate(request)).not.toThrow()
    const blocked = actionInput({
      map: mapFixture(actor, { voxels: [{ x: 2, y: 0, z: 1, materialId: 'airship_wall_bulkhead', blocksMovement: true }] }),
      actor, actorSheet: trainer, canonicalId: 'Jump', actionId: 'jump',
      cells: [{ x: 4, y: 0, z: 1 }], optionId: 'running-start',
    })
    expect(() => validate(blocked)).toThrow(/run-up is illegal/i)

    const pokemonActor = placement()
    const pokemon: CharacterSheet = {
      slug: pokemonActor.sheetSlug, nickname: 'Runner', species: 'Pikachu', level: 10,
      capabilities: { jump: '3/1' },
    }
    expect(() => validate(actionInput({
      map: mapFixture(pokemonActor), actor: pokemonActor, actorSheet: pokemon,
      canonicalId: 'Jump', actionId: 'jump', cells: [{ x: 4, y: 0, z: 1 }], optionId: 'running-start',
    }))).toThrow(/Trainer High Jump/i)
  })

  it('rejects Jump trajectories that cannot clear blocking terrain within High Jump', () => {
    const actor = placement()
    const sheet: CharacterSheet = {
      slug: actor.sheetSlug, nickname: 'Jumper', species: 'Pikachu', level: 20,
      capabilities: { jump: '3/0' },
    }
    const request = actionInput({
      map: mapFixture(actor, { voxels: [{ x: 2, y: 0, z: 1, materialId: 'airship_wall_bulkhead', blocksMovement: true }] }),
      actor, actorSheet: sheet, canonicalId: 'Jump', actionId: 'jump',
      cells: [{ x: 4, y: 0, z: 1 }], optionId: 'normal',
    })
    expect(() => validate(request)).toThrow(/collision-free trajectory/i)
  })
})
