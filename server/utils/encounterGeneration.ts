import { existsSync } from 'node:fs'
import { join as joinPath, sep } from 'node:path'
import { createError } from 'h3'
import { DEFAULT_ENCOUNTER_OUT_ROOT } from '~/utils/encounterGeneration'
import type { EncounterTable, RolledEncounter } from '~/types/encounterTable'

export interface GenerateEncounterBody {
  region?: string
  table?: string
  count?: number
  outRoot?: string
  preview?: boolean
}

export const DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT = DEFAULT_ENCOUNTER_OUT_ROOT

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/

export const sanitizeEncounterNameComponent = (value: string, label: string): string => {
  if (!SAFE_NAME.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} must match /^[A-Za-z0-9_-]+$/`,
    })
  }
  return value
}

export const sanitizeEncounterOutRoot = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) {
    throw createError({ statusCode: 400, statusMessage: 'outRoot required' })
  }
  const segments = normalized.split('/')
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw createError({ statusCode: 400, statusMessage: 'Invalid outRoot segment' })
    }
    if (!SAFE_NAME.test(seg)) {
      throw createError({
        statusCode: 400,
        statusMessage: `outRoot segment "${seg}" must match /^[A-Za-z0-9_-]+$/`,
      })
    }
  }
  return segments.join('/')
}

export const sanitizeEncounterCount = (value: unknown): number => {
  const count = Number(value ?? 0)
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    throw createError({
      statusCode: 400,
      statusMessage: 'count must be an integer between 1 and 30',
    })
  }
  return count
}

export const slugifyEncounterOutputPath = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sheet'

export const safeEncounterTablePath = (root: string, region: string, key: string): string => {
  const path = joinPath(root, region, `${key}.json`)
  if (!path.startsWith(root + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid table path' })
  }
  return path
}

export const assertEncounterPathInsideRoot = (projectRoot: string, path: string): void => {
  if (!path.startsWith(projectRoot + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid outRoot' })
  }
}

export const randomEncounterInt = (min: number, max: number, random: () => number = Math.random): number =>
  Math.floor(random() * (max - min + 1)) + min

export const rollEncounterTable = (
  table: EncounterTable,
  random: () => number = Math.random,
): RolledEncounter => {
  const roll = randomEncounterInt(1, 100, random)
  const level = randomEncounterInt(table.min_level, table.max_level, random)
  for (const [ceiling, species] of table.entries) {
    if (roll <= ceiling) return { species, level, roll }
  }
  const last = table.entries[table.entries.length - 1]
  return { species: last?.[1] ?? 'Magikarp', level, roll }
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
  region: sanitizeEncounterNameComponent(String(body?.region ?? ''), 'region'),
  tableKey: sanitizeEncounterNameComponent(String(body?.table ?? ''), 'table'),
  outRoot: sanitizeEncounterOutRoot(String(body?.outRoot ?? DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT)),
  count: sanitizeEncounterCount(body?.count),
  preview: Boolean(body?.preview),
})
