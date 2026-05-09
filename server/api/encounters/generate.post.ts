/**
 * POST /api/encounters/generate
 *
 * Mirrors the ``just encounter <region> <table> <count>`` recipe in the
 * justfile: rolls N times on an encounter table and runs ``pokegen.sh`` for
 * each rolled species/level pair, writing ``CharacterSheet`` JSON files
 * into ``<outRoot>/<table>_<count>[-N]/``.
 *
 * The default ``outRoot`` is ``data/sheets/wild`` so freshly-generated
 * encounters land directly inside the Nuxt sheet tree and show up on the
 * ``/sheets`` page without any manual file moving.
 *
 * Request body:
 *   {
 *     region:   string,           // e.g. "thickerby_vale"
 *     table:    string,           // e.g. "forest"
 *     count:    number,           // 1..30
 *     outRoot?: string,           // default "data/sheets/wild"; may be a
 *                                 //   nested path under the project root.
 *     preview?: boolean,          // when true, write to a tempdir and stream
 *                                 //   contents back without keeping files.
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     dir: string,                // absolute path to the output folder (or "" if preview)
 *     relDir: string,             // path relative to project root (or "" if preview)
 *     rolled: Array<{ species, level, roll }>,
 *     files: Array<{ name, content?: string, error?: string }>,
 *     failures: number,
 *     preview: boolean,
 *   }
 *
 * Local dev tool only — spawns Python (``ptu-data/cli.py``) on the host.
 */
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
import { resolve as resolvePath, join as joinPath } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'
import { requireGm } from '../../utils/auth'
import {
  assertEncounterPathInsideRoot,
  readEncounterGenerateRequest,
  rollEncounterTable,
  safeEncounterTablePath,
  slugifyEncounterOutputPath,
  uniqueEncounterOutputDir,
  type GenerateEncounterBody,
} from '../../utils/encounterGeneration'

import type { EncounterTable } from '~/types/encounterTable'

const PROJECT_ROOT = resolvePath(process.cwd())
const ENCOUNTER_ROOT = resolvePath(PROJECT_ROOT, 'encounter_tables')
const POKEGEN_SCRIPT = resolvePath(PROJECT_ROOT, 'scripts/pokegen.sh')

const loadTable = (region: string, key: string): EncounterTable => {
  const path = safeEncounterTablePath(ENCOUNTER_ROOT, region, key)
  if (!existsSync(path)) {
    throw createError({
      statusCode: 404,
      statusMessage: `Table ${region}/${key} not found`,
    })
  }
  return JSON.parse(readFileSync(path, 'utf8')) as EncounterTable
}

/** Run pokegen.sh once and resolve when it exits. */
const runPokegen = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
): Promise<{ ok: boolean; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(
      POKEGEN_SCRIPT,
      [
        '--species', species,
        '--level', String(level),
        '--output-dir', outputDir,
        '--slug-prefix', slugPrefix,
      ],
      { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
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

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<GenerateEncounterBody>(event)
  const { region, tableKey, outRoot, count, preview } = readEncounterGenerateRequest(body)

  // Load + roll.
  const table = loadTable(region, tableKey)
  const rolled = Array.from({ length: count }, () => rollEncounterTable(table))

  // Decide output directory.
  let dir: string
  let cleanup: (() => void) | null = null
  if (preview) {
    dir = mkdtempSync(joinPath(tmpdir(), `rotom-encounter-${tableKey}-`))
    cleanup = () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  } else {
    const parent = resolvePath(PROJECT_ROOT, outRoot)
    assertEncounterPathInsideRoot(PROJECT_ROOT, parent)
    mkdirSync(parent, { recursive: true })
    dir = uniqueEncounterOutputDir(parent, `${tableKey}_${count}`)
    mkdirSync(dir, { recursive: true })
  }

  // Slug prefix derived from the rel-path under data/sheets so each
  // generated sheet's slug is globally unique. For preview runs (tempdir)
  // we just use the leaf folder name — the JSON never gets imported by
  // Vite anyway.
  const relForSlug = preview
    ? joinPath('preview', tableKey, String(Date.now()))
    : dir.slice(PROJECT_ROOT.length + 1)
  const slugPrefix = slugifyEncounterOutputPath(relForSlug.replace(/^data\/sheets\//, ''))

  // Snapshot what's already in dir before generating, so we can attribute
  // each new file to its rolled encounter.
  const beforeFiles = new Set(existsSync(dir) ? readdirSync(dir) : [])

  // Run pokegen for each rolled encounter, sequentially. Parallel runs of
  // pokegen.sh would race on the cache build the first time and produce
  // duplicate file numbering inside one folder.
  const fileResults: Array<{ name: string; error?: string; content?: string }> = []
  let failures = 0

  for (const enc of rolled) {
    const before = new Set(readdirSync(dir))
    const { ok, stderr } = await runPokegen(enc.species, enc.level, dir, slugPrefix)
    if (!ok) {
      failures += 1
      fileResults.push({
        name: `${enc.species} Lv ${enc.level}`,
        error: stderr.trim() || 'pokegen failed',
      })
      continue
    }
    // Find the new file added by this run.
    const after = readdirSync(dir)
    const newFiles = after.filter((f) => !before.has(f))
    if (newFiles.length === 0) {
      failures += 1
      fileResults.push({
        name: `${enc.species} Lv ${enc.level}`,
        error: 'pokegen exited 0 but did not write a new file',
      })
      continue
    }
    const filename = newFiles[0]
    const content = preview
      ? readFileSync(joinPath(dir, filename), 'utf8')
      : undefined
    fileResults.push({ name: filename, content })
  }

  const result = {
    ok: true as const,
    dir: preview ? '' : dir,
    relDir: preview ? '' : dir.slice(PROJECT_ROOT.length + 1),
    rolled,
    files: fileResults,
    failures,
    preview,
    beforeCount: beforeFiles.size,
  }

  if (cleanup) cleanup()
  return result
})
