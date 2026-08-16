import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveState'
import { parseExecuteCapabilityActionCommand, type CapabilityServerRoll } from '#shared/capabilityAutomation/clientCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createFiniteAuthoritativeMoveRandomStream } from '../../server/domain/moveAutomation/random'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import { CapabilitySelectionValidationError, validateCapabilityActionSelections } from '../../server/domain/capabilityAutomation/validateSelections'
import { projectCapabilityAutomationMapForPlayer } from '../../server/domain/capabilityAutomation/clientStateProjection'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { activeEquipmentState } from '../fixtures/equipment'

const actor: SheetPlacement = {
  id: 'rayquaza-token', sheetKind: 'pokemon', sheetSlug: 'rayquaza', position: { x: 1, y: 0, z: 1 },
}
const target: SheetPlacement = {
  id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 10, y: 0, z: 1 },
}
const rayquaza = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'rayquaza', nickname: 'Sky Lord', species: 'Rayquaza', level: 70,
  movelist: [{ name: 'Dragon Ascent' }], abilities: [{ name: 'Air Lock' }],
  ...overrides,
})
const targetSheet: CharacterSheet = { slug: 'target', nickname: 'Target', species: 'Pikachu', level: 10 }
const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer', name: 'Trainer', level: 20, currentTeam: ['rayquaza'],
  equipmentSlots: { accessory: 'Mega Ring' },
  equipmentState: activeEquipmentState({
    ownerKind: 'trainer', ownerSlug: 'trainer', slotId: 'accessory', canonicalItemId: 'Mega Ring',
  }),
  ...overrides,
})
const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2, id: 'map', slug: 'arena', name: 'Arena', revision: 1, updatedAt: 1_000,
  dimensions: { x: 20, y: 20, z: 20 }, groundLevelY: 0, voxels: [], placements: [actor, target],
  activeScene: { name: 'Finale', startedAt: 500 }, initiative: { activeId: actor.id, round: 1 },
  encounterState: createEmptyEncounterState(), ...overrides,
} as TabletopMap)

const request = (input: {
  map?: TabletopMap
  pokemon?: CharacterSheet
  trainer?: TrainerSheet
  ability?: string
}) => {
  const map = input.map ?? mapFixture()
  const pokemon = input.pokemon ?? rayquaza()
  const linkedTrainer = input.trainer ?? trainer()
  const pokemonSheets = new Map([[pokemon.slug, pokemon], [targetSheet.slug, targetSheet]])
  const trainerSheets = new Map([[linkedTrainer.slug, linkedTrainer]])
  const instance = resolveEffectiveCapabilities({
    map, placement: actor, sheet: pokemon, sheets: { pokemon: pokemonSheets, trainer: trainerSheets },
  }).instances.find(candidate => candidate.canonicalId === 'Delta Evolution' && candidate.effective)!
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Delta Evolution').spec.actions
    .find(candidate => candidate.actionId === 'mega-evolve')!
  const command = parseExecuteCapabilityActionCommand({
    schemaVersion: 1, operationId: 'operation-mega-evolve', mapSlug: map.slug,
    baseRevision: map.revision ?? 0, offerId: 'offer', actorPlacementId: actor.id,
    capabilityInstanceId: instance.instanceId, canonicalId: 'Delta Evolution', actionId: 'mega-evolve',
    selections: {
      targetPlacementIds: [], cells: [], optionId: input.ability ?? 'Run Away',
      recipientTrainerSlug: linkedTrainer.slug, canonicalItemId: null, description: null, gmConfirmed: false,
    },
  })
  return { map, pokemon, linkedTrainer, pokemonSheets, trainerSheets, instance, action, command }
}

const validate = (input: ReturnType<typeof request>) => validateCapabilityActionSelections({
  map: input.map, actor, actorSheet: input.pokemon, pokemonSheets: input.pokemonSheets,
  trainerSheets: input.trainerSheets, command: input.command, action: input.action, now: 1_000,
})

const execute = (input: ReturnType<typeof request>) => executeCapabilityMechanic({
  map: input.map, actorPlacement: actor, actorSheet: input.pokemon,
  pokemonSheets: input.pokemonSheets, trainerSheets: input.trainerSheets,
  linkedTrainerSlugs: new Set([input.linkedTrainer.slug]), command: input.command, action: input.action,
  now: 1_000, rollDie: (rollId, sides, count = 1): CapabilityServerRoll => ({
    rollId, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => 1),
    modifier: 0, total: count,
  }),
})

const context = (map: TabletopMap, pokemon: CharacterSheet, linkedTrainer: TrainerSheet) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([[pokemon.slug, pokemon], [targetSheet.slug, targetSheet]]),
  trainerSheets: new Map([[linkedTrainer.slug, linkedTrainer]]),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: actor.id,
    moveName: 'Dragon Ascent',
    selection: { kind: 'single-target', targetPlacementId: target.id },
  } satisfies ResolveMoveIntent,
  candidatePlacementIds: [target.id], selectedPlacementIds: [target.id],
  random: createFiniteAuthoritativeMoveRandomStream([]), time: 1_000,
})

describe('Delta Evolution authoritative Mega pathway', () => {
  it('requires the active Scene, Dragon Ascent, exact linked Mega Ring, and one Ring use per Scene', () => {
    expect(() => validate(request({ map: mapFixture({ activeScene: null }) }))).toThrowError(CapabilitySelectionValidationError)
    expect(() => validate(request({ pokemon: rayquaza({ movelist: [] }) }))).toThrow(/Dragon Ascent/i)
    expect(() => validate(request({ trainer: trainer({
      equipmentSlots: { accessory: 'Mega Bracelet' }, equipmentState: undefined,
    }) }))).toThrow(/Mega Ring/i)
    expect(() => validate(request({ map: mapFixture({ activeScene: { name: 'Broken', startedAt: -1 } }) }))).toThrow(/Scene start identity/i)
    expect(() => validate(request({ map: mapFixture({ metadata: {
      capabilityMegaEvolutionUses: [{ trainerSlug: 'trainer', actorPlacementId: actor.id, sceneStartedAt: 500 }],
    } }) }))).toThrow(/already supports a Mega Evolution/i)
  })

  it('retains one replay-safe Scene use and projects Mega Rayquaza form, exact stat bonuses, and Run Away temporarily', () => {
    const input = request({})
    expect(() => validate(input)).not.toThrow()
    const before = context(input.map, input.pokemon, input.linkedTrainer)
    const result = execute(input)
    expect(result.sheetMutations).toEqual([])
    expect(result.map.encounterState?.capabilityRuntime?.modes).toContainEqual(expect.objectContaining({
      mode: 'mega-evolved', canonicalId: 'Delta Evolution',
      configurationId: 'trainer:trainer;ability:Run Away',
    }))
    expect(result.map.metadata?.capabilityMegaEvolutionUses).toContainEqual(expect.objectContaining({
      trainerSlug: 'trainer', actorPlacementId: actor.id, sceneStartedAt: 500,
      sourceOperationId: 'operation-mega-evolve',
      ringInstanceId: expect.stringMatching(/^equipped-item:v1:/),
      ringInstanceRevision: 0,
    }))

    const after = context(result.map, input.pokemon, input.linkedTrainer)
    expect(after.queries.creatureRules.resolve(actor.id)?.formId).toBe('mega-rayquaza')
    expect(after.actor.token.atk - before.actor.token.atk).toBe(3)
    expect(after.actor.token.def - before.actor.token.def).toBe(1)
    expect(after.actor.token.satk - before.actor.token.satk).toBe(3)
    expect(after.actor.token.sdef - before.actor.token.sdef).toBe(1)
    expect(after.actor.token.spd - before.actor.token.spd).toBe(2)
    expect(after.actor.token.defenderTypes).toEqual(before.actor.token.defenderTypes)
    expect(after.queries.abilities.has(actor.id, 'Run Away')).toBe(true)
  })

  it('requires a different absent natural Ability when Run Away is already effective', () => {
    const duplicate = request({ pokemon: rayquaza({ abilities: [{ name: 'Air Lock' }, { name: 'Run Away' }] }) })
    expect(() => validate(duplicate)).toThrow(/another natural Ability/i)
    const replacement = request({
      pokemon: rayquaza({ abilities: [{ name: 'Air Lock' }, { name: 'Run Away' }] }),
      ability: 'Pressure',
    })
    expect(() => validate(replacement)).not.toThrow()
    const result = execute(replacement)
    expect(context(result.map, replacement.pokemon, replacement.linkedTrainer).queries.abilities.has(actor.id, 'Pressure')).toBe(true)
  })

  it('keeps Complete Zygarde form authority above an ordinary Zygarde mode description', () => {
    const complete = rayquaza({
      nickname: 'Complete Zygarde', species: 'Zygarde Complete Forme',
      movelist: [{ name: 'Dragon Ascent' }], abilities: [{ name: 'Power Construct' }],
    })
    const baseMap = mapFixture()
    const pokemonSheets = new Map([[complete.slug, complete], [targetSheet.slug, targetSheet]])
    const trainerSheets = new Map([[trainer().slug, trainer()]])
    const cells = resolveEffectiveCapabilities({
      map: baseMap, placement: actor, sheet: complete, sheets: { pokemon: pokemonSheets, trainer: trainerSheets },
    }).instances.find(candidate => candidate.effective && candidate.canonicalId === 'Zygarde Cells')!
    const encounter = createEmptyEncounterState()
    const modeMap: TabletopMap = {
      ...baseMap,
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'zygarde-form-mode', actorPlacementId: actor.id, capabilityInstanceId: cells.instanceId,
            canonicalId: 'Zygarde Cells', mode: 'zygarde-form', description: '10-percent',
            configurationId: '10-percent', activatedAt: 100, expiresAt: null, sourceOperationId: 'operation',
          }],
        },
      },
    }
    expect(context(modeMap, complete, trainer()).actor.token.species.toLocaleLowerCase('en-US')).toContain('complete')
  })

  it('stops projection outside the owning Scene and redacts Ring-use and Mega configuration authority from players', () => {
    const input = request({})
    const result = execute(input)
    const laterScene = { ...result.map, activeScene: { name: 'Later', startedAt: 2_000 } }
    const later = context(laterScene, input.pokemon, input.linkedTrainer)
    expect(later.actor.token.creatureRules?.formId).not.toBe('mega-rayquaza')
    expect(later.queries.abilities.has(actor.id, 'Run Away')).toBe(false)

    const projected = projectCapabilityAutomationMapForPlayer(result.map)
    expect(projected.metadata?.capabilityMegaEvolutionUses).toBeUndefined()
    expect(projected.encounterState?.capabilityRuntime?.modes).toEqual([])
    expect(JSON.stringify(projected)).not.toContain('trainer:trainer')
  })
})
