import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { encounterTables, tablesInRegion } from '~/utils/encounterTables'
import { useEncounterGenerationPage } from '~/composables/encounters/useEncounterGenerationPage'
import type { EncounterGenerateRequestBody, EncounterGenerateResult, EncounterSpawnRequestBody } from '~/utils/encounterGeneration'
import type { EncounterTableEntry, RolledEncounter } from '~/types/encounterTable'
import type { MapSummary } from '~/types/map'

const firstEntry = encounterTables[0]
const alternateRegion = encounterTables.find((entry) => entry.region !== firstEntry?.region)?.region

const maps: MapSummary[] = [
  {
    slug: 'forest-map',
    name: 'Forest Map',
    folder: '',
    dimensions: { x: 10, y: 3, z: 10 },
    placementCount: 0,
  },
]

const avoidNothing = () => 0
const cloneRolled = (rolled: readonly RolledEncounter[]): RolledEncounter[] => rolled.map((encounter) => ({ ...encounter }))

const result = (body: EncounterGenerateRequestBody): EncounterGenerateResult => ({
  ok: true,
  dir: '/tmp/out',
  relDir: 'data/sheets/wild/generated',
  rolled: cloneRolled(body.rolled ?? []),
  files: [{ name: `${body.table}.json`, content: '{}' }],
  failures: 0,
  preview: body.preview,
  count: body.countMax ?? body.count ?? body.rolled?.length ?? 0,
})

describe('useEncounterGenerationPage', () => {
  it('initializes from query and rolls an immediate preview', async () => {
    expect(firstEntry).toBeTruthy()
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate: async (body) => result(body),
      random: avoidNothing,
    })

    await nextTick()

    expect(page.region.value).toBe(firstEntry!.region)
    expect(page.tableKey.value).toBe(firstEntry!.key)
    expect(page.selectedTable.value?.key).toBe(firstEntry!.key)
    expect(page.rolledPreview.value).toHaveLength(3)
  })

  it('coerces table key when region changes and updates the route query', async () => {
    if (!alternateRegion) return
    const replaceQuery = vi.fn()
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      replaceQuery,
      fetchGenerate: async (body) => result(body),
      random: avoidNothing,
    })

    page.region.value = alternateRegion
    await nextTick()
    await nextTick()

    const firstAlternateTable = tablesInRegion(alternateRegion)[0]
    expect(page.tableKey.value).toBe(firstAlternateTable?.key)
    expect(replaceQuery).toHaveBeenLastCalledWith({ region: alternateRegion, table: firstAlternateTable?.key })
  })

  it('keeps count ranges ordered and rerolls previews at the selected size', async () => {
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate: async (body) => result(body),
      random: avoidNothing,
    })

    page.countMin.value = 4
    await nextTick()

    expect(page.countMax.value).toBe(4)
    expect(page.rolledPreview.value).toHaveLength(4)

    page.countMax.value = 2
    await nextTick()

    expect(page.countMin.value).toBe(2)
    expect(page.rolledPreview.value).toHaveLength(2)
  })

  it('generates with the displayed roll preview and stores successful results', async () => {
    const fetchGenerate = vi.fn(async (body: EncounterGenerateRequestBody) => result(body))
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate,
      random: avoidNothing,
    })
    page.outRoot.value = 'data/sheets/test'
    page.preview.value = true
    const previewRolls = cloneRolled(page.rolledPreview.value)

    await page.generate()

    expect(fetchGenerate).toHaveBeenCalledWith({
      region: firstEntry!.region,
      table: firstEntry!.key,
      countMin: 3,
      countMax: 3,
      outRoot: 'data/sheets/test',
      preview: true,
      rolled: previewRolls,
    })
    expect(page.result.value?.preview).toBe(true)
    expect(page.rolledPreview.value).toEqual(previewRolls)
    expect(page.error.value).toBeNull()
    expect(page.generating.value).toBe(false)
  })

  it('generates and spawns the displayed preview onto the selected map with persistent output', async () => {
    const fetchSpawn = vi.fn(async (body: EncounterSpawnRequestBody): Promise<EncounterGenerateResult> => ({
      ...result(body),
      preview: false,
      spawn: {
        mapSlug: body.mapSlug,
        mapName: 'Forest Map',
        spawned: 1,
        failures: 0,
        placements: [{ file: 'a.json', slug: 'a', placementId: 'token-1', position: { x: 0, y: 0, z: 0 } }],
      },
    }))
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key, map: 'forest-map' },
      maps,
      fetchGenerate: async (body) => result(body),
      fetchSpawn,
      clientId: () => 'client-1',
      random: avoidNothing,
    })
    page.outRoot.value = 'data/sheets/test'
    const previewRolls = cloneRolled(page.rolledPreview.value)

    await page.spawn()

    expect(page.selectedSpawnMap.value?.slug).toBe('forest-map')
    expect(fetchSpawn).toHaveBeenCalledWith({
      region: firstEntry!.region,
      table: firstEntry!.key,
      countMin: 3,
      countMax: 3,
      outRoot: 'data/sheets/test',
      preview: false,
      mapSlug: 'forest-map',
      clientId: 'client-1',
      rolled: previewRolls,
    })
    expect(page.result.value?.spawn?.spawned).toBe(1)
    expect(page.rolledPreview.value).toEqual(previewRolls)
    expect(page.spawning.value).toBe(false)
  })

  it('does not spawn while preview-only is enabled', async () => {
    const fetchSpawn = vi.fn(async (body: EncounterSpawnRequestBody) => result(body))
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key, map: 'forest-map' },
      maps,
      fetchGenerate: async (body) => result(body),
      fetchSpawn,
      random: avoidNothing,
    })
    page.preview.value = true

    await page.spawn()

    expect(fetchSpawn).not.toHaveBeenCalled()
    expect(page.canSpawn.value).toBe(false)
  })

  it('stores normalized error messages and clears stale results', async () => {
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate: async () => { throw { data: { statusMessage: 'Generation failed' } } },
      random: avoidNothing,
    })
    page.result.value = result({ region: firstEntry!.region, table: firstEntry!.key, countMin: 1, countMax: 1, outRoot: 'x', preview: false })

    await page.generate()

    expect(page.result.value).toBeNull()
    expect(page.error.value).toBe('Generation failed')
    expect(page.generating.value).toBe(false)
  })

  it('uses injected table entries and updates when that source changes', async () => {
    const entries = ref<EncounterTableEntry[]>([
      { region: 'custom', key: 'forest', table: { name: 'Custom Forest', min_level: 1, max_level: 2, entries: [[100, 'Oddish']] } },
    ])
    const page = useEncounterGenerationPage({
      query: { region: 'custom', table: 'forest' },
      entries,
      fetchGenerate: async (body) => result(body),
      random: avoidNothing,
    })

    expect(page.regions.value).toEqual(['custom'])
    expect(page.selectedTable.value?.table.name).toBe('Custom Forest')

    entries.value = [
      ...entries.value,
      { region: 'custom/deep', key: 'cave', table: { name: 'Deep Cave', min_level: 3, max_level: 4, entries: [[100, 'Zubat']] } },
    ]
    await nextTick()

    expect(page.regions.value).toEqual(['custom', 'custom/deep'])
  })

  it('selects the first injected table when an initially empty source loads', async () => {
    const entries = ref<EncounterTableEntry[]>([])
    const page = useEncounterGenerationPage({
      query: {},
      entries,
      fetchGenerate: async (body) => result(body),
      random: avoidNothing,
    })

    expect(page.selectedTable.value).toBeNull()

    entries.value = [
      { region: 'loaded', key: 'field', table: { name: 'Loaded Field', min_level: 1, max_level: 2, entries: [[100, 'Pidgey']] } },
    ]
    await nextTick()

    expect(page.region.value).toBe('loaded')
    expect(page.tableKey.value).toBe('field')
    expect(page.selectedTable.value?.table.name).toBe('Loaded Field')
  })

  it('toggles generated preview file content state', () => {
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate: async (body) => result(body),
      random: avoidNothing,
    })

    expect(page.isOpen('a.json')).toBe(false)
    page.toggleFile('a.json')
    expect(page.isOpen('a.json')).toBe(true)
    page.toggleFile('a.json')
    expect(page.isOpen('a.json')).toBe(false)
  })
})
