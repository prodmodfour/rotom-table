/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EncounterGenerateResultCard from '~/components/encounters/EncounterGenerateResultCard.vue'
import EncounterGenerateResultHeader from '~/components/encounters/EncounterGenerateResultHeader.vue'
import EncounterGenerateSetupFields from '~/components/encounters/EncounterGenerateSetupFields.vue'
import type { EncounterTableEntry } from '~/types/encounterTable'
import type { EncounterGenerateResult } from '~/utils/encounterGeneration'

const tableEntries: EncounterTableEntry[] = [
  {
    region: 'forest',
    key: 'pond',
    table: {
      name: 'Pond',
      min_level: 3,
      max_level: 5,
      entries: [[100, 'Nothing']],
    },
  },
]

const noop = () => {}

const mountSetupFields = () => mount(EncounterGenerateSetupFields, {
  props: {
    region: 'forest',
    tableKey: 'pond',
    countMin: 3,
    countMax: 3,
    outRoot: 'data/sheets/wild',
    preview: false,
    spawnMapSlug: '',
    regions: ['forest'],
    tablesForRegion: tableEntries,
    spawnMaps: [],
    mapsLoading: false,
    mapsLoadError: null,
    generating: false,
    'onUpdate:region': noop,
    'onUpdate:tableKey': noop,
    'onUpdate:countMin': noop,
    'onUpdate:countMax': noop,
    'onUpdate:outRoot': noop,
    'onUpdate:preview': noop,
    'onUpdate:spawnMapSlug': noop,
  },
})

const mountResultHeader = (fileCount: number, count: number) => mount(EncounterGenerateResultHeader, {
  props: {
    preview: false,
    failures: 0,
    relDir: 'data/sheets/wild/pond_3',
    fileCount,
    tableKey: 'pond',
    count,
  },
})

const spawnResult = (): EncounterGenerateResult => ({
  ok: true,
  dir: '/repo/data/sheets/wild/pond_1-2',
  relDir: 'data/sheets/wild/pond_1-2',
  rolled: [{ species: 'Bulbasaur', level: 5, roll: 1 }],
  files: [{ name: 'wild-pond-1-bulbasaur-lv5-1.json' }],
  failures: 0,
  preview: false,
  count: 1,
  spawn: {
    mapSlug: 'pond-map',
    mapName: 'Pond Map',
    spawned: 1,
    failures: 0,
    placements: [{
      file: 'wild-pond-1-bulbasaur-lv5-1.json',
      slug: 'wild-pond-1-2-bulbasaur-lv5-1',
      placementId: 'spawn-1',
      position: { x: 2, y: 0, z: 2 },
    }],
  },
})

const mountResultCard = () => mount(EncounterGenerateResultCard, {
  props: {
    result: spawnResult(),
    tableKey: 'pond',
    count: 1,
    openFiles: new Set<string>(),
  },
  global: {
    components: { EncounterGenerateResultHeader },
    stubs: {
      EncounterGenerateResultFiles: {
        props: ['files'],
        template: '<ul><li v-for="file in files" :key="file.name">{{ file.name }}</li></ul>',
      },
      NuxtLink: {
        props: ['to'],
        template: '<a><slot /></a>',
      },
    },
  },
})

describe('encounter generation slot copy', () => {
  it('labels the setup count controls as encounter slots instead of exact Pokémon count', () => {
    const wrapper = mountSetupFields()
    const text = wrapper.text()

    expect(text).toContain('Encounter slot range')
    expect(text).toContain('Rolls this many encounter slots')
    expect(text).toContain('Nothing results do not create files')
    expect(text).not.toContain('Count range')
  })

  it('separates requested slots from generated files in result copy', () => {
    const wrapper = mountResultHeader(1, 3)
    const text = wrapper.text()

    expect(text).toContain('3 encounter slots requested')
    expect(text).toContain('1 generated file')
    expect(text).toContain('Nothing rolls do not write files')
    expect(text).toContain('generated files can be fewer than requested slots')
  })

  it('shows final persisted spawn slugs without implying provisional JSON files were written', () => {
    const wrapper = mountResultCard()
    const text = wrapper.text()

    expect(text).toContain('Generated sheets persisted under')
    expect(text).toContain('data/sheets/wild/pond_1-2')
    expect(text).toContain('spawn mode does not write generated JSON files')
    expect(text).not.toContain('Files written to')
    expect(text).toContain('Persisted sheet: wild-pond-1-2-bulbasaur-lv5-1')
    expect(text).toContain('generator label: wild-pond-1-bulbasaur-lv5-1.json')
  })
})
