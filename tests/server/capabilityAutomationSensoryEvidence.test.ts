import { describe, expect, it } from 'vitest'
import { parseExecuteCapabilityActionCommand } from '#shared/capabilityAutomation/clientCommands'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { validateCapabilityActionSelections } from '../../server/domain/capabilityAutomation/validateSelections'
import { projectCapabilityAutomationMapForPlayer } from '../../server/domain/capabilityAutomation/clientStateProjection'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'

const actorPlacement: SheetPlacement = {
  id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 },
}
const targetPlacement: SheetPlacement = {
  id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 },
}
const viewerPlacement: SheetPlacement = {
  id: 'viewer', sheetKind: 'pokemon', sheetSlug: 'viewer-sheet', position: { x: 3, y: 0, z: 1 },
}
const actor: CharacterSheet = {
  slug: actorPlacement.sheetSlug, nickname: 'Reader', species: 'Pikachu', level: 30,
  capabilities: { other: ['Dream Reader', 'Illusionist', 'Tracker'] }, skills: { focus: '4d6', perception: '4d6' },
}
const target: CharacterSheet = {
  slug: targetPlacement.sheetSlug, nickname: 'Sleeper', species: 'Snorlax', level: 30,
  combat: { currentHp: 50, conditions: ['Sleeping'] },
}
const viewer: CharacterSheet = {
  slug: viewerPlacement.sheetSlug, nickname: 'Viewer', species: 'Eevee', level: 20,
}
const sheets = {
  pokemon: new Map([[actor.slug, actor], [target.slug, target], [viewer.slug, viewer]]),
  trainer: new Map(),
}
const map = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2, slug: 'sensory-map', name: 'Sensory Map', revision: 3,
  dimensions: { x: 10, y: 4, z: 10 }, groundLevelY: 0, voxels: [],
  placements: [actorPlacement, targetPlacement, viewerPlacement], encounterState: createEmptyEncounterState(),
  ...overrides,
})
const command = (
  canonicalId: string,
  actionId: string,
  selections: Record<string, unknown>,
  operationId = `operation:${actionId}`,
) => parseExecuteCapabilityActionCommand({
  schemaVersion: 1, operationId, mapSlug: 'sensory-map', baseRevision: 3,
  offerId: `offer:${actionId}`, actorPlacementId: actorPlacement.id,
  capabilityInstanceId: `capability:actor:${canonicalId.replaceAll(' ', '_20')}:base`, canonicalId, actionId,
  selections: {
    targetPlacementIds: [], cells: [], optionId: null, recipientTrainerSlug: null,
    canonicalItemId: null, description: null, gmConfirmed: false, ...selections,
  },
})
const execute = (
  canonicalId: string,
  actionId: string,
  selections: Record<string, unknown>,
  sourceMap: TabletopMap,
  now: number,
  operationId?: string,
) => {
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId).spec.actions
    .find(entry => entry.actionId === actionId)!
  return executeCapabilityMechanic({
    map: sourceMap, actorPlacement, actorSheet: actor,
    pokemonSheets: sheets.pokemon, trainerSheets: sheets.trainer, linkedTrainerSlugs: new Set(),
    command: command(canonicalId, actionId, selections, operationId), action, now,
    rollDie: () => { throw new Error(`${actionId} does not roll.`) },
  })
}
const validate = (
  canonicalId: string,
  actionId: string,
  selections: Record<string, unknown>,
  sourceMap: TabletopMap,
  now: number,
) => {
  const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId).spec.actions
    .find(entry => entry.actionId === actionId)!
  return validateCapabilityActionSelections({
    map: sourceMap, actor: actorPlacement, actorSheet: actor,
    pokemonSheets: sheets.pokemon, trainerSheets: sheets.trainer,
    command: command(canonicalId, actionId, selections), action, now,
  })
}

describe('Capability sensory evidence and movable Illusions', () => {
  it('binds Tracker evidence and private results to one exact prey identity', () => {
    const sourceMap = map({
      metadata: {
        capabilityScentEvidence: [{
          actorPlacementId: actorPlacement.id, preyIdentity: 'pokemon:eevee-42',
          personalBelonging: true, expiresAt: 10_000,
        }],
      },
    })
    expect(() => validate('Tracker', 'track-scent', {
      optionId: 'familiar', gmConfirmed: false,
    }, sourceMap, 1_000)).not.toThrow()
    expect(() => validate('Tracker', 'track-scent', {
      optionId: 'familiar;prey:pokemon:eevee-42', description: 'The trail leads north.', gmConfirmed: true,
    }, sourceMap, 1_000)).not.toThrow()
    expect(() => validate('Tracker', 'track-scent', {
      optionId: 'familiar;prey:pokemon:other', description: 'The trail leads north.', gmConfirmed: true,
    }, sourceMap, 1_000)).toThrow(/exact prey identity/i)

    const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Tracker').spec.actions
      .find(entry => entry.actionId === 'track-scent')!
    const result = executeCapabilityMechanic({
      map: sourceMap, actorPlacement, actorSheet: actor,
      pokemonSheets: sheets.pokemon, trainerSheets: sheets.trainer, linkedTrainerSlugs: new Set(),
      command: command('Tracker', 'track-scent', {
        optionId: 'familiar;prey:pokemon:eevee-42', description: 'The trail leads north.', gmConfirmed: true,
      }),
      action, now: 1_000,
      rollDie: (rollId, sides, count = 1) => ({
        rollId, expression: `${count}d${sides}`, dice: Array.from({ length: count }, () => sides),
        modifier: 0, total: count * sides,
      }),
    })
    expect(result.reasonCode).toBe('capability.tracker.scent-acquired')
    expect(result.map.metadata?.capabilityPrivateNotices).toContainEqual(expect.objectContaining({
      label: 'Scent Trail — pokemon:eevee-42', summary: 'The trail leads north.',
    }))
    expect(JSON.stringify(projectCapabilityAutomationMapForPlayer(result.map, sheets))).not.toContain('pokemon:eevee-42')
  })

  it('retains bounded Dream Mist causal evidence, reuses it before expiry, and redacts it from players', () => {
    const selections = {
      targetPlacementIds: [targetPlacement.id],
      optionId: `dream-mist-image:viewers:${viewerPlacement.id}`,
      description: 'A silver lake under two moons.',
      gmConfirmed: true,
    }
    const confirmed = execute('Dream Reader', 'read-dream', selections, map(), 1_000, 'operation:dream-confirmed')
    expect(confirmed.map.metadata?.capabilityDreamMistSleepEvidence).toEqual([{
      targetPlacementId: targetPlacement.id,
      confirmedAt: 1_000,
      expiresAt: 3_601_000,
      sourceOperationId: 'operation:dream-confirmed',
    }])
    expect(confirmed.map.metadata?.capabilityPrivateNotices).toContainEqual(expect.objectContaining({
      label: 'Dream Mist Image', revealToPlacementIds: [actorPlacement.id, viewerPlacement.id],
    }))

    expect(() => validate('Dream Reader', 'read-dream', { ...selections, gmConfirmed: false }, confirmed.map, 2_000)).not.toThrow()
    expect(() => validate('Dream Reader', 'read-dream', { ...selections, gmConfirmed: false }, confirmed.map, 3_601_000))
      .toThrow(/evidence|confirmation/i)

    const replay = execute('Dream Reader', 'read-dream', selections, confirmed.map, 1_000, 'operation:dream-confirmed')
    expect(replay.map.metadata?.capabilityDreamMistSleepEvidence).toHaveLength(1)
    const projected = projectCapabilityAutomationMapForPlayer(replay.map, sheets)
    expect(projected.metadata?.capabilityDreamMistSleepEvidence).toBeUndefined()
    expect(JSON.stringify(projected)).not.toContain('silver lake')
  })

  it('rejects static, stale, foreign, blocked, and out-of-range Illusion repositioning', () => {
    const staticIllusion = execute('Illusionist', 'create-illusion', {
      cells: [{ x: 2, y: 0, z: 1 }], optionId: 'size-mm:300x300x300;motion:static',
      description: 'A still blue orb.',
    }, map(), 1_000)
    expect(() => validate('Illusionist', 'reposition-illusion', {
      cells: [{ x: 3, y: 0, z: 1 }],
    }, staticIllusion.map, 1_100)).toThrow(/moving Illusion/i)

    const moving = execute('Illusionist', 'create-illusion', {
      cells: [{ x: 2, y: 0, z: 1 }], optionId: 'size-mm:300x300x300;motion:minor',
      description: 'A drifting blue orb.',
    }, map(), 1_000)
    expect(() => validate('Illusionist', 'reposition-illusion', {
      cells: [{ x: 4, y: 0, z: 1 }],
    }, moving.map, 1_100)).not.toThrow()

    const staleMode = structuredClone(moving.map)
    staleMode.encounterState!.capabilityRuntime!.modes[0]!.capabilityInstanceId = 'stale-source'
    expect(() => validate('Illusionist', 'reposition-illusion', {
      cells: [{ x: 3, y: 0, z: 1 }],
    }, staleMode, 1_100)).toThrow(/moving Illusion/i)

    const foreignMetadata = structuredClone(moving.map)
    ;(foreignMetadata.metadata!.capabilityIllusions![0] as Record<string, unknown>).sourceOperationId = 'foreign-operation'
    expect(() => validate('Illusionist', 'reposition-illusion', {
      cells: [{ x: 3, y: 0, z: 1 }],
    }, foreignMetadata, 1_100)).toThrow(/moving Illusion/i)

    const blocked = {
      ...moving.map,
      voxels: [{ x: 3, y: 0, z: 1, materialId: 'wall', blocksMovement: true, blocksSight: true }],
    }
    expect(() => validate('Illusionist', 'reposition-illusion', {
      cells: [{ x: 4, y: 0, z: 1 }],
    }, blocked, 1_100)).toThrow(/line of sight/i)
    expect(() => validate('Illusionist', 'reposition-illusion', {
      cells: [{ x: 9, y: 0, z: 1 }],
    }, moving.map, 1_100)).toThrow(/Focus Rank|out-of-range/i)
  })
})
