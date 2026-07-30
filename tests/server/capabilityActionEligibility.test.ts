import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CapabilityModeKind } from '#shared/capabilityAutomation/state'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import {
  capabilityStandardActionRestriction,
} from '../../server/domain/capabilityAutomation/actionEligibility'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'

const placement: SheetPlacement = {
  id: 'actor',
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  position: { x: 1, y: 1, z: 1 },
}

const sheet: CharacterSheet = {
  slug: 'actor',
  species: 'Gastly',
  level: 20,
  capabilities: { other: ['Phasing', 'Shadow Meld', 'Shrinkable', 'Illusionist'] },
}

const baseMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  revision: 1,
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  placements: [placement],
  voxels: [],
  encounterState: createEmptyEncounterState(),
} as TabletopMap)

const mapWithMode = (
  mode: CapabilityModeKind,
  canonicalId: 'Phasing' | 'Shadow Meld' | 'Shrinkable' | 'Illusionist',
  configurationId: string | null = null,
  expiresAt: number | null = null,
): TabletopMap => {
  const map = baseMap()
  const instance = resolveEffectiveCapabilities({
    map,
    placement,
    sheet,
    sheets: { pokemon: new Map([[sheet.slug, sheet]]), trainer: new Map() },
  }).instances.find(candidate => candidate.effective && candidate.canonicalId === canonicalId)!
  return {
    ...map,
    encounterState: {
      ...map.encounterState!,
      capabilityRuntime: {
        ...map.encounterState!.capabilityRuntime!,
        modes: [{
          id: `mode:${mode}`,
          actorPlacementId: placement.id,
          capabilityInstanceId: instance.instanceId,
          canonicalId,
          mode,
          description: null,
          configurationId,
          activatedAt: 1,
          expiresAt,
          sourceOperationId: `operation:${mode}`,
        }],
      },
    },
  }
}

const restriction = (map: TabletopMap, allowShrunkenRestore = false) => (
  capabilityStandardActionRestriction({
    map,
    placement,
    sheet,
    pokemonSheets: new Map([[sheet.slug, sheet]]),
    trainerSheets: new Map(),
    now: 100,
    allowShrunkenRestore,
  })
)

describe('Capability action eligibility', () => {
  it.each([
    ['intangible', 'Phasing', null, 'intangible-standard-action-blocked'],
    ['shadow-melded', 'Shadow Meld', null, 'shadow-meld-standard-action-blocked'],
    ['shrunken', 'Shrinkable', null, 'shrunken-standard-action-blocked'],
    ['illusion', 'Illusionist', 'size-mm:500x500x500;motion:major', 'illusion-standard-action-reserved'],
  ] as const)('blocks Standard actions for an effective %s mode', (mode, canonicalId, configurationId, code) => {
    expect(restriction(mapWithMode(mode, canonicalId, configurationId))).toMatchObject({ code })
  })

  it('allows only the explicit Shrinkable restore exception and ignores expired or source-lost modes', () => {
    expect(restriction(mapWithMode('shrunken', 'Shrinkable'), true)).toBeNull()
    expect(restriction(mapWithMode('intangible', 'Phasing', null, 99))).toBeNull()

    const sourceLostSheet = { ...sheet, species: 'Pikachu', capabilities: { other: [] } }
    const map = mapWithMode('intangible', 'Phasing')
    expect(capabilityStandardActionRestriction({
      map,
      placement,
      sheet: sourceLostSheet,
      pokemonSheets: new Map([[sourceLostSheet.slug, sourceLostSheet]]),
      trainerSheets: new Map(),
      now: 100,
    })).toBeNull()
  })
})
