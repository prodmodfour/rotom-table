import { join as joinPath } from 'node:path'
import type { CharacterSheet } from '~/types/characterSheet'
import type { RolledEncounter } from '~/types/encounterTable'
import { rollWildPokemonSkillBackground } from '~/utils/sheets/wildPokemonSkillBackground'
import type { RunPokegen } from './pokegenRunner'

export interface EncounterGeneratedFileResult {
  name: string
  error?: string
  content?: string
}

export interface RunPokegenBatchInput {
  rolled: readonly RolledEncounter[]
  dir: string
  slugPrefix: string
  preview: boolean
  pathExists: (path: string) => boolean
  listDirectory: (path: string) => string[]
  readTextFile: (path: string) => string
  writeTextFile: (path: string, content: string) => void
  random: () => number
  runPokegen: RunPokegen
}

export interface RunPokegenBatchResult {
  beforeCount: number
  files: EncounterGeneratedFileResult[]
  failures: number
}

const encounterLabel = (encounter: RolledEncounter): string => `${encounter.species} Lv ${encounter.level}`

export const decorateGeneratedPokemonSheet = (sheet: CharacterSheet, random: () => number): CharacterSheet => ({
  ...sheet,
  skillBackground: rollWildPokemonSkillBackground(random),
})

const decorateGeneratedPokemonSheetContent = (content: string, random: () => number): string => {
  const parsed = JSON.parse(content) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('generated sheet JSON must be an object')
  }

  const sheet = decorateGeneratedPokemonSheet(parsed as CharacterSheet, random)
  return `${JSON.stringify(sheet, null, 2)}\n`
}

const decorateGeneratedPokemonSheetFile = ({
  path,
  preview,
  readTextFile,
  writeTextFile,
  random,
}: {
  path: string
  preview: boolean
  readTextFile: (path: string) => string
  writeTextFile: (path: string, content: string) => void
  random: () => number
}): string | undefined => {
  const content = readTextFile(path)
  if (!path.toLowerCase().endsWith('.json')) return preview ? content : undefined

  const decorated = decorateGeneratedPokemonSheetContent(content, random)
  if (!preview) writeTextFile(path, decorated)
  return preview ? decorated : undefined
}

export const runPokegenForRolledEncounters = async ({
  rolled,
  dir,
  slugPrefix,
  preview,
  pathExists,
  listDirectory,
  readTextFile,
  writeTextFile,
  random,
  runPokegen,
}: RunPokegenBatchInput): Promise<RunPokegenBatchResult> => {
  const beforeFiles = new Set(pathExists(dir) ? listDirectory(dir) : [])
  const files: EncounterGeneratedFileResult[] = []
  let failures = 0

  for (const encounter of rolled) {
    const before = new Set(listDirectory(dir))
    const { ok, stderr } = await runPokegen(encounter.species, encounter.level, dir, slugPrefix)
    if (!ok) {
      failures += 1
      files.push({
        name: encounterLabel(encounter),
        error: stderr.trim() || 'pokegen failed',
      })
      continue
    }

    const after = listDirectory(dir)
    const newFiles = after.filter((fileName) => !before.has(fileName))
    if (newFiles.length === 0) {
      failures += 1
      files.push({
        name: encounterLabel(encounter),
        error: 'pokegen exited 0 but did not write a new file',
      })
      continue
    }

    const filename = newFiles[0]
    const path = joinPath(dir, filename)
    try {
      files.push({
        name: filename,
        content: decorateGeneratedPokemonSheetFile({
          path,
          preview,
          readTextFile,
          writeTextFile,
          random,
        }),
      })
    } catch (error) {
      failures += 1
      files.push({
        name: filename,
        error: (error as Error).message || 'Could not decorate generated sheet',
      })
    }
  }

  return {
    beforeCount: beforeFiles.size,
    files,
    failures,
  }
}
