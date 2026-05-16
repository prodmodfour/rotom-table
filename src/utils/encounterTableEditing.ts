import {
  clampEncounterCeiling,
  clampEncounterLevel,
  formatEncounterLevelRange,
  normalizeEncounterLevelRange,
  normalizeEncounterTableRollEntry,
  serializeEncounterTableRollEntry,
  type NormalizedEncounterTableRollEntry,
} from '#shared/encounterTables'
import type { EncounterTable } from '~/types/encounterTable'

export interface EncounterTableEditRow {
  id: string
  species: string
  percent: number
  minLevel: number
  maxLevel: number
}

export interface EncounterTableEditModel {
  name: string
  rows: EncounterTableEditRow[]
}

export interface EncounterTableEditValidation {
  valid: boolean
  errors: string[]
}

export const DEFAULT_ENCOUNTER_EDIT_ROW_SPECIES = 'Pidgey'

const rowId = (index: number): string => `row-${index}`

export const encounterTableEditTotalPercent = (
  rows: ReadonlyArray<Pick<EncounterTableEditRow, 'percent'>>,
): number => rows.reduce((sum, row) => {
  const percent = Number(row.percent)
  return sum + (Number.isFinite(percent) ? percent : 0)
}, 0)

export const createEncounterTableEditRow = (
  existingRows: ReadonlyArray<EncounterTableEditRow> = [],
): EncounterTableEditRow => {
  const remaining = Math.max(1, 100 - encounterTableEditTotalPercent(existingRows))
  const nextIndex = existingRows.reduce((max, row) => {
    const match = /^row-(\d+)$/.exec(row.id)
    return match ? Math.max(max, Number(match[1]) + 1) : max
  }, existingRows.length)
  return {
    id: rowId(nextIndex),
    species: DEFAULT_ENCOUNTER_EDIT_ROW_SPECIES,
    percent: remaining,
    minLevel: 1,
    maxLevel: 5,
  }
}

export const encounterTableToEditModel = (table: EncounterTable): EncounterTableEditModel => {
  const fallback = { min_level: table.min_level, max_level: table.max_level }
  let previousCeiling = 0
  const rows = table.entries.map((rawEntry, index): EncounterTableEditRow => {
    const entry = normalizeEncounterTableRollEntry(rawEntry, fallback)
    const percent = Math.max(0, entry.ceiling - previousCeiling)
    previousCeiling = entry.ceiling
    return {
      id: rowId(index),
      species: entry.species,
      percent,
      minLevel: entry.min_level,
      maxLevel: entry.max_level,
    }
  })

  return {
    name: table.name,
    rows: rows.length ? rows : [createEncounterTableEditRow()],
  }
}

const normalizeEditRow = (
  row: EncounterTableEditRow,
  previousCeiling: number,
): NormalizedEncounterTableRollEntry => {
  const levels = normalizeEncounterLevelRange(row.minLevel, row.maxLevel, {
    min_level: 1,
    max_level: 5,
  })
  return {
    ceiling: clampEncounterCeiling(previousCeiling + clampEncounterCeiling(row.percent)),
    species: row.species.trim(),
    ...levels,
  }
}

export const validateEncounterTableEditModel = (
  model: EncounterTableEditModel,
): EncounterTableEditValidation => {
  const errors: string[] = []
  const name = model.name.trim()
  if (!name) errors.push('Table name is required.')
  if (name.length > 80) errors.push('Table name must be 80 characters or fewer.')
  if (model.rows.length === 0) errors.push('Add at least one Pokémon row.')

  model.rows.forEach((row, index) => {
    if (!row.species.trim()) errors.push(`Row ${index + 1}: species is required.`)
    const percent = Number(row.percent)
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      errors.push(`Row ${index + 1}: chance must be an integer from 1 to 100.`)
    }
    const minLevel = Number(row.minLevel)
    const maxLevel = Number(row.maxLevel)
    if (!Number.isInteger(minLevel) || minLevel < 1 || minLevel > 100) {
      errors.push(`Row ${index + 1}: minimum level must be an integer from 1 to 100.`)
    }
    if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 100) {
      errors.push(`Row ${index + 1}: maximum level must be an integer from 1 to 100.`)
    }
    if (Number.isInteger(minLevel) && Number.isInteger(maxLevel) && minLevel > maxLevel) {
      errors.push(`Row ${index + 1}: minimum level cannot exceed maximum level.`)
    }
  })

  const total = model.rows.reduce((sum, row) => sum + Number(row.percent), 0)
  if (total !== 100) errors.push(`Chances must add up to 100% (currently ${total}%).`)

  return { valid: errors.length === 0, errors }
}

export const encounterTableEditModelToTable = (
  model: EncounterTableEditModel,
): EncounterTable => {
  const validation = validateEncounterTableEditModel(model)
  if (!validation.valid) throw new Error(validation.errors[0] ?? 'Invalid encounter table.')

  let previousCeiling = 0
  const entries = model.rows.map((row) => {
    const entry = normalizeEditRow(row, previousCeiling)
    previousCeiling = entry.ceiling
    return serializeEncounterTableRollEntry(entry)
  })

  const minLevel = Math.min(...entries.map((entry) => clampEncounterLevel(entry.min_level)))
  const maxLevel = Math.max(...entries.map((entry) => clampEncounterLevel(entry.max_level)))

  return {
    name: model.name.trim(),
    min_level: minLevel,
    max_level: maxLevel,
    entries,
  }
}

export const encounterEditRowLevelRange = (row: EncounterTableEditRow): string =>
  formatEncounterLevelRange({ min_level: row.minLevel, max_level: row.maxLevel })
