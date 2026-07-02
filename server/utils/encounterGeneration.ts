import { existsSync } from 'node:fs'
import { join as joinPath, resolve, sep } from 'node:path'
import {
  isNormalizedEncounterNothingEntry,
  normalizeEncounterTableRollEntriesWithDefaultNothing,
  orderEncounterTableRollEntriesByWeight,
  randomEncounterInt as sharedRandomEncounterInt,
  selectWeightedEncounterEntry,
} from '#shared/encounterTables'
import {
  DEFAULT_ENCOUNTER_COUNT,
  DEFAULT_ENCOUNTER_OUT_ROOT,
  exactEncounterGenerateCountRange,
  MAX_ENCOUNTER_COUNT,
  MIN_ENCOUNTER_COUNT,
  randomEncounterGenerateCount as randomEncounterGenerateCountFromRange,
  type EncounterGenerateCountRange,
} from '~/utils/encounterGeneration'
import type { EncounterTable, RolledEncounter } from '~/types/encounterTable'
import { UseCaseHttpError } from './useCaseErrors'

export interface GenerateEncounterBody {
  region?: string
  table?: string
  /** Legacy exact count. Prefer countMin/countMax for ranged generation. */
  count?: number
  countMin?: number
  countMax?: number
  outRoot?: string
  preview?: boolean
  /** Exact non-Nothing rolls already displayed by the client preview. */
  rolled?: unknown
}

export const DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT = DEFAULT_ENCOUNTER_OUT_ROOT

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/
const MAX_ROLL_VALUE = Number.MAX_SAFE_INTEGER

export class EncounterGenerationInputError extends UseCaseHttpError<number> {
  get statusMessage(): string {
    return this.message
  }
}

const badEncounterInput = (statusMessage: string): never => {
  throw new EncounterGenerationInputError(400, statusMessage)
}

export const sanitizeEncounterNameComponent = (value: string, label: string): string => {
  if (!SAFE_NAME.test(value)) {
    badEncounterInput(`${label} must match /^[A-Za-z0-9_-]+$/`)
  }
  return value
}

export const sanitizeEncounterFolderPath = (
  value: string,
  label: string,
  allowEmpty = false,
): string => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) {
    if (allowEmpty) return ''
    badEncounterInput(`${label} required`)
  }

  const segments = normalized.split('/')
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      badEncounterInput(`Invalid ${label} segment`)
    }
    if (!SAFE_NAME.test(seg)) {
      badEncounterInput(`${label} segment "${seg}" must match /^[A-Za-z0-9_-]+$/`)
    }
  }
  return segments.join('/')
}

export const sanitizeEncounterOutRoot = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) {
    badEncounterInput('outRoot required')
  }
  const segments = normalized.split('/')
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      badEncounterInput('Invalid outRoot segment')
    }
    if (!SAFE_NAME.test(seg)) {
      badEncounterInput(`outRoot segment "${seg}" must match /^[A-Za-z0-9_-]+$/`)
    }
  }
  return segments.join('/')
}

export const sanitizeEncounterCount = (value: unknown, label = 'count'): number => {
  const count = Number(value ?? 0)
  if (!Number.isInteger(count) || count < MIN_ENCOUNTER_COUNT || count > MAX_ENCOUNTER_COUNT) {
    badEncounterInput(`${label} must be an integer between ${MIN_ENCOUNTER_COUNT} and ${MAX_ENCOUNTER_COUNT}`)
  }
  return count
}

export const sanitizeEncounterCountRange = (minValue: unknown, maxValue: unknown): EncounterGenerateCountRange => {
  const min = sanitizeEncounterCount(minValue, 'countMin')
  const max = sanitizeEncounterCount(maxValue, 'countMax')
  if (min > max) badEncounterInput('countMin must be less than or equal to countMax')
  return { min, max }
}

const rolledEncounterRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    badEncounterInput(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const sanitizeRolledInteger = (value: unknown, label: string, max: number): number => {
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > max) {
    badEncounterInput(`${label} must be an integer between 1 and ${max}`)
  }
  return numberValue
}

export const sanitizeRolledEncounters = (value: unknown): RolledEncounter[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) badEncounterInput('rolled must be an array')
  if (value.length > MAX_ENCOUNTER_COUNT) {
    badEncounterInput(`rolled must contain at most ${MAX_ENCOUNTER_COUNT} encounters`)
  }

  return value.map((item, index) => {
    const label = `rolled[${index}]`
    const record = rolledEncounterRecord(item, label)
    const species = String(record.species ?? '').trim()
    if (!species) badEncounterInput(`${label}.species required`)
    return {
      species,
      level: sanitizeRolledInteger(record.level, `${label}.level`, 100),
      roll: sanitizeRolledInteger(record.roll, `${label}.roll`, MAX_ROLL_VALUE),
    }
  })
}

export const slugifyEncounterOutputPath = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sheet'

export const safeEncounterTablePath = (root: string, region: string, key: string): string => {
  const resolvedRoot = resolve(root)
  const path = resolve(joinPath(resolvedRoot, region), `${key}.json`)
  if (!path.startsWith(resolvedRoot + sep)) {
    badEncounterInput('Invalid table path')
  }
  return path
}

export const assertEncounterPathInsideRoot = (projectRoot: string, path: string): void => {
  if (!path.startsWith(projectRoot + sep)) {
    badEncounterInput('Invalid outRoot')
  }
}

export const randomEncounterInt = sharedRandomEncounterInt
export const randomEncounterGenerateCount = randomEncounterGenerateCountFromRange

export const rollEncounterTable = (
  table: EncounterTable,
  random: () => number = Math.random,
): RolledEncounter | null => {
  const fallback = { min_level: table.min_level, max_level: table.max_level }
  const entries = orderEncounterTableRollEntriesByWeight(
    normalizeEncounterTableRollEntriesWithDefaultNothing(table.entries, fallback),
  )
  const selection = selectWeightedEncounterEntry(entries, random)
  const entry = selection.entry

  if (!entry || isNormalizedEncounterNothingEntry(entry)) return null

  return {
    species: entry.species,
    level: randomEncounterInt(entry.min_level, entry.max_level, random),
    roll: selection.roll,
  }
}

export const uniqueEncounterOutputDir = (
  parent: string,
  baseName: string,
  exists: (path: string) => boolean = existsSync,
): string => {
  const baseDir = joinPath(parent, baseName)
  if (!exists(baseDir)) return baseDir
  let n = 2
  while (exists(joinPath(parent, `${baseName}-${n}`))) n += 1
  return joinPath(parent, `${baseName}-${n}`)
}

export const readEncounterGenerateRequest = (body: GenerateEncounterBody | null | undefined) => {
  const hasCountRange = body?.countMin !== undefined || body?.countMax !== undefined
  const countRange = hasCountRange
    ? sanitizeEncounterCountRange(body?.countMin, body?.countMax)
    : exactEncounterGenerateCountRange(sanitizeEncounterCount(body?.count ?? DEFAULT_ENCOUNTER_COUNT))

  return {
    region: sanitizeEncounterFolderPath(String(body?.region ?? ''), 'region', true),
    tableKey: sanitizeEncounterNameComponent(String(body?.table ?? ''), 'table'),
    outRoot: sanitizeEncounterOutRoot(String(body?.outRoot ?? DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT)),
    countRange,
    preview: Boolean(body?.preview),
    rolled: sanitizeRolledEncounters(body?.rolled),
  }
}
