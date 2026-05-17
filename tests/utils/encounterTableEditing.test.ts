import { describe, expect, it } from 'vitest'
import {
  createEncounterTableEditRow,
  encounterTableEditModelToTable,
  encounterTableEditTotalWeight,
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
  it('converts tables to editable weighted rows with per-Pokémon levels', () => {
    const model = encounterTableToEditModel(table)

    expect(model.name).toBe('Forest')
    expect(model.rows.map(({ species, weight, minLevel, maxLevel }) => ({ species, weight, minLevel, maxLevel }))).toEqual([
      { species: 'Pidgey', weight: 25, minLevel: 4, maxLevel: 8 },
      { species: 'Oddish', weight: 75, minLevel: 6, maxLevel: 9 },
    ])
    expect(encounterTableEditTotalWeight(model.rows)).toBe(100)
  })

  it('creates rows with a default weight', () => {
    expect(createEncounterTableEditRow([{ id: 'row-0', species: 'A', weight: 80, minLevel: 1, maxLevel: 2 }]).weight).toBe(1)
  })

  it('validates weights and level ranges', () => {
    const validation = validateEncounterTableEditModel({
      name: '',
      rows: [{ id: 'row-0', species: '', weight: 0, minLevel: 9, maxLevel: 4 }],
    })

    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Table name is required.')
    expect(validation.errors).toContain('Row 1: species is required.')
    expect(validation.errors).toContain('Row 1: weight must be a positive integer.')
    expect(validation.errors).toContain('Row 1: minimum level cannot exceed maximum level.')
  })

  it('converts edit models to persisted weighted object entries', () => {
    expect(encounterTableEditModelToTable({
      name: 'Forest',
      rows: [
        { id: 'row-0', species: 'Pidgey', weight: 25, minLevel: 4, maxLevel: 8 },
        { id: 'row-1', species: 'Oddish', weight: 75, minLevel: 6, maxLevel: 9 },
      ],
    })).toEqual({
      name: 'Forest',
      min_level: 4,
      max_level: 9,
      entries: [
        { weight: 25, species: 'Pidgey', min_level: 4, max_level: 8 },
        { weight: 75, species: 'Oddish', min_level: 6, max_level: 9 },
      ],
    })
  })
})
