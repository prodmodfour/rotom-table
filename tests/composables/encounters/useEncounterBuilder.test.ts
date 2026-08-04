import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEncounterBuilder } from '~/composables/encounters/useEncounterBuilder'
import type { EncounterTableEntry } from '~/types/encounterTable'
import type { MapSummary, TabletopMap } from '~/types/map'

const entries: EncounterTableEntry[] = [{
  region: 'vale', key: 'pond',
  table: { name: 'Pond', min_level: 5, max_level: 5, entries: [{ weight: 1, species: 'Bulbasaur' }] },
}]
const maps: MapSummary[] = [{
  slug: 'pond-map', name: 'Pond Map', folder: '', dimensions: { x: 8, y: 2, z: 8 }, placementCount: 0,
}]
const map = {
  slug: 'pond-map', name: 'Pond Map', placements: [],
  encounterState: { sides: { wild: { id: 'wild', label: 'Wild', status: 'active' } } },
} as unknown as TabletopMap
const flush = async (): Promise<void> => { await Promise.resolve(); await nextTick(); await Promise.resolve() }

describe('useEncounterBuilder', () => {
  it('rolls reviewed cast rows, preserves locks, supports replacement, and assigns battlefield sides', async () => {
    const builder = useEncounterBuilder({ entries, maps, loadMap: async () => map, random: () => 0 })
    await flush()

    expect(builder.cast.value).toHaveLength(3)
    expect(builder.cast.value[0]).toMatchObject({ species: 'Bulbasaur', level: 5, sideId: 'wild', role: 'standard' })
    const locked = builder.cast.value[0]!
    builder.toggleLock(locked.castId)
    builder.updateMember(builder.cast.value[1]!.castId, { species: 'Ivysaur', level: 9, role: 'leader', hidden: true })
    builder.count.value = 2
    builder.rollCast()

    expect(builder.cast.value).toHaveLength(2)
    expect(builder.cast.value[0]).toMatchObject({ castId: locked.castId, locked: true, species: 'Bulbasaur' })
    expect(builder.cast.value[1]).toMatchObject({ castId: 'cast-2', locked: false, species: 'Bulbasaur', role: 'leader', hidden: true })
  })

  it('preserves an explicitly requested table while the asynchronous library loads', async () => {
    const deferredEntries = ref<EncounterTableEntry[]>([])
    const builder = useEncounterBuilder({
      entries: deferredEntries,
      maps,
      initialRegion: 'vale',
      initialTable: 'target-pond',
      loadMap: async () => map,
      random: () => 0,
    })
    await flush()

    expect(builder.region.value).toBe('vale')
    expect(builder.tableKey.value).toBe('target-pond')
    expect(builder.cast.value).toEqual([])

    deferredEntries.value = [
      entries[0]!,
      {
        region: 'vale', key: 'target-pond',
        table: { name: 'Target Pond', min_level: 9, max_level: 9, entries: [{ weight: 1, species: 'Ivysaur' }] },
      },
    ]
    await flush()

    expect(builder.tableKey.value).toBe('target-pond')
    expect(builder.cast.value[0]).toMatchObject({ species: 'Ivysaur', level: 9 })
  })

  it('derives recipe defaults and launches only the exact reviewed non-authoritative payload', async () => {
    const launch = vi.fn(async request => ({
      ok: true as const, launchId: request.launchId, encounterId: request.encounterId,
      encounterRevision: 0, mapSlug: request.mapSlug, mapRevision: 1, spawned: request.cast.length,
    }))
    const builder = useEncounterBuilder({ entries: ref(entries), maps: ref(maps), loadMap: async () => map, launch, random: () => 0 })
    await flush()
    builder.recipeId.value = 'boss'
    builder.name.value = 'Storm Tyrant'
    await nextTick()
    builder.rollCast()
    builder.updateMember(builder.cast.value[0]!.castId, { role: 'boss', hidden: true })

    const result = await builder.launch()

    expect(result).toMatchObject({ encounterId: 'storm-tyrant', spawned: 1 })
    const payload = launch.mock.calls[0]![0]
    expect(payload).toMatchObject({
      schemaVersion: 1, encounterId: 'storm-tyrant', name: 'Storm Tyrant', recipe: 'boss', mapSlug: 'pond-map', startInitiative: true,
      presentation: { stage: 'boss', tactical: 'on-demand' },
      source: { region: 'vale', table: 'pond' },
      cast: [{ castId: 'cast-1', species: 'Bulbasaur', level: 5, sideId: 'wild', role: 'boss', hidden: true }],
    })
    expect(payload.cast[0]).not.toHaveProperty('locked')
    expect(payload).not.toHaveProperty('mechanics')
  })

  it('reuses a launch identity after an uncertain failure and changes it only after intent changes', async () => {
    const requests: Array<{ launchId: string, name: string }> = []
    let attempt = 0
    const launch = vi.fn(async (request) => {
      requests.push({ launchId: request.launchId, name: request.name })
      attempt += 1
      if (attempt === 1) throw new Error('connection lost after submit')
      return {
        ok: true as const, launchId: request.launchId, encounterId: request.encounterId,
        encounterRevision: 0, mapSlug: request.mapSlug, mapRevision: attempt, spawned: request.cast.length,
      }
    })
    const builder = useEncounterBuilder({ entries, maps, loadMap: async () => map, launch, random: () => 0 })
    await flush()

    expect(await builder.launch()).toBeNull()
    expect(builder.error.value).toContain('connection lost')
    expect(await builder.launch()).toMatchObject({ ok: true })
    expect(requests[1]?.launchId).toBe(requests[0]?.launchId)

    builder.name.value = 'Changed encounter'
    await nextTick()
    await builder.launch()
    expect(requests[2]?.launchId).not.toBe(requests[1]?.launchId)
  })
})
