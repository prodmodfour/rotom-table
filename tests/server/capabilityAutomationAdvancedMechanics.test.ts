import { describe, expect, it } from 'vitest'
import { parseExecuteCapabilityActionCommand, type CapabilityServerRoll } from '#shared/capabilityAutomation/clientCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
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
const run = (input: {
  canonicalId: string
  actionId: string
  map: TabletopMap
  actor: SheetPlacement
  sheets: readonly CharacterSheet[]
  trainers?: readonly TrainerSheet[]
  linkedTrainerSlugs?: readonly string[]
  selections?: Record<string, unknown>
}) => {
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(input.canonicalId).spec.actions
    .find(candidate => candidate.actionId === input.actionId)!
  const command = parseExecuteCapabilityActionCommand({
    schemaVersion: 1, operationId: `operation-${input.actionId}`, mapSlug: input.map.slug,
    baseRevision: input.map.revision ?? 0, offerId: 'offer', actorPlacementId: input.actor.id,
    capabilityInstanceId: `capability:${input.actor.id}:${input.canonicalId.replaceAll(' ', '_')}:base`,
    canonicalId: input.canonicalId, actionId: input.actionId,
    selections: selections(input.selections),
  })
  const bySlug = new Map(input.sheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map((input.trainers ?? []).map(sheet => [sheet.slug, sheet]))
  return executeCapabilityMechanic({
    map: input.map, actorPlacement: input.actor, actorSheet: bySlug.get(input.actor.sheetSlug)!,
    pokemonSheets: bySlug, trainerSheets: trainerBySlug,
    linkedTrainerSlugs: new Set(input.linkedTrainerSlugs ?? []),
    command, action, now: 1_000, rollDie,
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
    const result = run({
      canonicalId: 'Fortune', actionId: 'roam-for-fortune', actor,
      map: baseMap([actor]), sheets: [pokemon], trainers: [first, second],
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
