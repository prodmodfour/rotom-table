import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import { CAMPAIGN_ROOT } from './campaignPaths'
import type { UniqueEncounterOutputDir } from './encounterOutput'
import { PROJECT_ROOT } from './fsPaths'
import { runPokegenScript, runPokegenSheetScript, type RunPokegen, type RunPokegenSheet } from './pokegenRunner'

export interface GenerateEncountersRuntimeOverrides {
  projectRoot?: string
  encounterRoot?: string
  pokegenScript?: string
  pokegenProjectRoot?: string
  now?: () => number
  random?: () => number
  pathExists?: (path: string) => boolean
  readTextFile?: (path: string) => string
  writeTextFile?: (path: string, content: string) => void
  listDirectory?: (path: string) => string[]
  ensureDirectory?: (path: string) => void
  makeTempDir?: (prefix: string) => string
  cleanupDirectory?: (path: string) => void
  uniqueOutputDir?: UniqueEncounterOutputDir
  runPokegen?: RunPokegen
  runPokegenSheet?: RunPokegenSheet
}

export interface GenerateEncountersRuntime {
  projectRoot: string
  encounterRoot: string
  now: () => number
  random: () => number
  pathExists: (path: string) => boolean
  readTextFile: (path: string) => string
  writeTextFile: (path: string, content: string) => void
  listDirectory: (path: string) => string[]
  ensureDirectory: (path: string) => void
  makeTempDir: (prefix: string) => string
  cleanupDirectory: (path: string) => void
  uniqueOutputDir?: UniqueEncounterOutputDir
  runPokegen: RunPokegen
  runPokegenSheet: RunPokegenSheet
}

export const DEFAULT_ENCOUNTER_GENERATION_PROJECT_ROOT = CAMPAIGN_ROOT

export const resolveGenerateEncountersRuntime = (
  overrides: GenerateEncountersRuntimeOverrides = {},
): GenerateEncountersRuntime => {
  const projectRoot = overrides.projectRoot ?? DEFAULT_ENCOUNTER_GENERATION_PROJECT_ROOT
  const encounterRoot = overrides.encounterRoot ?? resolvePath(projectRoot, 'encounter_tables')
  const pokegenProjectRoot = overrides.pokegenProjectRoot
    ?? (overrides.projectRoot === undefined ? PROJECT_ROOT : projectRoot)
  const runPokegen = overrides.runPokegen
    ?? ((species: string, level: number, outputDir: string, slugPrefix: string) =>
      runPokegenScript(species, level, outputDir, slugPrefix, {
        projectRoot: pokegenProjectRoot,
        pokegenScript: overrides.pokegenScript,
      }))
  const runPokegenSheet = overrides.runPokegenSheet
    ?? ((species: string, level: number, slugPrefix: string, sequence: number) =>
      runPokegenSheetScript(species, level, slugPrefix, sequence, {
        projectRoot: pokegenProjectRoot,
        pokegenScript: overrides.pokegenScript,
      }))

  return {
    projectRoot,
    encounterRoot,
    now: overrides.now ?? Date.now,
    random: overrides.random ?? Math.random,
    pathExists: overrides.pathExists ?? existsSync,
    readTextFile: overrides.readTextFile ?? ((path: string) => readFileSync(path, 'utf8')),
    writeTextFile: overrides.writeTextFile ?? ((path: string, content: string) => writeFileSync(path, content, 'utf8')),
    listDirectory: overrides.listDirectory ?? readdirSync,
    ensureDirectory: overrides.ensureDirectory ?? ((path: string) => mkdirSync(path, { recursive: true })),
    makeTempDir: overrides.makeTempDir ?? ((prefix: string) => mkdtempSync(joinPath(tmpdir(), prefix))),
    cleanupDirectory: overrides.cleanupDirectory ?? ((path: string) => rmSync(path, { recursive: true, force: true })),
    ...(overrides.uniqueOutputDir ? { uniqueOutputDir: overrides.uniqueOutputDir } : {}),
    runPokegen,
    runPokegenSheet,
  }
}
