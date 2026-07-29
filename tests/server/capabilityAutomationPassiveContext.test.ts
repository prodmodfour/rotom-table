import { describe, expect, it } from 'vitest'
import {
  resolvePackMonDisposition,
  resolvePremonitionBand,
  tremorsenseCanResolve,
  xRayVisionCanPenetrate,
} from '../../server/domain/capabilityAutomation/passiveProviders'
import { projectCapabilityAutomationMapForPlayer } from '../../server/domain/capabilityAutomation/clientStateProjection'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { buildCapabilityClientCapabilityBundle } from '../../server/domain/capabilityAutomation/clientCapabilities'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { redactSheetRecordForPlayer, redactSheetUpdateForPlayer } from '../../server/utils/sheetPrivacy'
import { redactRealtimeEventForPrincipal } from '../../server/realtime/realtimeEventRedaction'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { RealtimeEventAccessDependencies } from '../../server/realtime/realtimeEventAccessPolicy'

describe('Capability passive context providers', () => {
  it('resolves every Pack Mon relationship boundary deterministically', () => {
    const base = {
      userSpecies: 'Mightyena', userLevel: 30, userIsWild: false,
      targetSpecies: 'Poochyena', targetLevel: 20, targetIsWild: true,
      bothHavePackMon: false,
    }
    expect(resolvePackMonDisposition({ ...base, targetIsUnevolvedFormOfUser: true })).toBe('obeys')
    expect(resolvePackMonDisposition({ ...base, targetLevel: 25 })).toBe('fearful')
    expect(resolvePackMonDisposition({ ...base, targetSpecies: 'Mightyena', targetLevel: 35, bothHavePackMon: true })).toBe('dominance-fight')
    expect(resolvePackMonDisposition({ ...base, targetSpecies: 'Mightyena', targetLevel: 41, bothHavePackMon: true })).toBe('expects-obedience')
  })

  it.each(['act-as-bait', 'lure-with-alluring', 'distract-with-alluring'])(
    'shares Alluring daily authority across both Bait branches, including legacy %s usage',
    (spentActionId) => {
      const alluring: CharacterSheet = {
        slug: 'alluring', nickname: 'Alluring', species: 'Spritzee', level: 20,
        capabilities: { other: ['Alluring'] },
        capabilityUsage: {
          schemaVersion: 1,
          entries: [{
            id: `usage:${spentActionId}`,
            canonicalId: 'Alluring',
            actionId: spentActionId,
            capabilityInstanceId: 'legacy-or-current-source',
            period: 'daily',
            usedAt: 100,
            availableAt: null,
            remainingDayAdvances: null,
            sourceOperationId: 'operation:alluring-bait',
          }],
        },
      }
      const wild: CharacterSheet = {
        slug: 'wild', nickname: 'Wild', species: 'Pidgey', level: 10,
      }
      const testMap = {
        schemaVersion: 2, id: 'alluring-map', slug: 'alluring-map', name: 'Alluring', revision: 1, updatedAt: 200,
        dimensions: { x: 6, y: 3, z: 6 }, groundLevelY: 0, voxels: [],
        placements: [
          { id: 'alluring', sheetKind: 'pokemon' as const, sheetSlug: alluring.slug, position: { x: 1, y: 0, z: 1 } },
          { id: 'wild', sheetKind: 'pokemon' as const, sheetSlug: wild.slug, position: { x: 2, y: 0, z: 1 } },
        ],
        metadata: { capabilityWildPlacementIds: ['wild'] },
      } as TabletopMap
      const offers = buildCapabilityClientCapabilityBundle({
        role: 'gm', map: testMap, mapRevision: 1,
        pokemonSheets: [alluring, wild], trainerSheets: [], now: 200,
      }).placements.find(placement => placement.placementId === 'alluring')!.offers
        .filter(offer => offer.canonicalId === 'Alluring')
      expect(offers.map(offer => offer.actionId).sort()).toEqual([
        'distract-with-alluring', 'lure-with-alluring',
      ])
      expect(offers.every(offer => !offer.available)).toBe(true)
      expect(offers.every(offer => offer.unavailableReasonCodes.includes('usage.daily-exhausted'))).toBe(true)
    },
  )

  it('enforces sensory bounds without interpreting prose', () => {
    expect(xRayVisionCanPenetrate({ thicknessFeet: 1, material: 'drywall' })).toBe(true)
    expect(xRayVisionCanPenetrate({ thicknessFeet: 1.01, material: 'paper' })).toBe(false)
    expect(xRayVisionCanPenetrate({ thicknessFeet: 0.1, material: 'lead' })).toBe(false)
    expect(tremorsenseCanResolve({ distanceMeters: 5, inGround: true })).toBe(true)
    expect(tremorsenseCanResolve({ distanceMeters: 6, inGround: true })).toBe(false)
    expect(resolvePremonitionBand({ magnitude: 3, proximity: 3 })).toEqual({
      warningBand: 'specific-area-days', revealsSpecificArea: true,
    })
  })

  it('removes private sensory and retry authority from player map documents', () => {
    const map = {
      schemaVersion: 2, id: 'map', slug: 'map', name: 'Map', revision: 1, updatedAt: 100,
      dimensions: { x: 4, y: 4, z: 4 }, groundLevelY: 0, voxels: [], placements: [],
      metadata: {
        capabilityPremonitions: [{ summary: 'eruption' }],
        capabilityXRayObservations: [{ outlineSummary: 'hidden target' }],
        capabilityPsychicResidue: [{ id: 'private' }],
        capabilityIllusions: [{ id: 'public-illusion' }],
        capabilityTeleportRoundUses: [{ placementId: 'a', round: 1 }],
        capabilityMegaEvolutionUses: [{ trainerSlug: 'secret-trainer', sceneStartedAt: 10 }],
      },
      encounterState: {
        ...createEmptyEncounterState(),
        capabilityRuntime: {
          ...createEmptyEncounterState().capabilityRuntime!,
          checkPenalties: [{
            id: 'penalty', actorPlacementId: 'a', targetPlacementId: 'b', canonicalId: 'Telepath',
            actionId: 'read-mind', value: -3, expiresAt: 1000, sourceOperationId: 'operation',
          }],
        },
      },
    } as TabletopMap
    const projected = projectCapabilityAutomationMapForPlayer(map)
    expect(projected.metadata?.capabilityPremonitions).toBeUndefined()
    expect(projected.metadata?.capabilityXRayObservations).toBeUndefined()
    expect(projected.metadata?.capabilityPsychicResidue).toBeUndefined()
    expect(projected.metadata?.capabilityIllusions).toBeUndefined()
    expect(projected.metadata?.capabilityTeleportRoundUses).toBeUndefined()
    expect(projected.metadata?.capabilityMegaEvolutionUses).toBeUndefined()
    expect(projected.encounterState?.capabilityRuntime).toEqual(createEmptyEncounterState().capabilityRuntime)
  })

  it('projects only source-effective bounded physical modes and omits unverifiable realtime state', () => {
    const encounter = createEmptyEncounterState()
    const sheet: CharacterSheet = {
      slug: 'actor-sheet', nickname: 'Balloon', species: 'Drifloon', level: 20,
      capabilities: { other: ['Inflatable'] },
    }
    const placement = {
      id: 'actor', sheetKind: 'pokemon' as const, sheetSlug: sheet.slug, position: { x: 1, y: 0, z: 1 },
    }
    const sheets = { pokemon: new Map([[sheet.slug, sheet]]), trainer: new Map() }
    const source = resolveEffectiveCapabilities({
      map: { schemaVersion: 2, slug: 'source', name: 'Source', revision: 1, dimensions: { x: 1, y: 1, z: 1 }, voxels: [], placements: [] },
      placement, sheet, sheets,
    }).instances.find(instance => instance.canonicalId === 'Inflatable')!
    const map = {
      schemaVersion: 2, id: 'map', slug: 'map', name: 'Map', revision: 1, updatedAt: 100,
      dimensions: { x: 4, y: 4, z: 4 }, groundLevelY: 0, voxels: [], placements: [placement],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'private-mode', actorPlacementId: 'actor', capabilityInstanceId: source.instanceId,
            canonicalId: 'Inflatable', mode: 'inflated', description: null, configurationId: 'private-choice',
            activatedAt: 50, expiresAt: null, sourceOperationId: 'private-operation',
          }, {
            id: 'stale-mode', actorPlacementId: 'actor', capabilityInstanceId: 'stale-instance',
            canonicalId: 'Inflatable', mode: 'shrunken', description: null, configurationId: null,
            activatedAt: 50, expiresAt: null, sourceOperationId: 'stale-operation',
          }],
        },
      },
    } as TabletopMap
    const unverifiable = projectCapabilityAutomationMapForPlayer(map)
    expect(unverifiable.metadata?.automationPresentationStates).toBeUndefined()
    const projected = projectCapabilityAutomationMapForPlayer(map, sheets)
    expect(projected.encounterState?.capabilityRuntime).toEqual(createEmptyEncounterState().capabilityRuntime)
    expect(projected.metadata?.automationPresentationStates).toEqual([expect.objectContaining({
      placementId: 'actor', state: 'inflated', label: 'Inflated',
    })])
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain('private-choice')
    expect(serialized).not.toContain(source.instanceId)
    expect(serialized).not.toContain('private-operation')
    expect(serialized).not.toContain('stale-operation')
  })

  it('projects only the bounded Living Weapon pairing needed for exact contextual Move menus', () => {
    const encounter = createEmptyEncounterState()
    const weaponSheet: CharacterSheet = {
      slug: 'honedge', nickname: 'Edge', species: 'Honedge', level: 20,
      capabilities: { other: ['Living Weapon'] },
    }
    const wielderSheet: CharacterSheet = {
      slug: 'wielder', nickname: 'Wielder', species: 'Machop', level: 20,
      skills: { combat: '4d6' },
    }
    const weaponPlacement = {
      id: 'weapon', sheetKind: 'pokemon' as const, sheetSlug: weaponSheet.slug,
      position: { x: 1, y: 0, z: 1 },
    }
    const wielderPlacement = {
      id: 'wielder', sheetKind: 'pokemon' as const, sheetSlug: wielderSheet.slug,
      position: { x: 1, y: 0, z: 1 },
    }
    const sheets = {
      pokemon: new Map([[weaponSheet.slug, weaponSheet], [wielderSheet.slug, wielderSheet]]),
      trainer: new Map(),
    }
    const source = resolveEffectiveCapabilities({
      map: { schemaVersion: 2, slug: 'source', name: 'Source', revision: 1, dimensions: { x: 1, y: 1, z: 1 }, voxels: [], placements: [] },
      placement: weaponPlacement, sheet: weaponSheet, sheets,
    }).instances.find(instance => instance.canonicalId === 'Living Weapon')!
    const map = {
      schemaVersion: 2, id: 'map', slug: 'map', name: 'Map', revision: 1, updatedAt: 100,
      dimensions: { x: 4, y: 4, z: 4 }, groundLevelY: 0, voxels: [],
      placements: [weaponPlacement, wielderPlacement],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'private-link-id', kind: 'living-weapon', ownerPlacementId: weaponPlacement.id,
            participantPlacementIds: [wielderPlacement.id], capabilityInstanceId: source.instanceId,
            canonicalId: 'Living Weapon', establishedAt: 50,
            configurationId: 'private-configuration', sourceOperationId: 'private-operation',
          }],
        },
      },
    } as TabletopMap

    const projected = projectCapabilityAutomationMapForPlayer(map, sheets)
    expect(projected.metadata?.automationPresentationStates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        placementId: 'weapon', state: 'living-weapon', counterpartPlacementId: 'wielder',
      }),
      expect.objectContaining({
        placementId: 'wielder', state: 'living-weapon-wielder', counterpartPlacementId: 'weapon',
      }),
    ]))
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain('private-link-id')
    expect(serialized).not.toContain('private-configuration')
    expect(serialized).not.toContain(source.instanceId)
    expect(serialized).not.toContain('private-operation')
  })

  it('projects source-effective weather forms without exposing Capability authority', () => {
    const sheet: CharacterSheet = { slug: 'cherrim', nickname: 'Petal', species: 'Cherrim', level: 20 }
    const map = {
      schemaVersion: 2, id: 'map', slug: 'map', name: 'Map', revision: 1, updatedAt: 100,
      dimensions: { x: 4, y: 4, z: 4 }, groundLevelY: 0, voxels: [],
      placements: [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 1, y: 0, z: 1 } }],
      fieldEffects: { weather: [{ kind: 'sunny' }] },
      encounterState: createEmptyEncounterState(),
    } as TabletopMap
    const projected = projectCapabilityAutomationMapForPlayer(map, {
      pokemon: new Map([[sheet.slug, sheet]]), trainer: new Map(),
    })
    expect(projected.metadata?.automationPresentationStates).toContainEqual(expect.objectContaining({
      placementId: 'actor', state: 'weather-form', description: 'Cherrim Sunshine Form',
    }))
    expect(projected.encounterState?.capabilityRuntime).toEqual(createEmptyEncounterState().capabilityRuntime)
  })

  it('redacts Pokémon and Trainer Capability ledgers from sheet and realtime projections', () => {
    const authority = {
      slug: 'trainer', name: 'Trainer', level: 10,
      capabilityUsage: { schemaVersion: 1, entries: [{ private: true }] },
      capabilityCampaignState: { private: true },
    }
    expect(redactSheetRecordForPlayer('trainer', authority)).not.toHaveProperty('capabilityUsage')
    expect(redactSheetUpdateForPlayer({ kind: 'trainer' as const, sheet: authority }).sheet).not.toHaveProperty('capabilityCampaignState')
    const event = redactRealtimeEventForPrincipal({
      type: 'updated', data: { kind: 'trainer', slug: 'trainer', sheet: authority },
    }, { role: 'player' }) as Record<string, unknown>
    expect(JSON.stringify(event)).not.toContain('capabilityUsage')
    expect(JSON.stringify(event)).not.toContain('capabilityCampaignState')
  })

  it('reconciles stale source-owned state with authoritative sheets before realtime projection', () => {
    const encounter = createEmptyEncounterState()
    const sheet: CharacterSheet = { slug: 'actor-sheet', nickname: 'Actor', species: 'Bulbasaur', level: 10 }
    const map = {
      schemaVersion: 2, id: 'map', slug: 'map', name: 'Map', revision: 1, updatedAt: 100,
      dimensions: { x: 4, y: 4, z: 4 }, groundLevelY: 0, voxels: [],
      placements: [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 1, y: 0, z: 1 } }],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'stale', actorPlacementId: 'actor', capabilityInstanceId: 'removed-source',
            canonicalId: 'Inflatable', mode: 'inflated', description: null, configurationId: null,
            activatedAt: 10, expiresAt: null, sourceOperationId: 'private-operation',
          }],
        },
      },
    } as TabletopMap
    const dependencies = {
      getSheet: (kind: string, slug: string) => kind === 'pokemon' && slug === sheet.slug
        ? { kind: 'pokemon', slug, sheet: sheet as unknown as Record<string, unknown> } : null,
    } as unknown as RealtimeEventAccessDependencies
    const event = redactRealtimeEventForPrincipal({
      type: 'updated', data: { slug: map.slug, document: map },
    }, { role: 'player' }, dependencies) as { data: { document: TabletopMap } }
    expect(event.data.document.metadata?.automationPresentationStates).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('removed-source')
  })

  it('applies the same Capability map redaction to realtime documents', () => {
    const map = {
      schemaVersion: 2, id: 'map', slug: 'map', name: 'Map', revision: 1, updatedAt: 100,
      dimensions: { x: 4, y: 4, z: 4 }, groundLevelY: 0, voxels: [], placements: [],
      metadata: { capabilityMegaEvolutionUses: [{ trainerSlug: 'secret' }] },
      encounterState: createEmptyEncounterState(),
    } as TabletopMap
    const event = redactRealtimeEventForPrincipal({
      type: 'updated', data: { slug: map.slug, document: map },
    }, { role: 'player' }) as Record<string, unknown>
    expect(JSON.stringify(event)).not.toContain('capabilityMegaEvolutionUses')
  })
})
