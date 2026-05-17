import { existsSync } from 'node:fs'
import { join as joinPath, resolve, sep } from 'node:path'
import {
  normalizeEncounterTableRollEntries,
  randomEncounterInt as sharedRandomEncounterInt,
  selectWeightedEncounterEntry,
} from '#shared/encounterTables'
import { DEFAULT_ENCOUNTER_OUT_ROOT } from '~/utils/encounterGeneration'
import type { EncounterTable, RolledEncounter } from '~/types/encounterTable'
import { UseCaseHttpError } from './useCaseErrors'

export interface GenerateEncounterBody {
  region?: string
  table?: string
  count?: number
  outRoot?: string
  preview?: boolean
}

export const DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT = DEFAULT_ENCOUNTER_OUT_ROOT

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/

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

export const sanitizeEncounterCount = (value: unknown): number => {
  const count = Number(value ?? 0)
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    badEncounterInput('count must be an integer between 1 and 30')
  }
  return count
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

export const rollEncounterTable = (
  table: EncounterTable,
  random: () => number = Math.random,
): RolledEncounter => {
  const fallback = { min_level: table.min_level, max_level: table.max_level }
  const entries = normalizeEncounterTableRollEntries(table.entries, fallback)
  const selection = selectWeightedEncounterEntry(entries, random)
  const entry = selection.entry

  return {
    species: entry?.species || 'Magikarp',
    level: randomEncounterInt(entry?.min_level ?? table.min_level, entry?.max_level ?? table.max_level, random),
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

export const readEncounterGenerateRequest = (body: GenerateEncounterBody | null | undefined) => ({
  region: sanitizeEncounterFolderPath(String(body?.region ?? ''), 'region', true),
  tableKey: sanitizeEncounterNameComponent(String(body?.table ?? ''), 'table'),
  outRoot: sanitizeEncounterOutRoot(String(body?.outRoot ?? DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT)),
  count: sanitizeEncounterCount(body?.count),
  preview: Boolean(body?.preview),
})
