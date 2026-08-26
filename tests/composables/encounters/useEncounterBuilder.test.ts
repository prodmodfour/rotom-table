import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEncounterBuilder } from '~/composables/encounters/useEncounterBuilder'
import type { EncounterBuilderHandoffProjectionV1, EncounterBuilderHandoffV2 } from '#shared/encounterDocuments/builder'
import type { MapSummary, TabletopMap } from '~/types/map'

const maps: MapSummary[] = [{ slug: 'pond-map', name: 'Pond Map', folder: '', dimensions: { x: 8, y: 2, z: 8 }, placementCount: 0 }]
const map = {
  slug: 'pond-map', name: 'Pond Map', revision: 0, placements: [],
  encounterState: { sides: { wild: { id: 'wild', label: 'Wild', status: 'active' } } },
} as unknown as TabletopMap
const reference: EncounterBuilderHandoffV2 = {
  kind: 'wild-package', documentId: 'wild-package:v1:0123456789abcdef0123456789abcdef', expectedRevision: 0, sceneId: null,
}
const projection = (overrides: Partial<EncounterBuilderHandoffProjectionV1['defaults']> = {}): EncounterBuilderHandoffProjectionV1 => ({
  schemaVersion: 1,
  handoff: reference,
  source: { label: 'Forest table', sceneLabel: null },
  defaults: {
    name: 'Forest table encounter', recipe: 'wild-pack', map: null,
    publicStakes: null, gmStakes: null, notes: null, storyLocked: false, ...overrides,
  },
  cast: [{
    sheet: { kind: 'pokemon', slug: 'cutiefly', expectedRevision: 0 }, sourceCandidateId: 'candidate-cutiefly',
    displayName: 'Cutiefly', displayLevel: 5, placementIntent: { kind: 'builder-default', zoneLabel: null },
  }, {
    sheet: { kind: 'pokemon', slug: 'weedle', expectedRevision: 0 }, sourceCandidateId: 'candidate-weedle',
    displayName: 'Weedle', displayLevel: 6, placementIntent: { kind: 'map-zone', zoneLabel: 'North trail' },
  }],
})
const flush = async (): Promise<void> => { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }

const create = (options: Record<string, unknown> = {}) => useEncounterBuilder({
  handoff: ref(reference), maps: ref(maps), loadMap: async () => map,
  loadHandoff: async () => projection(), ...options,
})

describe('useEncounterBuilder immutable handoff workflow', () => {
  it('loads server-resolved ordinary sheets and assigns available battlefield sides', async () => {
    const builder = create()
    await flush()
    expect(builder.handoffProjection.value).toMatchObject({ source: { label: 'Forest table' } })
    expect(builder.cast.value).toMatchObject([
      { displayName: 'Cutiefly', displayLevel: 5, sideId: 'wild', role: 'standard', placementIntent: { kind: 'builder-default' } },
      { displayName: 'Weedle', displayLevel: 6, sideId: 'wild', placementIntent: { kind: 'map-zone', zoneLabel: 'North trail' } },
    ])
    builder.updateMember('cast-1', { role: 'leader', hidden: true, sideId: null })
    builder.removeMember('cast-2')
    expect(builder.cast.value).toMatchObject([{ role: 'leader', hidden: true, sideId: null }])
  })

  it('applies preparation-pinned map and structurally locked scene material', async () => {
    const sessionReference = ref<EncounterBuilderHandoffV2>({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest', expectedRevision: 3, sceneId: 'scene:ambush' })
    const locked = projection({
      name: 'Forest Ambush', recipe: 'ambush', map: { slug: 'pond-map', expectedRevision: 0 },
      publicStakes: 'Protect the camp.', gmStakes: null, notes: 'Leader retreats.', storyLocked: true,
    })
    const builder = useEncounterBuilder({
      handoff: sessionReference, maps, loadMap: async () => map,
      loadHandoff: async handoff => ({ ...locked, handoff }),
    })
    await flush()
    expect(builder.storyLocked.value).toBe(true)
    expect(builder.mapSlug.value).toBe('pond-map')
    expect(builder.publicStakes.value).toBe('Protect the camp.')
    expect(builder.notes.value).toBe('Leader retreats.')
    expect(builder.recipeId.value).toBe('ambush')
    expect(builder.cast.value.every(row => row.hidden)).toBe(true)
  })

  it('launches only the reviewed typed handoff and ordinary sheet references', async () => {
    const launch = vi.fn(async request => ({
      ok: true as const, exactRetry: false, launchId: request.launchId, encounterId: request.encounterId,
      encounterRevision: 0, mapSlug: request.mapSlug, mapRevision: 1, spawned: request.cast.length,
    }))
    const builder = create({ launch })
    await flush()
    builder.name.value = 'Storm Pack'
    await nextTick()
    builder.updateMember('cast-1', { role: 'leader', hidden: true })
    const result = await builder.launch()
    expect(result).toMatchObject({ encounterId: 'storm-pack', spawned: 2 })
    expect(launch.mock.calls[0]![0]).toMatchObject({
      schemaVersion: 2, encounterId: 'storm-pack', name: 'Storm Pack', recipe: 'wild-pack', mapSlug: 'pond-map', expectedMapRevision: 0,
      handoff: reference,
    })
    expect(launch.mock.calls[0]![0].cast).toHaveLength(2)
    expect(launch.mock.calls[0]![0].cast[0]).toMatchObject({ castId: 'cast-1', sheet: { kind: 'pokemon', slug: 'cutiefly', expectedRevision: 0 }, sourceCandidateId: 'candidate-cutiefly', sideId: 'wild', role: 'leader', hidden: true })
    expect(launch.mock.calls[0]![0].cast[0]).not.toHaveProperty('displayName')
    expect(launch.mock.calls[0]![0].cast[0]).not.toHaveProperty('placementIntent')
    expect(launch.mock.calls[0]![0]).not.toHaveProperty('mechanics')
  })

  it('reuses a launch identity after uncertain delivery and rotates it only after intent changes', async () => {
    const requests: Array<{ launchId: string; name: string }> = []
    let attempt = 0
    const launch = vi.fn(async (request) => {
      requests.push({ launchId: request.launchId, name: request.name }); attempt += 1
      if (attempt === 1) throw new Error('connection lost after submit')
      return { ok: true as const, exactRetry: attempt > 2, launchId: request.launchId, encounterId: request.encounterId, encounterRevision: 0, mapSlug: request.mapSlug, mapRevision: 1, spawned: request.cast.length }
    })
    const builder = create({ launch })
    await flush()
    expect(await builder.launch()).toBeNull()
    expect(builder.error.value).toContain('connection lost')
    expect(await builder.launch()).toMatchObject({ ok: true })
    expect(requests[1]?.launchId).toBe(requests[0]?.launchId)
    builder.name.value = 'Changed encounter'; await nextTick(); await builder.launch()
    expect(requests[2]?.launchId).not.toBe(requests[1]?.launchId)
  })
})
