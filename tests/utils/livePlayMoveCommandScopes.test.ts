import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseAbilityEntityState } from '#shared/abilityAutomation/entities'
import { buildResolveMoveScopes, LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT } from '~/utils/livePlayMoveCommandScopes'
import type { LivePlayScope } from '#shared/livePlayCommands'
import type { SheetPlacement, TabletopMap } from '~/types/map'

const placement = (
  id: string,
  sheetSlug = id,
  sheetKind: SheetPlacement['sheetKind'] = 'pokemon',
): SheetPlacement => ({
  id,
  sheetKind,
  sheetSlug,
  position: { x: 0, y: 0, z: 0 },
  facing: 'south-east',
  turned: false,
})

const mapFixture = (placements: readonly SheetPlacement[] = [
  placement('actor', 'pikachu'),
  placement('target-a', 'bulbasaur'),
  placement('target-b', 'charmander'),
  placement('bystander', 'eevee'),
]): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  revision: 7,
  dimensions: { x: 8, y: 2, z: 8 },
  voxels: [],
  placements: placements.map((item) => ({ ...item, position: { ...item.position } })),
  lights: [],
})

const intent = (selection: ResolveMoveIntent['selection'], overrides: Partial<ResolveMoveIntent> = {}): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor',
  moveName: 'Thunderbolt',
  selection,
  ...overrides,
})

const scopeKey = (scope: LivePlayScope): string => {
  if (scope.kind === 'map') return `map:${scope.lane}`
  if (scope.kind === 'token') return `token:${scope.placementId}:${scope.field}`
  if (scope.kind === 'groupInventory') {
    return `groupInventory:${scope.slug}:${scope.field}`
  }
  return `sheet:${scope.sheetKind}:${scope.sheetSlug}:${scope.field}`
}

const keys = (scopes: readonly LivePlayScope[]): string[] => scopes.map(scopeKey)

const expectScopes = (scopes: readonly LivePlayScope[], expected: readonly string[]) => {
  expect(keys(scopes)).toEqual(expect.arrayContaining([...expected]))
}

describe('buildResolveMoveScopes', () => {
  it('builds conservative self-move scopes for actor state, backing sheet, and map side effects', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'self' }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor'])
    expectScopes(result.scopes, [
      'token:actor:action',
      'token:actor:moveUsage',
      'token:actor:hp',
      'token:actor:combatStages',
      'token:actor:conditions',
      'token:actor:position',
      'token:actor:facing',
      'sheet:pokemon:pikachu:moveUsage',
      'sheet:pokemon:pikachu:hp',
      'sheet:pokemon:pikachu:combatStages',
      'sheet:pokemon:pikachu:conditions',
      'map:metadata',
      'map:hazards',
      'map:fieldEffects',
    ])
    expect(keys(result.scopes)).not.toContain('map:placements')
  })

  it('can conservatively scope a no-target field declaration to every server-validated placement', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'self' }, { moveName: 'Haze' }),
      candidateScopePlacementIds: ['bystander', 'target-b', 'target-a'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor', 'target-a', 'target-b', 'bystander'])
    expectScopes(result.scopes, [
      'token:target-a:combatStages',
      'token:target-b:combatStages',
      'token:bystander:combatStages',
    ])
  })

  it('adds only explicit reviewed group inventory scopes and validates their identities', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'self' }),
      groupInventorySlugs: ['main', 'party-reserve'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(keys(result.scopes)).toEqual(expect.arrayContaining([
      'groupInventory:main:inventory',
      'groupInventory:party-reserve:inventory',
    ]))

    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'self' }),
      groupInventorySlugs: ['main', 'main'],
    })).toMatchObject({ ok: false, message: expect.stringContaining('more than once') })
    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'self' }),
      groupInventorySlugs: ['Party Bag'],
    })).toMatchObject({ ok: false, message: expect.stringContaining('valid resource slug') })
  })

  it('includes single-target token and backing sheet effect scopes', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'single-target', targetPlacementId: 'target-a' }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor', 'target-a'])
    expectScopes(result.scopes, [
      'token:target-a:hp',
      'token:target-a:combatStages',
      'token:target-a:conditions',
      'token:target-a:position',
      'sheet:pokemon:bulbasaur:hp',
      'sheet:pokemon:bulbasaur:combatStages',
      'sheet:pokemon:bulbasaur:conditions',
    ])
    expect(keys(result.scopes)).not.toContain('token:target-a:moveUsage')
  })

  it('maps reviewed targetable ability entities to their owner scope without trusting a synthetic sheet or token scope', () => {
    const map = mapFixture()
    map.encounterState = {
      ...createEmptyEncounterState(),
      abilityEntities: parseAbilityEntityState({
        schemaVersion: 1,
        entries: [{
          entityId: 'ability.mini-nose.target-a.1', kind: 'subordinate',
          labelKey: 'ability.mini-noses.entity', ownerPlacementId: 'target-a',
          sourceAbilityInstanceId: 'base:mini-noses', canonicalId: 'Mini-Noses',
          sourceOperationId: 'op.mini-noses', controller: { kind: 'source-controller', id: 'target-a' },
          sideId: null, position: { x: 2, y: 0, z: 1 }, base: 1, clearance: 1,
          occupancy: 'non-blocking', targetability: 'targetable', movementMode: 'controlled',
          movementSpeed: 4, maximumHp: 20, currentHp: 20, damageReduction: 0,
          duration: { kind: 'source-presence' }, tags: ['aa080', 'aa080.mini-nose'],
          payload: { kind: 'subordinate', templateId: 'template.mini-nose', initiativePolicy: 'none' },
          version: 1, createdOperationId: 'op.mini-noses', lastOperationId: 'op.mini-noses',
        }],
        receipts: [],
      }),
    }
    const result = buildResolveMoveScopes({
      map,
      intent: intent({ kind: 'single-target', targetPlacementId: 'ability.mini-nose.target-a.1' }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor', 'target-a'])
    expectScopes(result.scopes, ['sheet:pokemon:bulbasaur:hp', 'map:metadata'])
    expect(keys(result.scopes).some(key => key.startsWith('token:ability.mini-nose.'))).toBe(false)
  })

  it('includes every selected target-count placement in map order', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'target-count', targetPlacementIds: ['target-b', 'target-a'] }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor', 'target-a', 'target-b'])
    expectScopes(result.scopes, [
      'token:target-a:hp',
      'token:target-b:hp',
      'sheet:pokemon:bulbasaur:conditions',
      'sheet:pokemon:charmander:conditions',
    ])
  })

  it('includes all supplied area candidates before Friendly exclusions without changing the intent', () => {
    const moveIntent = intent({
      kind: 'area',
      areaTemplateId: 'burst-1',
      excludedTargetPlacementIds: ['target-b'],
    })
    const before = JSON.stringify(moveIntent)

    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: moveIntent,
      candidateScopePlacementIds: ['target-b', 'bystander', 'target-a'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor', 'target-a', 'target-b', 'bystander'])
    expectScopes(result.scopes, [
      'token:target-a:hp',
      'token:target-b:hp',
      'token:bystander:hp',
    ])
    expect(JSON.stringify(moveIntent)).toBe(before)
    expect(moveIntent.selection).not.toHaveProperty('candidateScopePlacementIds')
  })

  it('allows zero-candidate area scopes', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'area', areaTemplateId: 'burst-1' }),
      candidateScopePlacementIds: [],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scopePlacementIds).toEqual(['actor'])
  })

  it('deduplicates shared backing sheets and duplicate scope identities deterministically', () => {
    const result = buildResolveMoveScopes({
      map: mapFixture([
        placement('actor', 'shared'),
        placement('target-a', 'shared'),
        placement('target-b', 'shared'),
      ]),
      intent: intent({ kind: 'target-count', targetPlacementIds: ['target-a', 'target-b'] }),
      candidateScopePlacementIds: ['actor', 'target-a'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const resultKeys = keys(result.scopes)
    expect(resultKeys).toHaveLength(new Set(resultKeys).size)
    expect(resultKeys.filter((key) => key === 'sheet:pokemon:shared:hp')).toHaveLength(1)
    expect(resultKeys.filter((key) => key === 'sheet:pokemon:shared:moveUsage')).toHaveLength(1)
    expect(result.scopePlacementIds).toEqual(['actor', 'target-a', 'target-b'])
  })

  it('rejects missing actor, explicit target, missing candidate, and unrelated non-area candidates', () => {
    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'self' }, { placementId: 'missing-actor' }),
    })).toMatchObject({ ok: false, message: expect.stringContaining('Actor placement missing-actor') })

    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'single-target', targetPlacementId: 'missing-target' }),
    })).toMatchObject({ ok: false, message: expect.stringContaining('Target placement missing-target') })

    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'area', areaTemplateId: 'burst-1' }),
      candidateScopePlacementIds: ['missing-candidate'],
    })).toMatchObject({ ok: false, message: expect.stringContaining('Candidate scope placement missing-candidate') })

    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'single-target', targetPlacementId: 'target-a' }),
      candidateScopePlacementIds: ['bystander'],
    })).toMatchObject({ ok: false, message: expect.stringContaining('not related') })
  })

  it('rejects duplicate or blank candidate ids before dispatch scope construction', () => {
    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'area', areaTemplateId: 'burst-1' }),
      candidateScopePlacementIds: ['target-a', ' target-a '],
    })).toMatchObject({ ok: false, message: expect.stringContaining('more than once') })

    expect(buildResolveMoveScopes({
      map: mapFixture(),
      intent: intent({ kind: 'area', areaTemplateId: 'burst-1' }),
      candidateScopePlacementIds: [''],
    })).toMatchObject({ ok: false, message: expect.stringContaining('non-empty string') })
  })

  it('rejects scope-count overflow rather than truncating conservative coverage', () => {
    const candidates = Array.from({ length: 20 }, (_unused, index) => placement(`candidate-${index}`, `sheet-${index}`))
    const result = buildResolveMoveScopes({
      map: mapFixture([placement('actor', 'actor-sheet'), ...candidates]),
      intent: intent({ kind: 'area', areaTemplateId: 'burst-2' }),
      candidateScopePlacementIds: candidates.map((item) => item.id),
    })

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining(`exceeding the limit of ${LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT}`),
    })
  })

  it('does not mutate the input map, intent, or candidate array', () => {
    const map = mapFixture()
    const moveIntent = intent({ kind: 'single-target', targetPlacementId: 'target-a' })
    const candidates = ['actor', 'target-a'] as const
    const beforeMap = JSON.stringify(map)
    const beforeIntent = JSON.stringify(moveIntent)
    const beforeCandidates = JSON.stringify(candidates)

    buildResolveMoveScopes({ map, intent: moveIntent, candidateScopePlacementIds: candidates })

    expect(JSON.stringify(map)).toBe(beforeMap)
    expect(JSON.stringify(moveIntent)).toBe(beforeIntent)
    expect(JSON.stringify(candidates)).toBe(beforeCandidates)
  })
})
