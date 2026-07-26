import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { resolveMovement } from '../../server/domain/movement/resolveMovement'

const slugify = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  conditions?: readonly string[]
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 25, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 80 }, atk: { added: 35 }, def: { added: 30 },
    satk: { added: 35 }, sdef: { added: 30 }, spd: { added: 35 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 250, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const completedTargetMove = {
  eventId: 'event.target.tackle.completed', sourceOperationId: 'op.target.tackle',
  resolutionId: 'resolution.target.tackle', canonicalId: 'Tackle', specVersion: 2,
  actorPlacementId: 'target', actionType: 'standard' as const,
  origin: { kind: 'direct' as const },
  moveListSource: { kind: 'placement' as const, placementId: 'target' },
  attackedTargetIds: ['actor'], hitTargetIds: ['actor'], outcome: 'hit' as const,
  succeeded: true, branches: [],
}
const battleMap = (input: {
  slug: string
  includeHistory?: boolean
  materialTags?: readonly string[]
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 4, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 16, y: 4, z: 16 }, groundLevelY: 0, playerVisible: true,
    voxels: input.materialTags ? [{
      x: 1, y: 0, z: 1, materialId: 'shallow_water', tags: [...input.materialTags],
    }] : [],
    hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
        ...(input.includeHistory ? { lastCompletedMoves: [completedTargetMove] } : {}),
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  ability: string
  includeHistory?: boolean
  materialTags?: readonly string[]
  targetConditions?: readonly string[]
  targetTypes?: readonly string[]
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input))
  for (const value of [
    sheet({ slug: 'actor', ability: input.ability }),
    sheet({ slug: 'target', conditions: input.targetConditions, types: input.targetTypes }),
  ]) sheetRepository.saveSetupSheet('pokemon', value.slug, value as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
type Dependencies = ReturnType<typeof setup>
const offer = (input: {
  dependencies: Dependencies
  slug: string
  ability: string
  modeId: string
}) => beginAbilityDeclarationUseCase({ role: 'gm', command: {
  schemaVersion: 1, requestId: `request:${input.slug}`,
  mapSlug: input.slug,
  baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
  actorPlacementId: 'actor', abilityInstanceId: `base:${slugify(input.ability)}`,
  canonicalId: input.ability, modeId: input.modeId,
} }, input.dependencies)
const execute = (input: {
  dependencies: Dependencies
  slug: string
  ability: string
  modeId: string
  targetId?: string
  valueIds?: Readonly<Record<string, string>>
}) => {
  const declaration = offer(input)
  const selections = declaration.declarations.map(offered => {
    const valueId = input.valueIds?.[offered.declarationId]
    const selected = input.targetId && offered.kind === 'token'
      ? offered.options.find(candidate => candidate.hint.kind === 'placement'
        && candidate.hint.placementId === input.targetId)
      : valueId
        ? offered.options.find(candidate => candidate.hint.kind !== 'none'
          && 'valueId' in candidate.hint && candidate.hint.valueId === valueId)
        : undefined
    if (offered.minSelections > 0 && !selected) {
      throw new Error(`Test did not select ${offered.declarationId}.`)
    }
    return {
      declarationId: offered.declarationId, kind: offered.kind,
      optionIds: selected ? [selected.optionId] : [],
    }
  })
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${input.slug}`, offerId: declaration.offerId,
    offerSha256: declaration.offerSha256, mapSlug: input.slug,
    baseRevision: declaration.mapRevision, actorPlacementId: 'actor',
    abilityInstanceId: `base:${slugify(input.ability)}`,
    canonicalId: input.ability, modeId: input.modeId, selections,
  } }, input.dependencies)
}
const savedSheet = (dependencies: Dependencies, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

describe('AA-079 activated abilities', () => {
  it('aa079.magnet-pull.reviewed issues weight-bounded plans and applies movement plus a range constraint atomically', () => {
    const dependencies = setup({ slug: 'aa079-magnet-pull', ability: 'Magnet Pull' })
    const declaration = offer({
      dependencies, slug: 'aa079-magnet-pull', ability: 'Magnet Pull', modeId: 'activate',
    })
    const plans = declaration.declarations.find(entry => entry.declarationId === 'activate.plan')
    expect(plans?.options.some(candidate => candidate.hint.kind === 'branch'
      && candidate.hint.valueId.includes(':max-5'))).toBe(true)
    expect(plans?.options.some(candidate => candidate.hint.kind === 'branch'
      && candidate.hint.valueId.includes(':max-6'))).toBe(false)
  })

  it('aa079.magnet-pull.reviewed moves the issued target and persists one reviewed constraint', () => {
    const dependencies = setup({ slug: 'aa079-magnet-pull-move', ability: 'Magnet Pull' })
    execute({
      dependencies, slug: 'aa079-magnet-pull-move', ability: 'Magnet Pull', modeId: 'activate',
      targetId: 'target',
      valueIds: { 'activate.plan': 'push-2-and-maximum-range:max-5' },
    })
    const map = dependencies.mapRepository.getBySlug('aa079-magnet-pull-move')!
    expect(map.placements.find(entry => entry.id === 'target')?.position.x).toBe(6)
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      affected: expect.objectContaining({ placementIds: ['target'] }),
      tags: expect.arrayContaining(['magnet-pull', 'magnet-pull-maximum']),
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 2 },
    }))
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Magnet Pull', limit: 3, spent: 1,
    }))
    const movementSheets = {
      pokemon: new Map(['actor', 'target'].map(slug => {
        const current = savedSheet(dependencies, slug)
        return [slug, {
          ...current,
          capabilities: { overland: 10, swim: 0, sky: 0, levitate: 0 },
        } as CharacterSheet]
      })),
      trainer: new Map(),
    }
    expect(resolveMovement({
      map, sheets: movementSheets, placementId: 'target', mode: 'shift',
      destination: { x: 8, y: 0, z: 1 },
    })).toMatchObject({ ok: false, reasonCode: 'movement-magnet-pull-maximum-range' })
    expect(resolveMovement({
      map, sheets: movementSheets, placementId: 'target', mode: 'shift',
      destination: { x: 5, y: 0, z: 1 },
    })).toMatchObject({ ok: true, reasonCode: 'movement-legal' })
  })

  it('aa079.magnet-pull.reviewed enforces its minimum range without blocking movement toward legality', () => {
    const dependencies = setup({ slug: 'aa079-magnet-pull-minimum', ability: 'Magnet Pull' })
    execute({
      dependencies, slug: 'aa079-magnet-pull-minimum', ability: 'Magnet Pull', modeId: 'activate',
      targetId: 'target', valueIds: { 'activate.plan': 'maximum-and-minimum-range' },
    })
    const map = dependencies.mapRepository.getBySlug('aa079-magnet-pull-minimum')!
    const movementSheets = {
      pokemon: new Map(['actor', 'target'].map(slug => [slug, {
        ...savedSheet(dependencies, slug),
        capabilities: { overland: 10, swim: 0, sky: 0, levitate: 0 },
      } as CharacterSheet])),
      trainer: new Map(),
    }
    expect(resolveMovement({
      map, sheets: movementSheets, placementId: 'target', mode: 'shift',
      destination: { x: 3, y: 0, z: 1 },
    })).toMatchObject({ ok: false, reasonCode: 'movement-magnet-pull-minimum-range' })
    expect(resolveMovement({
      map, sheets: movementSheets, placementId: 'target', mode: 'shift',
      destination: { x: 5, y: 0, z: 1 },
    })).toMatchObject({ ok: true, reasonCode: 'movement-legal' })
  })

  it('aa079.memory-wipe.reviewed derives Swift history and applies all three authoritative modes', () => {
    const swift = setup({ slug: 'aa079-memory-swift', ability: 'Memory Wipe', includeHistory: true })
    execute({
      dependencies: swift, slug: 'aa079-memory-swift', ability: 'Memory Wipe',
      modeId: 'swift', targetId: 'target',
    })
    expect(savedSheet(swift, 'target').combat?.conditions).toContain('Disabled: Tackle')
    expect(swift.mapRepository.getBySlug('aa079-memory-swift')!
      .encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)

    const noHistory = setup({ slug: 'aa079-memory-no-history', ability: 'Memory Wipe' })
    expect(() => offer({
      dependencies: noHistory, slug: 'aa079-memory-no-history',
      ability: 'Memory Wipe', modeId: 'swift',
    })).toThrow(/too few currently legal options/i)

    const standard = setup({ slug: 'aa079-memory-standard', ability: 'Memory Wipe' })
    execute({
      dependencies: standard, slug: 'aa079-memory-standard', ability: 'Memory Wipe',
      modeId: 'standard', targetId: 'target',
    })
    expect(savedSheet(standard, 'target').combat?.conditions)
      .toEqual(expect.arrayContaining(['Flinch', 'Paralysis']))
    expect(standard.mapRepository.getBySlug('aa079-memory-standard')!
      .encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)

    const extended = setup({ slug: 'aa079-memory-extended', ability: 'Memory Wipe' })
    execute({
      dependencies: extended, slug: 'aa079-memory-extended', ability: 'Memory Wipe',
      modeId: 'extended', targetId: 'target',
      valueIds: { 'extended.minutes': 'minutes-7' },
    })
    const map = extended.mapRepository.getBySlug('aa079-memory-extended')!
    expect(map.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Memory Wipe', targetPlacementIds: ['target'],
      payload: { kind: 'mark', markId: 'aa079.memory-wipe.erased-7-minutes-within-30' },
    }))
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Memory Wipe', limit: 1, spent: 1,
    }))
  })

  it('aa079.mimicry.reviewed offers only server-derived field types and applies a scene type overlay', () => {
    const dependencies = setup({
      slug: 'aa079-mimicry', ability: 'Mimicry', materialTags: ['freshwater'],
    })
    const declaration = offer({
      dependencies, slug: 'aa079-mimicry', ability: 'Mimicry', modeId: 'activate',
    })
    const types = declaration.declarations[0]?.options.flatMap(candidate => (
      candidate.hint.kind === 'type' ? [candidate.hint.valueId] : []
    ))
    expect(types).toEqual(['water'])
  })

  it('aa079.mimicry.reviewed pays Free/Scene and persists the selected type only', () => {
    const dependencies = setup({
      slug: 'aa079-mimicry-resolve', ability: 'Mimicry', materialTags: ['freshwater'],
    })
    execute({
      dependencies, slug: 'aa079-mimicry-resolve', ability: 'Mimicry', modeId: 'activate',
      valueIds: { 'activate.type': 'water' },
    })
    const map = dependencies.mapRepository.getBySlug('aa079-mimicry-resolve')!
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay', affected: expect.objectContaining({ placementIds: ['actor'] }),
      duration: { kind: 'scene', remaining: null },
      payload: expect.objectContaining({ domain: 'type', action: 'replace', values: ['water'] }),
    }))
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Mimicry', limit: 1, spent: 1,
    }))
  })
})
