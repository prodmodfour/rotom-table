import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import {
  assertEncounterPathInsideRoot,
  readEncounterGenerateRequest,
  rollEncounterTable,
  safeEncounterTablePath,
  slugifyEncounterOutputPath,
  uniqueEncounterOutputDir,
  type GenerateEncounterBody,
} from '../utils/encounterGeneration'
import type { EncounterTable, RolledEncounter } from '~/types/encounterTable'

export class GenerateEncountersUseCaseError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

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

export interface GenerateEncountersResult {
  ok: true
  dir: string
  relDir: string
  rolled: RolledEncounter[]
  files: EncounterGeneratedFileResult[]
  failures: number
  preview: boolean
  beforeCount: number
}

export interface GenerateEncountersDependencies {
  projectRoot?: string
  encounterRoot?: string
  pokegenScript?: string
  now?: () => number
  random?: () => number
  pathExists?: (path: string) => boolean
  readTextFile?: (path: string) => string
  listDirectory?: (path: string) => string[]
  ensureDirectory?: (path: string) => void
  makeTempDir?: (prefix: string) => string
  cleanupDirectory?: (path: string) => void
  uniqueOutputDir?: (parent: string, baseName: string, exists: (path: string) => boolean) => string
  runPokegen?: RunPokegen
}

const DEFAULT_PROJECT_ROOT = resolvePath(process.cwd())

const isStatusLikeError = (error: unknown): error is {
  statusCode?: unknown
  statusMessage?: unknown
  message?: unknown
} => typeof error === 'object' && error !== null

export const normalizeGenerateEncountersError = (error: unknown): unknown => {
  if (error instanceof GenerateEncountersUseCaseError) return error
  if (isStatusLikeError(error) && typeof error.statusCode === 'number') {
    return new GenerateEncountersUseCaseError(
      error.statusCode,
      String(error.statusMessage ?? error.message ?? 'Encounter generation failed'),
    )
  }
  return error
}

export const runPokegenScript = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
  options: { projectRoot?: string; pokegenScript?: string } = {},
): Promise<PokegenRunResult> => {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT
  const pokegenScript = options.pokegenScript ?? resolvePath(projectRoot, 'scripts/pokegen.sh')

  return new Promise((resolve) => {
    const child = spawn(
      pokegenScript,
      [
        '--species', species,
        '--level', String(level),
        '--output-dir', outputDir,
        '--slug-prefix', slugPrefix,
      ],
      { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    // Drain stdout so the child can't block on a full pipe.
    child.stdout.on('data', () => {})
    child.on('error', (err) => {
      resolve({ ok: false, stderr: stderr + String(err) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, stderr })
    })
  })
}

export const readEncounterTableFile = (
  region: string,
  tableKey: string,
  dependencies: Pick<
    Required<GenerateEncountersDependencies>,
    'encounterRoot' | 'pathExists' | 'readTextFile'
  >,
): EncounterTable => {
  const tablePath = safeEncounterTablePath(dependencies.encounterRoot, region, tableKey)
  if (!dependencies.pathExists(tablePath)) {
    throw new GenerateEncountersUseCaseError(404, `Table ${region}/${tableKey} not found`)
  }
  return JSON.parse(dependencies.readTextFile(tablePath)) as EncounterTable
}

export const encounterOutputSlugPrefix = (
  projectRoot: string,
  outputDir: string,
  tableKey: string,
  preview: boolean,
  now: () => number,
): string => {
  const relForSlug = preview
    ? joinPath('preview', tableKey, String(now()))
    : outputDir.slice(projectRoot.length + 1)
  return slugifyEncounterOutputPath(relForSlug.replace(/^data\/sheets\//, ''))
}

const resolveEncounterOutputDir = (
  request: ReturnType<typeof readEncounterGenerateRequest>,
  dependencies: Required<Pick<
    GenerateEncountersDependencies,
    | 'projectRoot'
    | 'pathExists'
    | 'ensureDirectory'
    | 'makeTempDir'
    | 'uniqueOutputDir'
  >>,
): { dir: string; cleanup: boolean } => {
  if (request.preview) {
    return {
      dir: dependencies.makeTempDir(`rotom-encounter-${request.tableKey}-`),
      cleanup: true,
    }
  }

  const parent = resolvePath(dependencies.projectRoot, request.outRoot)
  assertEncounterPathInsideRoot(dependencies.projectRoot, parent)
  dependencies.ensureDirectory(parent)
  const dir = dependencies.uniqueOutputDir(parent, `${request.tableKey}_${request.count}`, dependencies.pathExists)
  dependencies.ensureDirectory(dir)
  return { dir, cleanup: false }
}

export const generateEncountersUseCase = async (
  body: GenerateEncounterBody | null | undefined,
  dependencies: GenerateEncountersDependencies = {},
): Promise<GenerateEncountersResult> => {
  const projectRoot = dependencies.projectRoot ?? DEFAULT_PROJECT_ROOT
  const encounterRoot = dependencies.encounterRoot ?? resolvePath(projectRoot, 'encounter_tables')
  const now = dependencies.now ?? Date.now
  const random = dependencies.random ?? Math.random
  const pathExists = dependencies.pathExists ?? existsSync
  const readTextFile = dependencies.readTextFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const listDirectory = dependencies.listDirectory ?? readdirSync
  const ensureDirectory = dependencies.ensureDirectory ?? ((path: string) => mkdirSync(path, { recursive: true }))
  const makeTempDir = dependencies.makeTempDir ?? ((prefix: string) => mkdtempSync(joinPath(tmpdir(), prefix)))
  const cleanupDirectory = dependencies.cleanupDirectory ?? ((path: string) => rmSync(path, { recursive: true, force: true }))
  const uniqueOutputDir = dependencies.uniqueOutputDir ?? uniqueEncounterOutputDir
  const runPokegen = dependencies.runPokegen
    ?? ((species: string, level: number, outputDir: string, slugPrefix: string) =>
      runPokegenScript(species, level, outputDir, slugPrefix, {
        projectRoot,
        pokegenScript: dependencies.pokegenScript,
      }))

  let cleanupDir: string | null = null

  try {
    const request = readEncounterGenerateRequest(body)
    const table = readEncounterTableFile(request.region, request.tableKey, {
      encounterRoot,
      pathExists,
      readTextFile,
    })
    const rolled = Array.from({ length: request.count }, () => rollEncounterTable(table, random))
    const output = resolveEncounterOutputDir(request, {
      projectRoot,
      pathExists,
      ensureDirectory,
      makeTempDir,
      uniqueOutputDir,
    })
    const dir = output.dir
    if (output.cleanup) cleanupDir = dir

    const slugPrefix = encounterOutputSlugPrefix(projectRoot, dir, request.tableKey, request.preview, now)
    const beforeFiles = new Set(pathExists(dir) ? listDirectory(dir) : [])
    const fileResults: EncounterGeneratedFileResult[] = []
    let failures = 0

    for (const enc of rolled) {
      const before = new Set(listDirectory(dir))
      const { ok, stderr } = await runPokegen(enc.species, enc.level, dir, slugPrefix)
      if (!ok) {
        failures += 1
        fileResults.push({
          name: `${enc.species} Lv ${enc.level}`,
          error: stderr.trim() || 'pokegen failed',
        })
        continue
      }

      const after = listDirectory(dir)
      const newFiles = after.filter((fileName) => !before.has(fileName))
      if (newFiles.length === 0) {
        failures += 1
        fileResults.push({
          name: `${enc.species} Lv ${enc.level}`,
          error: 'pokegen exited 0 but did not write a new file',
        })
        continue
      }

      const filename = newFiles[0]
      const content = request.preview
        ? readTextFile(joinPath(dir, filename))
        : undefined
      fileResults.push({ name: filename, content })
    }

    return {
      ok: true,
      dir: request.preview ? '' : dir,
      relDir: request.preview ? '' : dir.slice(projectRoot.length + 1),
      rolled,
      files: fileResults,
      failures,
      preview: request.preview,
      beforeCount: beforeFiles.size,
    }
  } catch (error) {
    throw normalizeGenerateEncountersError(error)
  } finally {
    if (cleanupDir) {
      try {
        cleanupDirectory(cleanupDir)
      } catch {
        /* best-effort preview cleanup */
      }
    }
  }
}
