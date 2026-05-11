import { join as joinPath } from 'node:path'
import type { RolledEncounter } from '~/types/encounterTable'

export interface PokegenRunResult {
  ok: boolean
  stderr: string
}

export type RunPokegen = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
) => Promise<PokegenRunResult>

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
  runPokegen: RunPokegen
}

export interface RunPokegenBatchResult {
  beforeCount: number
  files: EncounterGeneratedFileResult[]
  failures: number
}

const encounterLabel = (encounter: RolledEncounter): string => `${encounter.species} Lv ${encounter.level}`

export const runPokegenForRolledEncounters = async ({
  rolled,
  dir,
  slugPrefix,
  preview,
  pathExists,
  listDirectory,
  readTextFile,
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
    files.push({
      name: filename,
      content: preview ? readTextFile(joinPath(dir, filename)) : undefined,
    })
  }

  return {
    beforeCount: beforeFiles.size,
    files,
    failures,
  }
}
