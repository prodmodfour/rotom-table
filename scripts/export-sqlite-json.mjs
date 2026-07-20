#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROTOM_CAMPAIGN_ROOT_ENV = 'ROTOM_CAMPAIGN_ROOT'
const ROTOM_DB_PATH_ENV = 'ROTOM_DB_PATH'
const DEFAULT_ROTOM_DB_FILENAME = 'rotom-table.sqlite'
const HELP_TEXT = `Rotom Table SQLite-to-JSON export

Usage:
  npm run export:sqlite-json -- --output /safe/export/path [--force]

Options:
  --output <path>  Required export directory. Must be outside the app checkout.
  --force          Replace an existing output directory.
  --help, -h       Show this help.
`

const scriptPath = fileURLToPath(import.meta.url)
const appRoot = resolve(dirname(scriptPath), '..')
const sheetKinds = ['pokemon', 'trainer']
const groupInventoryRootRel = 'data/group-inventories'
const shopTableRootRel = 'data/shops'
const pendingResolutionAuditRel = 'data/move-automation-abandoned-pending-resolutions.json'
const ENCOUNTER_STATE_SCHEMA_VERSION = 1

class ExportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ExportError'
  }
}

const messageFromError = (error) => error instanceof Error ? error.message : String(error)

const expandHome = (value) => value === '~' || value.startsWith('~/') ? `${homedir()}${value.slice(1)}` : value

const resolvePath = (raw, base) => {
  const expanded = expandHome(String(raw ?? '').trim())
  if (!expanded) return ''
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded)
}

const pathIsInsideRoot = (root, target) => {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const assertSafeOutput = (outputPath, force) => {
  if (!outputPath) throw new ExportError('--output is required')
  const root = parsePath(outputPath).root
  if (outputPath === root) throw new ExportError('output must not be the filesystem root')
  if (outputPath === homedir()) throw new ExportError('output must not be the user home directory')
  if (pathIsInsideRoot(appRoot, outputPath)) throw new ExportError('output must not be inside the Rotom Table app checkout')
  if (existsSync(outputPath) && !force) throw new ExportError('output already exists; pass --force to replace it')
}

const parseArgs = (args) => {
  const options = { output: '', force: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--force') options.force = true
    else if (arg === '--output') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new ExportError('--output requires a path')
      options.output = value
      index += 1
    } else {
      throw new ExportError(`Unknown option: ${arg}`)
    }
  }
  return options
}

const campaignRoot = (env) => resolvePath(env[ROTOM_CAMPAIGN_ROOT_ENV] || process.cwd(), appRoot)

const databasePath = (env, root) => {
  const raw = env[ROTOM_DB_PATH_ENV]
  if (!raw || !raw.trim()) return resolve(root, DEFAULT_ROTOM_DB_FILENAME)
  if (raw.trim() === ':memory:') throw new ExportError('ROTOM_DB_PATH=:memory: cannot be exported')
  return resolvePath(raw, root)
}

const stableJsonStringify = (value) => `${JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  return Object.keys(item).sort().reduce((out, key) => {
    if (item[key] !== undefined) out[key] = item[key]
    return out
  }, {})
}, 2)}\n`

const parseDocument = (json, label) => {
  try {
    return JSON.parse(json)
  } catch (error) {
    throw new Error(`${label} document_json could not be parsed: ${messageFromError(error)}`)
  }
}

const folderPrefixes = (folder) => {
  if (!folder) return []
  const parts = folder.split('/')
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
}

const ensureFolder = (path) => mkdirSync(path, { recursive: true, mode: 0o750 })

const writeDocument = (outputRoot, rootRel, folder, slug, document) => {
  const dir = folder ? join(outputRoot, rootRel, folder) : join(outputRoot, rootRel)
  ensureFolder(dir)
  writeFileSync(join(dir, `${slug}.json`), stableJsonStringify(document), { mode: 0o600 })
}

const exportDatabase = (connection, outputRoot) => {
  const counts = { maps: 0, pokemon: 0, trainer: 0, groupInventories: 0, shops: 0, folders: 0, pendingResolutionsAbandoned: 0 }
  const abandonedPendingResolutions = []
  connection.exec('BEGIN')
  try {
    const mapFolders = new Set()
    const sheetFolders = { pokemon: new Set(), trainer: new Set() }
    const shopFolders = new Set()

    for (const row of connection.prepare('SELECT path FROM map_folders ORDER BY path ASC').all()) {
      if (typeof row.path === 'string' && row.path) mapFolders.add(row.path)
    }
    for (const row of connection.prepare('SELECT kind, path FROM sheet_folders ORDER BY kind ASC, path ASC').all()) {
      if (sheetKinds.includes(row.kind) && typeof row.path === 'string' && row.path) sheetFolders[row.kind].add(row.path)
    }

    const maps = connection.prepare('SELECT slug, document_json, revision, updated_at FROM maps ORDER BY slug ASC').all()
    for (const row of maps) {
      const document = parseDocument(row.document_json, `map ${row.slug}`)
      const encounterState = document?.encounterState
      if (encounterState !== undefined) {
        if (!encounterState || typeof encounterState !== 'object' || Array.isArray(encounterState)) {
          throw new Error(`map ${row.slug} encounterState must be an object`)
        }
        if (encounterState.schemaVersion !== ENCOUNTER_STATE_SCHEMA_VERSION) {
          throw new Error(`map ${row.slug} encounterState schemaVersion ${String(encounterState.schemaVersion)} is unsupported`)
        }
        if (!Array.isArray(encounterState.pendingResolutionSummaries)) {
          throw new Error(`map ${row.slug} encounterState.pendingResolutionSummaries must be an array`)
        }
        for (const summary of encounterState.pendingResolutionSummaries) {
          if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
            throw new Error(`map ${row.slug} contains an invalid pending resolution summary`)
          }
          abandonedPendingResolutions.push({
            resolutionId: String(summary.resolutionId ?? ''),
            mapSlug: row.slug,
            previousStatus: String(summary.status ?? 'pending'),
            updatedAt: Number(summary.updatedAt ?? row.updated_at),
          })
        }
        // JSON exports deliberately abandon resumable prompts. Private repository
        // rows remain in the source SQLite backup; the audit below makes this
        // terminal policy explicit rather than emitting zombie public prompts.
        encounterState.pendingResolutionSummaries = []
      }
      document.slug = row.slug
      document.revision = Number(row.revision)
      document.updatedAt = Number(row.updated_at)
      const folder = typeof document.folder === 'string' ? document.folder : ''
      for (const prefix of folderPrefixes(folder)) mapFolders.add(prefix)
      writeDocument(outputRoot, 'data/maps', folder, row.slug, document)
      counts.maps += 1
    }

    const sheets = connection.prepare('SELECT kind, slug, document_json, revision, updated_at FROM sheets ORDER BY kind ASC, slug ASC').all()
    for (const row of sheets) {
      if (!sheetKinds.includes(row.kind)) continue
      const document = parseDocument(row.document_json, `${row.kind} sheet ${row.slug}`)
      document.slug = row.slug
      document.revision = Number(row.revision)
      document.updatedAt = Number(row.updated_at)
      const folder = typeof document.folder === 'string' ? document.folder : ''
      for (const prefix of folderPrefixes(folder)) sheetFolders[row.kind].add(prefix)
      writeDocument(outputRoot, row.kind === 'pokemon' ? 'data/sheets' : 'data/trainers', folder, row.slug, document)
      counts[row.kind] += 1
    }

    const groupInventories = connection.prepare('SELECT slug, document_json, revision, updated_at FROM group_inventories ORDER BY slug ASC').all()
    for (const row of groupInventories) {
      const document = parseDocument(row.document_json, `group inventory ${row.slug}`)
      document.slug = row.slug
      document.revision = Number(row.revision)
      document.updatedAt = Number(row.updated_at)
      writeDocument(outputRoot, groupInventoryRootRel, '', row.slug, document)
      counts.groupInventories += 1
    }

    const shopTables = connection.prepare('SELECT slug, document_json, revision, updated_at FROM shop_tables ORDER BY slug ASC').all()
    for (const row of shopTables) {
      const document = parseDocument(row.document_json, `shop table ${row.slug}`)
      document.slug = row.slug
      document.revision = Number(row.revision)
      document.updatedAt = Number(row.updated_at)
      const folder = typeof document.folder === 'string' ? document.folder : ''
      for (const prefix of folderPrefixes(folder)) shopFolders.add(prefix)
      writeDocument(outputRoot, shopTableRootRel, folder, row.slug, document)
      counts.shops += 1
    }

    for (const folder of [...mapFolders].sort()) {
      ensureFolder(join(outputRoot, 'data/maps', folder))
      counts.folders += 1
    }
    for (const kind of sheetKinds) {
      for (const folder of [...sheetFolders[kind]].sort()) {
        ensureFolder(join(outputRoot, kind === 'pokemon' ? 'data/sheets' : 'data/trainers', folder))
        counts.folders += 1
      }
    }
    for (const folder of [...shopFolders].sort()) {
      ensureFolder(join(outputRoot, shopTableRootRel, folder))
      counts.folders += 1
    }

    if (abandonedPendingResolutions.length > 0) {
      const auditPath = join(outputRoot, pendingResolutionAuditRel)
      ensureFolder(dirname(auditPath))
      writeFileSync(auditPath, stableJsonStringify({
        schemaVersion: 1,
        policy: 'terminally-abandoned-on-json-export',
        resolutions: abandonedPendingResolutions.sort((left, right) => (
          left.mapSlug.localeCompare(right.mapSlug)
          || left.resolutionId.localeCompare(right.resolutionId)
        )),
      }), { mode: 0o600 })
      counts.pendingResolutionsAbandoned = abandonedPendingResolutions.length
    }

    connection.exec('COMMIT')
    return counts
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}

export const runExportCli = (argv = process.argv.slice(2), env = process.env) => {
  let options
  try {
    options = parseArgs(argv)
    if (options.help) {
      process.stdout.write(HELP_TEXT)
      return 0
    }
    const root = campaignRoot(env)
    const dbPath = databasePath(env, root)
    const output = resolvePath(options.output, appRoot)
    assertSafeOutput(output, options.force)
    if (existsSync(output) && options.force) rmSync(output, { recursive: true, force: true })
    ensureFolder(output)
    const connection = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const counts = exportDatabase(connection, output)
      process.stdout.write([
        'Rotom Table SQLite JSON export',
        `Database path: ${dbPath}`,
        `Output: ${output}`,
        `Maps exported: ${counts.maps}`,
        `Pokémon sheets exported: ${counts.pokemon}`,
        `Trainer sheets exported: ${counts.trainer}`,
        `Group inventories exported: ${counts.groupInventories}`,
        `Shops exported: ${counts.shops}`,
        `Folders recreated: ${counts.folders}`,
        `Pending resolutions terminally abandoned: ${counts.pendingResolutionsAbandoned}`,
      ].join('\n') + '\n')
      return 0
    } finally {
      connection.close()
    }
  } catch (error) {
    process.stderr.write(`${messageFromError(error)}\n\n${HELP_TEXT}`)
    return error instanceof ExportError ? 2 : 1
  }
}

if (scriptPath === resolve(process.argv[1] ?? '')) {
  process.exitCode = runExportCli()
}
