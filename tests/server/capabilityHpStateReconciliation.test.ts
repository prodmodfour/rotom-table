import { describe, expect, it } from 'vitest'
import { hasEffectiveCapability } from '#shared/capabilityAutomation/effective'
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import {
  CapabilityHpStateReconciliationError,
  capabilityHpSheetKey,
  reconcileCapabilityHpState,
  type CapabilityHpStateSheet,
} from '~~/server/domain/capabilityAutomation/reconcileHpState'
import { resolveEffectiveCapabilities } from '~~/server/domain/capabilityAutomation/effectiveCapabilities'

const placement = (
  id: string,
  slug: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  position: { x, y: 0, z: 0 },
})

const pokemon = (input: {
  readonly slug: string
  readonly species?: string
  readonly hp: number
  readonly injuries?: number
  readonly capabilities?: readonly string[]
  readonly revision?: number
}): CapabilityHpStateSheet => ({
  kind: 'pokemon',
  slug: input.slug,
  revision: input.revision ?? 1,
  sheet: {
    slug: input.slug,
    species: input.species ?? 'Pikachu',
    level: 20,
    capabilities: input.capabilities ? { other: [...input.capabilities] } : undefined,
    combat: {
      currentHp: input.hp,
      injuries: input.injuries ?? 0,
      conditions: [],
    },
    movelist: [],
    revision: input.revision ?? 1,
  } as CharacterSheet,
})

const mapDocument = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly encounterState?: EncounterState
  readonly temporaryHp?: Readonly<Record<string, number>>
}): TabletopMap => {
  const activeScene = { name: 'Battle', startedAt: 100 }
  return {
    schemaVersion: 2,
    slug: 'arena',
    name: 'Arena',
    folder: '',
    revision: 4,
    dimensions: { x: 8, y: 2, z: 8 },
    playerVisible: true,
    voxels: [],
    placements: [...input.placements],
    lights: [],
    initiative: { activeId: null, round: 1 },
    activeScene,
    encounterState: input.encounterState ?? createEmptyEncounterState(),
    ...(input.temporaryHp
      ? { temporaryHitPoints: { scene: activeScene, byPlacementId: { ...input.temporaryHp } } }
      : {}),
  }
}

const sheetMap = (...sheets: readonly CapabilityHpStateSheet[]) => new Map(
  sheets.map(sheet => [capabilityHpSheetKey(sheet.kind, sheet.slug), sheet]),
)

const hpOf = (
  result: ReturnType<typeof reconcileCapabilityHpState>,
  slug: string,
): number | undefined => (
  (result.sheets.get(`pokemon:${slug}`)?.sheet as CharacterSheet | undefined)?.combat?.currentHp
)

const asOneFixture = (exactSource = true) => {
  const ownerPlacement = placement('owner-token', 'calyrex', 0)
  const mountPlacement = placement('mount-token', 'glastrier', 1)
  const owner = pokemon({ slug: 'calyrex', hp: 40, capabilities: ['As One'] })
  const mount = pokemon({ slug: 'glastrier', species: 'Glastrier', hp: 40 })
  const emptyMap = mapDocument({ placements: [ownerPlacement, mountPlacement] })
  const source = resolveEffectiveCapabilities({
    map: emptyMap,
    placement: ownerPlacement,
    sheet: owner.sheet,
  }).instances.find(instance => instance.canonicalId === 'As One' && instance.effective)
  if (!source) throw new Error('As One test source was not effective')
  const encounter = createEmptyEncounterState()
  const map = mapDocument({
    placements: [ownerPlacement, mountPlacement],
    encounterState: {
      ...encounter,
      capabilityRuntime: {
        ...encounter.capabilityRuntime!,
        links: [{
          id: 'as-one-link',
          kind: 'as-one-mount',
          ownerPlacementId: ownerPlacement.id,
          participantPlacementIds: [mountPlacement.id],
          capabilityInstanceId: exactSource ? source.instanceId : `${source.instanceId}:stale`,
          canonicalId: 'As One',
          configurationId: 'Chilling Neigh',
          establishedAt: 100,
          sourceOperationId: 'as-one-operation',
        }],
      },
    },
  })
  return { map, ownerPlacement, mountPlacement, owner, mount }
}

describe('central Capability HP state reconciliation', () => {
  it('propagates fainting through only the exact effective As One source', () => {
    for (const exactSource of [true, false]) {
      const fixture = asOneFixture(exactSource)
      const projectedOwner = pokemon({ slug: 'calyrex', hp: 0, capabilities: ['As One'] })
      const result = reconcileCapabilityHpState({
        previousMap: fixture.map,
        nextMap: fixture.map,
        previousSheets: sheetMap(fixture.owner, fixture.mount),
        sheets: sheetMap(projectedOwner, fixture.mount),
        touchedPlacementIds: new Set([fixture.ownerPlacement.id]),
      })

      expect(hpOf(result, 'calyrex')).toBe(0)
      expect(hpOf(result, 'glastrier')).toBe(exactSource ? 0 : 40)
      expect(result.consultedSheetKeys).toContain('pokemon:calyrex')
      if (exactSource) expect(result.consultedSheetKeys).toContain('pokemon:glastrier')
    }
  })

  it('drops exact physical Power loads atomically when their carrier faints', () => {
    const token = placement('lifter-token', 'lifter', 0)
    const healthyBase = pokemon({ slug: 'lifter', hp: 20 })
    const faintedBase = pokemon({ slug: 'lifter', hp: 0 })
    const healthy: CapabilityHpStateSheet = {
      ...healthyBase, sheet: { ...healthyBase.sheet, capabilities: { power: 4 } } as CharacterSheet,
    }
    const fainted: CapabilityHpStateSheet = {
      ...faintedBase, sheet: { ...faintedBase.sheet, capabilities: { power: 4 } } as CharacterSheet,
    }
    const base = mapDocument({ placements: [token] })
    const source = resolveEffectiveCapabilities({
      map: base, placement: token, sheet: healthy.sheet,
    }).instances.find(instance => instance.canonicalId === 'Power')!
    const loaded = {
      ...base,
      metadata: { capabilityObjects: [{
        id: 'crate', pounds: 45, position: token.position,
        attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
        attachedCapabilityInstanceId: source.instanceId, attachedToPlacementId: token.id,
        physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
        physicalLoadLastCheckRound: null,
      }] },
    } as TabletopMap
    const result = reconcileCapabilityHpState({
      previousMap: loaded,
      nextMap: loaded,
      previousSheets: sheetMap(healthy),
      sheets: sheetMap(fainted),
      touchedPlacementIds: new Set([token.id]),
    })
    const object = result.nextMap.metadata?.capabilityObjects?.[0] as Record<string, unknown>
    expect(object).toMatchObject({ id: 'crate', pounds: 45, position: token.position })
    expect(object.attachmentKind).toBeUndefined()
    expect(object.attachedCapabilityInstanceId).toBeUndefined()
  })

  it('rejects new Temporary HP and cleans legacy injuries and Temporary HP for effective Soulless', () => {
    const token = placement('shedinja-token', 'shedinja', 0)
    const soulless = pokemon({ slug: 'shedinja', species: 'Shedinja', hp: 1, injuries: 4 })
    const previousMap = mapDocument({ placements: [token], temporaryHp: { [token.id]: 3 } })
    const grantingMap = mapDocument({ placements: [token], temporaryHp: { [token.id]: 8 } })

    expect(() => reconcileCapabilityHpState({
      previousMap,
      nextMap: grantingMap,
      sheets: sheetMap(soulless),
      touchedPlacementIds: new Set([token.id]),
    })).toThrow(expect.objectContaining<Partial<CapabilityHpStateReconciliationError>>({
      code: 'soulless-temporary-hp',
    }))

    const result = reconcileCapabilityHpState({
      previousMap,
      nextMap: previousMap,
      sheets: sheetMap(soulless),
      touchedPlacementIds: new Set([token.id]),
    })
    expect(hpOf(result, 'shedinja')).toBe(1)
    expect((result.sheets.get('pokemon:shedinja')?.sheet as CharacterSheet).combat?.injuries).toBe(0)
    expect(result.nextMap.temporaryHitPoints).toBeUndefined()
  })

  it('honors encounter suppression when applying Soulless HP authority', () => {
    const token = placement('shedinja-token', 'shedinja', 0)
    const soulless = pokemon({ slug: 'shedinja', species: 'Shedinja', hp: 10, injuries: 2 })
    const encounter = createEmptyEncounterState()
    const suppression = parseEncounterEffect({
      id: 'suppress-soulless',
      kind: 'capability',
      source: { operationId: 'suppress-operation', moveId: 'test.suppression', placementId: token.id },
      affected: { placementIds: [token.id], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['capability-suppression'],
      payload: { capabilityId: 'soulless', action: 'suppress' },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'expire',
      suppression: { sources: [] },
    })
    const previousMap = mapDocument({
      placements: [token],
      encounterState: { ...encounter, effects: [suppression] },
    })
    const nextMap = mapDocument({
      placements: [token],
      encounterState: { ...encounter, effects: [suppression] },
      temporaryHp: { [token.id]: 5 },
    })
    const effective = resolveEffectiveCapabilities({
      map: nextMap,
      placement: token,
      sheet: soulless.sheet,
    })
    expect(hasEffectiveCapability(effective, 'Soulless')).toBe(false)

    const result = reconcileCapabilityHpState({
      previousMap,
      nextMap,
      sheets: sheetMap(soulless),
      touchedPlacementIds: new Set([token.id]),
    })
    expect(hpOf(result, 'shedinja')).toBe(10)
    expect((result.sheets.get('pokemon:shedinja')?.sheet as CharacterSheet).combat?.injuries).toBe(2)
    expect(result.nextMap.temporaryHitPoints?.byPlacementId[token.id]).toBe(5)
  })

  it('ends Crowned mode when a touched owner began fainted even if the same plan heals it', () => {
    const token = placement('zacian-token', 'zacian', 0)
    const fainted = pokemon({ slug: 'zacian', species: 'Zacian', hp: 0, capabilities: ['Weapon Bond'] })
    const healed = pokemon({ slug: 'zacian', species: 'Zacian', hp: 20, capabilities: ['Weapon Bond'] })
    const emptyMap = mapDocument({ placements: [token] })
    const weaponBond = resolveEffectiveCapabilities({
      map: emptyMap,
      placement: token,
      sheet: healed.sheet,
    }).instances.find(instance => instance.canonicalId === 'Weapon Bond' && instance.effective)
    if (!weaponBond) throw new Error('Weapon Bond test source was not effective')
    const encounter = createEmptyEncounterState()
    const map = mapDocument({
      placements: [token],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'crowned-mode',
            actorPlacementId: token.id,
            capabilityInstanceId: weaponBond.instanceId,
            canonicalId: 'Weapon Bond',
            mode: 'crowned',
            description: null,
            configurationId: null,
            activatedAt: 100,
            expiresAt: null,
            sourceOperationId: 'crowned-operation',
          }],
        },
      },
    })

    const result = reconcileCapabilityHpState({
      previousMap: map,
      nextMap: map,
      previousSheets: sheetMap(fainted),
      sheets: sheetMap(healed),
      touchedPlacementIds: new Set([token.id]),
    })
    expect(hpOf(result, 'zacian')).toBe(20)
    expect(result.nextMap.encounterState?.capabilityRuntime?.modes).toEqual([])
  })
})
