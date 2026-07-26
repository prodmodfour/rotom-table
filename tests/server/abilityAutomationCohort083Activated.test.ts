import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { hashAbilityDeclarationIntent } from '../../server/domain/abilityAutomation/declarationIntent'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${id(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (canonicalId: string): CharacterSheet => ({
  slug: 'actor',
  nickname: 'actor',
  species: 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: [ability(canonicalId)],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combat: { currentHp: 100, injuries: 2, conditions: [] },
})
const map = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2,
    slug,
    name: slug,
    revision: 5,
    dimensions: { x: 10, y: 4, z: 10 },
    groundLevelY: 0,
    voxels: [], hazards: [],
    placements: [{
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes',
      position: { x: 2, y: 0, z: 2 },
    }],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1 },
    },
    activeScene: { name: 'Scene', startedAt: 100 },
    metadata: {},
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (slug: string, canonicalId: string) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(map(slug))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet(canonicalId) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1000 }
}
const offer = (
  dependencies: ReturnType<typeof setup>,
  slug: string,
  canonicalId: string,
  suffix = 'activate',
) => (
  beginAbilityDeclarationUseCase({
    role: 'gm',
    command: {
      schemaVersion: 1,
      requestId: `request:${slug}:${suffix}`,
      mapSlug: slug,
      baseRevision: 5,
      actorPlacementId: 'actor',
      abilityInstanceId: `base:${id(canonicalId)}`,
      canonicalId,
      modeId: 'activate',
    },
  }, dependencies)
)
const intentFor = (input: {
  offer: ReturnType<typeof offer>
  slug: string
  canonicalId: string
  suffix: string
}) => ({
  schemaVersion: 1 as const,
  intentId: `intent:${input.slug}:${input.suffix}`,
  offerId: input.offer.offerId,
  offerSha256: input.offer.offerSha256,
  mapSlug: input.slug,
  baseRevision: input.offer.mapRevision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${id(input.canonicalId)}`,
  canonicalId: input.canonicalId,
  modeId: 'activate',
  selections: input.offer.declarations.map(declaration => ({
    declarationId: declaration.declarationId,
    kind: declaration.kind,
    optionIds: [],
  })),
})
const firstD20 = (intent: ReturnType<typeof intentFor>): number => {
  const seed = hashAbilityDeclarationIntent(intent)
  const digest = createHash('sha256').update(`${seed}:0`).digest()
  const random = digest.readUInt32BE(0) / 0x1_0000_0000
  return Math.floor(random * 20) + 1
}

describe('AA-083 activated integrations', () => {
  it('Photosynthesis heals 25% Max HP, removes one Injury, and atomically spends Daily', () => {
    const slug = 'aa083-photosynthesis'
    const dependencies = setup(slug, 'Photosynthesis')
    const before = dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
    const maximumHp = pokemonHpSnapshot(before).fullMaxHp
    const offered = offer(dependencies, slug, 'Photosynthesis')
    const intent = intentFor({ offer: offered, slug, canonicalId: 'Photosynthesis', suffix: 'activate' })
    const result = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)
    expect(result.kind).toBe('accepted')
    const after = dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
    expect(after.combat?.currentHp).toBe(100 + Math.floor(maximumHp * 0.25))
    expect(after.combat?.injuries).toBe(1)
    expect(after.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Photosynthesis', spent: 1, limit: 1,
    }))
    expect(() => {
      const nextOffer = offer(dependencies, slug, 'Photosynthesis', 'repeat')
      resolveAbilityDeclarationUseCase({
        role: 'gm',
        intent: intentFor({ offer: nextOffer, slug, canonicalId: 'Photosynthesis', suffix: 'repeat' }),
      }, dependencies)
    }).toThrow(/remaining|spent|uses|stale/i)
  })

  it('Pickup uses a retained d20, creates one deterministic category item on the user cell, and spends Daily', () => {
    const slug = 'aa083-pickup'
    const dependencies = setup(slug, 'Pickup')
    const offered = offer(dependencies, slug, 'Pickup')
    let intent: ReturnType<typeof intentFor> | null = null
    for (let index = 0; index < 500; index += 1) {
      const candidate = intentFor({ offer: offered, slug, canonicalId: 'Pickup', suffix: `roll-${index}` })
      if (firstD20(candidate) === 20) { intent = candidate; break }
    }
    if (!intent) throw new Error('Could not derive a deterministic Pickup roll of 20.')
    const result = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)
    expect(result.kind).toBe('accepted')
    const nextMap = dependencies.mapRepository.getBySlug(slug)!
    const groundItems = nextMap.encounterState?.groundItems ?? []
    expect(groundItems).toHaveLength(1)
    expect(groundItems[0]).toMatchObject({
      quantity: 1,
      position: { x: 2, y: 0, z: 2 },
      ownerPlacementId: 'actor',
    })
    expect(groundItems[0]?.canonicalItemName).toMatch(/^TM/i)
    const after = dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
    expect(after.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Pickup', spent: 1, limit: 1,
    }))
    expect(groundItems[0]?.canonicalItemId).toBeTruthy()
  })
})
