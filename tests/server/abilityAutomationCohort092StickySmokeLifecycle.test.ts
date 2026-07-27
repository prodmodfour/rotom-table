import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone, type EncounterZoneSource } from '#shared/moveAutomation/encounterZones'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { planInitiativeLifecycle } from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import { AA092_STICKY_SMOKE_REASON } from '~~/server/domain/abilityAutomation/mechanics/aa085to100LifecycleIntegration'
import { REMAINING_ABILITY_TEST_REGISTRY } from '../fixtures/abilityAutomation/remainingRegistry'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})

const sheet = (slug: string, abilities: readonly string[] = []): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  abilities: abilities.map(ability),
  stats: {
    hp: { added: 20 }, atk: { added: 10 }, def: { added: 10 },
    satk: { added: 10 }, sdef: { added: 10 }, spd: { added: 10 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 80, injuries: 0, conditions: [] },
})

const placement = (
  id: string,
  x: number,
  sideId: 'heroes' | 'foes',
  initiative: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  sideId,
  position: { x, y: 0, z: 1 },
  initiative,
})

const stickyZone = (source: EncounterZoneSource, id = source.kind === 'legacy-map'
  ? `legacy.${source.lane}.${source.key}`
  : 'zone.sticky-smoke.one') => parseEncounterZone({
  id,
  kind: 'hazard',
  source,
  sideId: 'foes',
  geometry: { kind: 'cells', cells: [{ x: 2, y: 0, z: 1 }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'replace', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['hazard', 'smoke', 'sticky-smoke'],
  payload: {
    familyId: 'hazard.smoke.sticky',
    hazardId: 'smoke',
    charges: null,
    maxCharges: null,
  },
})

const fixture = (input: {
  readonly targetAbilities?: readonly string[]
  readonly zones?: readonly ReturnType<typeof stickyZone>[]
}) => {
  const source = placement('source', 0, 'foes', 10)
  const sourceB = placement('source-b', 4, 'foes', 3)
  const target = placement('target', 2, 'heroes', 5)
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: 'sticky-smoke-lifecycle',
    name: 'Sticky Smoke lifecycle',
    revision: 5,
    dimensions: { x: 8, y: 4, z: 5 },
    groundLevelY: 0,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [source, target, sourceB],
    initiative: { activeId: 'source', round: 1 },
    encounterState: {
      ...createEmptyEncounterState(),
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      zones: [...(input.zones ?? [stickyZone({
        kind: 'operation',
        operationId: 'smokescreen.hazard',
        moveId: 'smokescreen',
        placementId: 'source',
      })])],
    },
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['source', sheet('source')],
    ['source-b', sheet('source-b')],
    ['target', sheet('target', input.targetAbilities)],
  ])
  const result = planInitiativeLifecycle({
    map,
    previous: { activeId: 'source', round: 1 },
    current: { activeId: 'target', round: 1 },
    orderIds: ['source', 'target', 'source-b'],
    operationId: 'op_sticky_smoke_boundary',
    time: 3_000,
    abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    loadSheets: () => ({
      pokemonSheets,
      trainerSheets: new Map<string, TrainerSheet>(),
    }),
  })
  return { result }
}

describe('AA-092 Sticky Smoke lifecycle provenance', () => {
  it('lowers Accuracy from the exact native zone operation owner at turn start', () => {
    const { result } = fixture({})
    expect(result.reduction.operations).toContainEqual(expect.objectContaining({
      kind: 'combat-stage',
      reasonCode: AA092_STICKY_SMOKE_REASON,
      source: { kind: 'lifecycle-event', id: expect.stringContaining('turn-start') },
    }))
    const write = result.sheetWrites.find(candidate => candidate.slug === 'target')
    expect((write?.nextSheet as CharacterSheet).combatStages?.acc).toBe(-1)
    expect(result.sheetWrites[0]?.changedFields).toContain('combatStages')
  })

  it('aggregates distinct accepted native Sticky Smoke zones at the same boundary', () => {
    const { result } = fixture({
      zones: [
        stickyZone({
          kind: 'operation', operationId: 'smokescreen.one',
          moveId: 'smokescreen', placementId: 'source',
        }, 'zone.sticky-smoke.one'),
        stickyZone({
          kind: 'operation', operationId: 'smokescreen.two',
          moveId: 'smokescreen', placementId: 'source-b',
        }, 'zone.sticky-smoke.two'),
      ],
    })
    expect(result.reduction.operations.filter(operation => (
      operation.reasonCode === AA092_STICKY_SMOKE_REASON
    ))).toHaveLength(2)
    const write = result.sheetWrites.find(candidate => candidate.slug === 'target')
    expect((write?.nextSheet as CharacterSheet).combatStages?.acc).toBe(-2)
  })

  it('lets source-aware White Smoke and Clear Body prevent an enemy-authored drop', () => {
    expect(REMAINING_ABILITY_TEST_REGISTRY.resolve('White Smoke')).not.toBeNull()
    for (const canonicalId of ['Clear Body', 'White Smoke']) {
      const { result } = fixture({ targetAbilities: [canonicalId] })
      expect(result.sheetWrites).toEqual([])
      expect(result.reduction.operations).toContainEqual(expect.objectContaining({
        reasonCode: AA092_STICKY_SMOKE_REASON,
      }))
    }
  })

  it('does not invent ability ownership for query-only legacy-map zones', () => {
    const { result } = fixture({
      zones: [stickyZone({ kind: 'legacy-map', lane: 'hazards', key: 'legacy-smoke' })],
    })
    expect(result.reduction.operations.some(operation => (
      operation.reasonCode === AA092_STICKY_SMOKE_REASON
    ))).toBe(false)
    expect(result.sheetWrites).toEqual([])
  })
})
