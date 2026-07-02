/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EncounterGenerateResultHeader from '~/components/encounters/EncounterGenerateResultHeader.vue'
import EncounterGenerateSetupFields from '~/components/encounters/EncounterGenerateSetupFields.vue'
import type { EncounterTableEntry } from '~/types/encounterTable'

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
})
