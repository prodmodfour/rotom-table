import {
  clampEncounterLevel,
  clampEncounterWeight,
  formatEncounterEntryLevelRange,
  isEncounterNothingSpecies,
  isNormalizedEncounterNothingEntry,
  normalizeEncounterLevelRange,
  normalizeEncounterTableRollEntriesWithDefaultNothing,
  orderEncounterTableRollEntriesByWeight,
  serializeEncounterTableRollEntry,
  withDefaultNothingNormalizedEncounterEntry,
  type NormalizedEncounterTableRollEntry,
} from '#shared/encounterTables'
import type { EncounterTable } from '~/types/encounterTable'

export interface EncounterTableEditRow {
  id: string
  species: string
  weight: number
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

export const encounterTableEditTotalWeight = (
  rows: ReadonlyArray<Pick<EncounterTableEditRow, 'weight'>>,
): number => rows.reduce((sum, row) => {
  const weight = Number(row.weight)
  return sum + (Number.isFinite(weight) ? weight : 0)
}, 0)

export const createEncounterTableEditRow = (
  existingRows: ReadonlyArray<EncounterTableEditRow> = [],
): EncounterTableEditRow => {
  const nextIndex = existingRows.reduce((max, row) => {
    const match = /^row-(\d+)$/.exec(row.id)
    return match ? Math.max(max, Number(match[1]) + 1) : max
  }, existingRows.length)
  return {
    id: rowId(nextIndex),
    species: DEFAULT_ENCOUNTER_EDIT_ROW_SPECIES,
    weight: 1,
    minLevel: 1,
    maxLevel: 5,
  }
}

export const encounterTableToEditModel = (table: EncounterTable): EncounterTableEditModel => {
  const fallback = { min_level: table.min_level, max_level: table.max_level }
  const rows = orderEncounterTableRollEntriesByWeight(
    normalizeEncounterTableRollEntriesWithDefaultNothing(table.entries, fallback),
  )
    .map((entry, index): EncounterTableEditRow => ({
      id: rowId(index),
      species: entry.species,
      weight: entry.weight,
      minLevel: entry.min_level,
      maxLevel: entry.max_level,
    }))

  return {
    name: table.name,
    rows: rows.length ? rows : [createEncounterTableEditRow()],
  }
}

export const encounterEditRowIsNothing = (row: Pick<EncounterTableEditRow, 'species'>): boolean =>
  isEncounterNothingSpecies(row.species)

export const encounterEditRowHasLevelRange = (row: Pick<EncounterTableEditRow, 'species'>): boolean =>
  !encounterEditRowIsNothing(row)

const normalizeEditRow = (
  row: EncounterTableEditRow,
): NormalizedEncounterTableRollEntry => {
  const levels = normalizeEncounterLevelRange(row.minLevel, row.maxLevel, {
    min_level: 1,
    max_level: 5,
  })
  return {
    weight: clampEncounterWeight(row.weight),
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
  const pokemonRows = model.rows.filter((row) => !encounterEditRowIsNothing(row))
  const nothingRows = model.rows.filter(encounterEditRowIsNothing)
  if (pokemonRows.length === 0) errors.push('Add at least one Pokémon row.')
  if (nothingRows.length > 1) errors.push('Only one Nothing row is allowed.')

  model.rows.forEach((row, index) => {
    if (!row.species.trim()) errors.push(`Row ${index + 1}: species is required.`)
    const weight = Number(row.weight)
    if (!Number.isInteger(weight) || weight < 1) {
      errors.push(`Row ${index + 1}: weight must be a positive integer.`)
    }
    if (!encounterEditRowHasLevelRange(row)) return

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

  return { valid: errors.length === 0, errors }
}

export const encounterTableEditModelToTable = (
  model: EncounterTableEditModel,
): EncounterTable => {
  const validation = validateEncounterTableEditModel(model)
  if (!validation.valid) throw new Error(validation.errors[0] ?? 'Invalid encounter table.')

  const normalizedEntries = orderEncounterTableRollEntriesByWeight(
    withDefaultNothingNormalizedEncounterEntry(model.rows.map(normalizeEditRow)),
  )
  const entries = normalizedEntries.map(serializeEncounterTableRollEntry)
  const pokemonEntries = normalizedEntries.filter((entry) => !isNormalizedEncounterNothingEntry(entry))

  const minLevel = Math.min(...pokemonEntries.map((entry) => clampEncounterLevel(entry.min_level)))
  const maxLevel = Math.max(...pokemonEntries.map((entry) => clampEncounterLevel(entry.max_level)))

  return {
    name: model.name.trim(),
    min_level: minLevel,
    max_level: maxLevel,
    entries,
  }
}

export const encounterEditRowLevelRange = (row: EncounterTableEditRow): string =>
  formatEncounterEntryLevelRange({ species: row.species, min_level: row.minLevel, max_level: row.maxLevel })
