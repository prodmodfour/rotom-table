import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useOrderActionPanel } from '~/composables/map-editor/useOrderActionPanel'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const token = (overrides: Partial<SpawnedPokemon>): SpawnedPokemon => ({
  id: 'token',
  species: 'Token',
  slug: 'token',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/token.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'token',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

const mapDoc = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'map',
  name: 'Map',
  dimensions: { x: 10, y: 3, z: 10 },
  voxels: [],
  placements: [
    { id: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora', position: { x: 0, y: 0, z: 0 } },
    { id: 'pika', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 0 } },
    { id: 'eevee', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 2, y: 0, z: 0 } },
  ],
  initiative: { activeId: 'trainer', round: 1 },
})

describe('useOrderActionPanel', () => {
  it('targets trainer team Pokémon, records active order expiry, and expires it on initiative advance', () => {
    const map = ref(mapDoc())
    const trainer = {
      slug: 'lenora',
      name: 'Lenora',
      level: 1,
      currentTeam: ['pika'],
      features: [{ name: 'Agility Training' }],
    } as TrainerSheet
    const spawned = computed(() => [
      token({ id: 'trainer', species: 'Lenora', entityKind: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora' }),
      token({ id: 'pika', species: 'Pikachu', sheetSlug: 'pika' }),
      token({ id: 'eevee', species: 'Eevee', sheetSlug: 'eevee' }),
    ])
    const events: string[] = []
    const panel = useOrderActionPanel({
      map,
      spawnedPokemon: spawned,
      trainerBySlug: ref(new Map([[trainer.slug, trainer]])),
      canControlPlacement: (id) => id === 'trainer',
      onBeforeOrderAction: ({ orderName }) => events.push(orderName),
      now: () => 100,
      idFactory: () => 'order-effect',
    })

    expect(panel.tokenOrderOptionsById.value.trainer?.map((order) => order.name)).toEqual(['Agility Training'])
    expect(panel.useOrder({ id: 'trainer', orderName: 'Agility Training' })).toBe(true)
    expect(panel.orderActionTargeting.value).toMatchObject({
      moveName: 'Agility Training',
      candidateIds: ['pika'],
      targetPrompt: 'Choose a target for Agility Training (Your Pokémon).',
    })

    expect(panel.selectOrderActionTarget('pika')).toBe(true)
    expect(events).toEqual(['Agility Training'])
    expect(map.value.metadata?.activeOrderEffects).toMatchObject([
      {
        id: 'order-effect',
        orderName: 'Agility Training',
        targetName: 'Pikachu',
        expiration: { kind: 'turn-start', tokenId: 'trainer' },
      },
    ])
    expect(map.value.metadata?.orderLog).toMatchObject([
      {
        orderName: 'Agility Training',
        lines: expect.arrayContaining([
          'Lenora used Agility Training.',
          'Target: Pikachu',
          "Wears off: until the beginning of Lenora's next turn",
        ]),
      },
    ])

    panel.expireActiveOrdersAfterInitiativeAdvance({
      before: { activeId: 'pika', round: 1 },
      after: { activeId: 'trainer', round: 2 },
    })
    expect(map.value.metadata?.activeOrderEffects).toBeUndefined()
    expect(map.value.metadata?.orderLog).toMatchObject([
      expect.objectContaining({ orderName: 'Agility Training' }),
      expect.objectContaining({
        orderName: 'Agility Training',
        lines: ['Agility Training on Pikachu wore off.'],
      }),
    ])
  })

  it('logs untimed orders immediately without targeting when they have no target line', () => {
    const map = ref(mapDoc())
    const trainer = {
      slug: 'lenora',
      name: 'Lenora',
      level: 1,
      orders: [{ name: 'Soothe', effect: 'Calm a Pokémon.' }],
    } as TrainerSheet
    const panel = useOrderActionPanel({
      map,
      spawnedPokemon: computed(() => [
        token({ id: 'trainer', species: 'Lenora', entityKind: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora' }),
      ]),
      trainerBySlug: ref(new Map([[trainer.slug, trainer]])),
      canControlPlacement: () => true,
      now: () => 100,
    })

    expect(panel.useOrder({ id: 'trainer', orderName: 'Soothe' })).toBe(true)
    expect(panel.orderActionTargeting.value).toBeNull()
    expect(map.value.metadata?.activeOrderEffects).toBeUndefined()
    expect(map.value.metadata?.orderLog).toMatchObject([
      { orderName: 'Soothe', lines: expect.arrayContaining(['Lenora used Soothe.']) },
    ])
  })
})
