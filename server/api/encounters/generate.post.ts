/**
 * POST /api/encounters/generate
 *
 * Mirrors the ``just encounter <region> <table> <count>`` recipe in the
 * justfile: rolls N times on an encounter table and runs ``pokegen.sh`` for
 * each rolled species/level pair, writing ``.md`` stat blocks into
 * ``<outRoot>/<table>_<count>[-N]/``.
 *
 * Request body:
 *   {
 *     region:   string,           // e.g. "thickerby_vale"
 *     table:    string,           // e.g. "forest"
 *     count:    number,           // 1..30
 *     outRoot?: string,           // default "generated_pokemon"
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
import { resolve as resolvePath, join as joinPath, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

import type { EncounterTable, RolledEncounter } from '~/types/encounterTable'

interface GenerateBody {
  region?: string
  table?: string
  count?: number
  outRoot?: string
  preview?: boolean
}

const PROJECT_ROOT = resolvePath(process.cwd())
const ENCOUNTER_ROOT = resolvePath(PROJECT_ROOT, 'encounter_tables')
const POKEGEN_SCRIPT = resolvePath(PROJECT_ROOT, 'scripts/pokegen.sh')

/** Reject anything that escapes a directory or contains shell metacharacters. */
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/

const sanitizeNameComponent = (value: string, label: string): string => {
  if (!SAFE_NAME.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} must match /^[A-Za-z0-9_-]+$/`,
    })
  }
  return value
}

const loadTable = (region: string, key: string): EncounterTable => {
  const path = joinPath(ENCOUNTER_ROOT, region, `${key}.json`)
  if (!path.startsWith(ENCOUNTER_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid table path' })
  }
  if (!existsSync(path)) {
    throw createError({
      statusCode: 404,
      statusMessage: `Table ${region}/${key} not found`,
    })
  }
  return JSON.parse(readFileSync(path, 'utf8')) as EncounterTable
}

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min

const rollEncounter = (table: EncounterTable): RolledEncounter => {
  const r = randInt(1, 100)
  const level = randInt(table.min_level, table.max_level)
  for (const [ceiling, species] of table.entries) {
    if (r <= ceiling) return { species, level, roll: r }
  }
  const last = table.entries[table.entries.length - 1]
  return { species: last?.[1] ?? 'Magikarp', level, roll: r }
}

/** Pick a unique output folder so repeat runs don't clobber, exactly like
 *  the justfile recipe (``base``, ``base-2``, ``base-3``\u2026). */
const uniqueDir = (parent: string, baseName: string): string => {
  let dir = joinPath(parent, baseName)
  if (!existsSync(dir)) return dir
  let n = 2
  while (existsSync(joinPath(parent, `${baseName}-${n}`))) n += 1
  return joinPath(parent, `${baseName}-${n}`)
}

/** Run pokegen.sh once and resolve when it exits. */
const runPokegen = (
  species: string,
  level: number,
  outputDir: string,
): Promise<{ ok: boolean; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(
      POKEGEN_SCRIPT,
      ['--species', species, '--level', String(level), '--output-dir', outputDir],
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
  const body = await readBody<GenerateBody>(event)

  const region = sanitizeNameComponent(String(body?.region ?? ''), 'region')
  const tableKey = sanitizeNameComponent(String(body?.table ?? ''), 'table')
  const outRoot = sanitizeNameComponent(
    String(body?.outRoot ?? 'generated_pokemon'),
    'outRoot',
  )
  const count = Number(body?.count ?? 0)
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    throw createError({
      statusCode: 400,
      statusMessage: 'count must be an integer between 1 and 30',
    })
  }
  const preview = Boolean(body?.preview)

  // Load + roll.
  const table = loadTable(region, tableKey)
  const rolled = Array.from({ length: count }, () => rollEncounter(table))

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
    if (!parent.startsWith(PROJECT_ROOT + sep)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid outRoot' })
    }
    mkdirSync(parent, { recursive: true })
    dir = uniqueDir(parent, `${tableKey}_${count}`)
    mkdirSync(dir, { recursive: true })
  }

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
    const { ok, stderr } = await runPokegen(enc.species, enc.level, dir)
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
