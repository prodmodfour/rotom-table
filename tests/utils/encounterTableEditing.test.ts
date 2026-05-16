import { describe, expect, it } from 'vitest'
import {
  createEncounterTableEditRow,
  encounterTableEditModelToTable,
  encounterTableEditTotalPercent,
  encounterTableToEditModel,
  validateEncounterTableEditModel,
} from '~/utils/encounterTableEditing'
import type { EncounterTable } from '~/types/encounterTable'

const table: EncounterTable = {
  name: 'Forest',
  min_level: 4,
  max_level: 8,
  entries: [
    [25, 'Pidgey'],
    { ceiling: 100, species: 'Oddish', min_level: 6, max_level: 9 },
  ],
}

describe('encounter table editing helpers', () => {
  it('converts tables to editable chance rows with per-Pokémon levels', () => {
    const model = encounterTableToEditModel(table)

    expect(model.name).toBe('Forest')
    expect(model.rows.map(({ species, percent, minLevel, maxLevel }) => ({ species, percent, minLevel, maxLevel }))).toEqual([
      { species: 'Pidgey', percent: 25, minLevel: 4, maxLevel: 8 },
      { species: 'Oddish', percent: 75, minLevel: 6, maxLevel: 9 },
    ])
    expect(encounterTableEditTotalPercent(model.rows)).toBe(100)
  })

  it('creates rows using remaining chance', () => {
    expect(createEncounterTableEditRow([{ id: 'row-0', species: 'A', percent: 80, minLevel: 1, maxLevel: 2 }]).percent).toBe(20)
  })

  it('validates chance totals and level ranges', () => {
    const validation = validateEncounterTableEditModel({
      name: '',
      rows: [{ id: 'row-0', species: '', percent: 50, minLevel: 9, maxLevel: 4 }],
    })

    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Table name is required.')
    expect(validation.errors).toContain('Row 1: species is required.')
    expect(validation.errors).toContain('Row 1: minimum level cannot exceed maximum level.')
    expect(validation.errors).toContain('Chances must add up to 100% (currently 50%).')
  })

  it('converts edit models to persisted object entries', () => {
    expect(encounterTableEditModelToTable({
      name: 'Forest',
      rows: [
        { id: 'row-0', species: 'Pidgey', percent: 25, minLevel: 4, maxLevel: 8 },
        { id: 'row-1', species: 'Oddish', percent: 75, minLevel: 6, maxLevel: 9 },
      ],
    })).toEqual({
      name: 'Forest',
      min_level: 4,
      max_level: 9,
      entries: [
        { ceiling: 25, species: 'Pidgey', min_level: 4, max_level: 8 },
        { ceiling: 100, species: 'Oddish', min_level: 6, max_level: 9 },
      ],
    })
  })
})
