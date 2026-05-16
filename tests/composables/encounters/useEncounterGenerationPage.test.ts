import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { encounterTables, tablesInRegion } from '~/utils/encounterTables'
import { useEncounterGenerationPage } from '~/composables/encounters/useEncounterGenerationPage'
import type { EncounterGenerateRequestBody, EncounterGenerateResult } from '~/utils/encounterGeneration'
import type { EncounterTableEntry } from '~/types/encounterTable'

const firstEntry = encounterTables[0]
const alternateRegion = encounterTables.find((entry) => entry.region !== firstEntry?.region)?.region

const result = (body: EncounterGenerateRequestBody): EncounterGenerateResult => ({
  ok: true,
  dir: '/tmp/out',
  relDir: 'data/sheets/wild/generated',
  rolled: [],
  files: [{ name: `${body.table}.json`, content: '{}' }],
  failures: 0,
  preview: body.preview,
})

describe('useEncounterGenerationPage', () => {
  it('initializes from query and rolls an immediate preview', async () => {
    expect(firstEntry).toBeTruthy()
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate: async (body) => result(body),
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
    })

    page.region.value = alternateRegion
    await nextTick()
    await nextTick()

    const firstAlternateTable = tablesInRegion(alternateRegion)[0]
    expect(page.tableKey.value).toBe(firstAlternateTable?.key)
    expect(replaceQuery).toHaveBeenLastCalledWith({ region: alternateRegion, table: firstAlternateTable?.key })
  })

  it('generates with clamped request body and stores successful results', async () => {
    const fetchGenerate = vi.fn(async (body: EncounterGenerateRequestBody) => result(body))
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate,
    })
    page.count.value = 999
    page.outRoot.value = 'data/sheets/test'
    page.preview.value = true

    await page.generate()

    expect(fetchGenerate).toHaveBeenCalledWith({
      region: firstEntry!.region,
      table: firstEntry!.key,
      count: 30,
      outRoot: 'data/sheets/test',
      preview: true,
    })
    expect(page.result.value?.preview).toBe(true)
    expect(page.error.value).toBeNull()
    expect(page.generating.value).toBe(false)
  })

  it('stores normalized error messages and clears stale results', async () => {
    const page = useEncounterGenerationPage({
      query: { region: firstEntry!.region, table: firstEntry!.key },
      fetchGenerate: async () => { throw { data: { statusMessage: 'Generation failed' } } },
    })
    page.result.value = result({ region: firstEntry!.region, table: firstEntry!.key, count: 1, outRoot: 'x', preview: false })

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
    })

    expect(page.isOpen('a.json')).toBe(false)
    page.toggleFile('a.json')
    expect(page.isOpen('a.json')).toBe(true)
    page.toggleFile('a.json')
    expect(page.isOpen('a.json')).toBe(false)
  })
})
