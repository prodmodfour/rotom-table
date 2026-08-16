#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

export const ROTOM_CAMPAIGN_ROOT_ENV = 'ROTOM_CAMPAIGN_ROOT'
export const ROTOM_DB_PATH_ENV = 'ROTOM_DB_PATH'
export const DEFAULT_ROTOM_DB_FILENAME = 'rotom-table.sqlite'
export const DEFAULT_MIGRATION_BACKUP_DIRNAME = 'backups'
export const SQLITE_MIGRATION_BACKUP_PREFIX = 'rotom-sqlite-migration-'
export const STORAGE_SCHEMA_VERSION = 28

const scriptPath = fileURLToPath(import.meta.url)
const appRoot = resolve(dirname(scriptPath), '..')
const sqliteMemoryPath = ':memory:'
const slugRe = /^[a-z0-9-]+$/
const playerProfileIdRe = /^profile_[A-Za-z0-9_-]{8,64}$/
const playerProfileDisplayNameMaxLength = 64
const sheetKinds = ['pokemon', 'trainer']
const groupInventoryRootRelativePath = 'data/group-inventories'
const shopTableRootRelativePath = 'data/shops'
const groupInventorySectionKeys = ['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment']
const groupInventoryRowIdPrefix = 'group-item'
const knownCampaignDirectories = [
  'data/maps',
  'data/sheets',
  'data/trainers',
  groupInventoryRootRelativePath,
  shopTableRootRelativePath,
  'data/player-profiles',
  'data/reference-overrides',
  'encounter_tables',
]

const HELP_TEXT = `Rotom Table JSON-to-SQLite campaign migration

Usage:
  ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign npm run migrate:sqlite -- [options]
  ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign node scripts/migrate-campaign-to-sqlite.mjs [options]

Options:
  --backup-root <path>  Directory for the pre-migration backup. Defaults to a sibling "${DEFAULT_MIGRATION_BACKUP_DIRNAME}" directory beside ROTOM_CAMPAIGN_ROOT.
  --help, -h            Show this help.

The command requires ROTOM_CAMPAIGN_ROOT to point at an existing private campaign directory outside the app checkout. JSON source files are left in place.
`

export class CampaignSqliteMigrationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CampaignSqliteMigrationError'
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const messageFromError = (error) => error instanceof Error ? error.message : String(error)

const pathIsInsideRoot = (root, target) => {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const assertPathOutsideAppCheckout = (path, label) => {
  if (pathIsInsideRoot(appRoot, path)) {
    throw new CampaignSqliteMigrationError(
      `${label} must not be inside the Rotom Table app checkout; choose a private campaign/backups path outside Git`,
    )
  }
}

const expandHome = (value) => {
  if (value === '~' || value.startsWith('~/')) return `${homedir()}${value.slice(1)}`
  return value
}

const resolveConfiguredPath = (rawValue, baseDir) => {
  const expanded = expandHome(String(rawValue ?? '').trim())
  if (!expanded) return ''
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded)
}

const assertDirectoryExists = (path, label) => {
  let stats
  try {
    stats = statSync(path)
  } catch {
    throw new CampaignSqliteMigrationError(`${label} does not exist: ${path}`)
  }

  if (!stats.isDirectory()) throw new CampaignSqliteMigrationError(`${label} must be a directory: ${path}`)
}

const assertNotDangerousRoot = (path, label) => {
  const root = parsePath(path).root
  if (path === root) throw new CampaignSqliteMigrationError(`${label} must not be the filesystem root`)
  if (path === homedir()) throw new CampaignSqliteMigrationError(`${label} must not be the user's home directory`)
}

export const parseMigrationCliArgs = (args = []) => {
  const options = {
    backupRoot: null,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--backup-root': {
        const value = args[index + 1]
        if (value === undefined || value.startsWith('--')) {
          throw new CampaignSqliteMigrationError('--backup-root requires a path')
        }
        options.backupRoot = value
        index += 1
        break
      }
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new CampaignSqliteMigrationError(`Unknown option: ${arg}`)
    }
  }

  return options
}

const resolveCampaignRoot = (env) => {
  const rawRoot = env[ROTOM_CAMPAIGN_ROOT_ENV]
  if (!rawRoot || !rawRoot.trim()) {
    throw new CampaignSqliteMigrationError(
      `${ROTOM_CAMPAIGN_ROOT_ENV} must be set to an existing private campaign directory before running the SQLite migration`,
    )
  }

  const campaignRoot = resolveConfiguredPath(rawRoot, appRoot)
  assertDirectoryExists(campaignRoot, ROTOM_CAMPAIGN_ROOT_ENV)
  assertNotDangerousRoot(campaignRoot, ROTOM_CAMPAIGN_ROOT_ENV)
  assertPathOutsideAppCheckout(campaignRoot, ROTOM_CAMPAIGN_ROOT_ENV)
  if (pathIsInsideRoot(campaignRoot, appRoot)) {
    throw new CampaignSqliteMigrationError(
      `${ROTOM_CAMPAIGN_ROOT_ENV} must not contain the Rotom Table app checkout; point it at the private campaign directory itself`,
    )
  }
  return campaignRoot
}

const resolveDatabasePath = (env, campaignRoot) => {
  const rawPath = env[ROTOM_DB_PATH_ENV]
  if (!rawPath || !rawPath.trim()) return resolve(campaignRoot, DEFAULT_ROTOM_DB_FILENAME)

  const trimmed = rawPath.trim()
  if (trimmed === sqliteMemoryPath) {
    throw new CampaignSqliteMigrationError(`${ROTOM_DB_PATH_ENV}=${sqliteMemoryPath} is not valid for campaign migration`)
  }

  const databasePath = resolveConfiguredPath(trimmed, campaignRoot)
  assertPathOutsideAppCheckout(databasePath, ROTOM_DB_PATH_ENV)
  return databasePath
}

const resolveBackupRoot = (rawBackupRoot, campaignRoot) => {
  const backupRoot = rawBackupRoot
    ? resolveConfiguredPath(rawBackupRoot, appRoot)
    : resolve(dirname(campaignRoot), DEFAULT_MIGRATION_BACKUP_DIRNAME)

  assertNotDangerousRoot(backupRoot, 'backup root')
  assertPathOutsideAppCheckout(backupRoot, 'backup root')
  if (pathIsInsideRoot(campaignRoot, backupRoot)) {
    throw new CampaignSqliteMigrationError('backup root must not be inside ROTOM_CAMPAIGN_ROOT; choose a sibling/private backup directory')
  }
  return backupRoot
}

const timestampForBackup = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('.', '')

const uniqueBackupDirectory = (backupRoot, now = new Date()) => {
  const stamp = timestampForBackup(now)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt}`
    const candidate = join(backupRoot, `${SQLITE_MIGRATION_BACKUP_PREFIX}${stamp}${suffix}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new CampaignSqliteMigrationError('Could not allocate a unique migration backup directory')
}

const relativePath = (fromRoot, target) => relative(fromRoot, target).split(sep).join('/')

const copyIfExists = (sourcePath, targetPath, copied) => {
  if (!existsSync(sourcePath)) return
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o750 })
  cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: false, force: true, preserveTimestamps: true })
  copied.push(targetPath)
}

const databaseSidecarPaths = (databasePath) => [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]

export const createMigrationBackup = ({ campaignRoot, backupRoot, databasePath, now = new Date() }) => {
  mkdirSync(backupRoot, { recursive: true, mode: 0o750 })
  const backupPath = uniqueBackupDirectory(backupRoot, now)
  const campaignBackupRoot = join(backupPath, 'campaign')
  const copied = []

  for (const relativeSource of knownCampaignDirectories) {
    const source = resolve(campaignRoot, relativeSource)
    const target = resolve(campaignBackupRoot, relativeSource)
    copyIfExists(source, target, copied)
  }

  for (const source of databaseSidecarPaths(databasePath)) {
    if (pathIsInsideRoot(campaignRoot, source)) {
      const target = resolve(campaignBackupRoot, relativePath(campaignRoot, source))
      copyIfExists(source, target, copied)
    } else {
      const target = resolve(backupPath, 'database', basename(source))
      copyIfExists(source, target, copied)
    }
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date(now.getTime()).toISOString(),
    campaignRoot,
    databasePath,
    copiedPaths: copied.map((path) => relativePath(backupPath, path)),
    note: 'Pre-migration private backup. Keep outside Git and operator-controlled.',
  }
  mkdirSync(backupPath, { recursive: true, mode: 0o750 })
  writeFileSync(join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })

  return {
    path: backupPath,
    copiedCount: copied.length,
  }
}

const isJsonFile = (entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('.')

const walkJsonFiles = (root) => {
  if (!existsSync(root)) return []

  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) walk(path)
        continue
      }
      if (isJsonFile(entry)) files.push(path)
    }
  }

  walk(root)
  return files.sort((left, right) => left.localeCompare(right))
}

const walkFolders = (root) => {
  if (!existsSync(root)) return []
  const folders = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      folders.push(folderFromRoot(root, path))
      walk(path)
    }
  }
  walk(root)
  return folders.filter(Boolean).sort((left, right) => left.localeCompare(right))
}

const parseJsonFile = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${messageFromError(error)}`)
  }
}

const validateSlug = (value, label) => {
  const slug = String(value ?? '')
  if (!slugRe.test(slug)) throw new Error(`${label} must match /^[a-z0-9-]+$/`)
  return slug
}

const normalizeRevision = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0

const timestampFromFile = (path) => Math.max(0, Math.round(statSync(path).mtimeMs))

const normalizeTimestamp = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback

const trimString = (value) => typeof value === 'string' ? value.trim() : ''

const normalizeOptionalString = (value) => {
  const trimmed = trimString(value)
  return trimmed ? trimmed : undefined
}

const coerceSafeNonNegativeInteger = (value, fallback = 0) => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) return fallback
  if (numericValue <= 0) return 0
  return Math.min(Math.floor(numericValue), Number.MAX_SAFE_INTEGER)
}

const folderFromRoot = (root, filePath) => {
  const directory = dirname(relative(root, filePath)).split(sep).join('/')
  return directory === '.' ? '' : directory
}

const assertObjectDocument = (value, label) => {
  if (!isRecord(value)) throw new Error(`${label} must contain a JSON object`)
  return value
}

const assertMapDimensions = (dimensions, label) => {
  if (!isRecord(dimensions)) throw new Error(`${label} dimensions must be an object`)
  for (const axis of ['x', 'y', 'z']) {
    const value = dimensions[axis]
    if (!Number.isInteger(value) || value < 1 || value > 200) {
      throw new Error(`${label} dimensions.${axis} must be an integer 1..200`)
    }
  }
}

const assertMapVoxels = (voxels, label) => {
  if (!Array.isArray(voxels)) throw new Error(`${label} voxels must be an array`)
  for (const [index, voxel] of voxels.entries()) {
    if (!isRecord(voxel)) throw new Error(`${label} voxels[${index}] must be an object`)
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isInteger(voxel[axis])) throw new Error(`${label} voxels[${index}].${axis} must be an integer`)
    }
    if (typeof voxel.materialId !== 'string' || !voxel.materialId.trim()) {
      throw new Error(`${label} voxels[${index}].materialId must be a non-empty string`)
    }
  }
}

const assertLoadableMapDocument = (map, label) => {
  if (!isRecord(map)) throw new Error(`${label} document must be an object`)
  if (map.schemaVersion !== 2) throw new Error(`${label} schemaVersion must be 2`)
  validateSlug(map.slug, `${label} slug`)
  if (typeof map.name !== 'string' || !map.name.trim()) throw new Error(`${label} name must be a non-empty string`)
  assertMapDimensions(map.dimensions, label)
  assertMapVoxels(map.voxels, label)
}

const normalizeMapFile = (mapsRoot, sourcePath) => {
  const map = assertObjectDocument(parseJsonFile(sourcePath, `Map ${sourcePath}`), `Map ${sourcePath}`)
  assertLoadableMapDocument(map, `Map ${sourcePath}`)
  const slug = validateSlug(map.slug, `Map ${sourcePath} slug`)

  const revision = normalizeRevision(map.revision)
  const updatedAt = normalizeTimestamp(map.updatedAt, timestampFromFile(sourcePath))
  return {
    slug,
    document: {
      ...map,
      revision,
      slug,
      folder: folderFromRoot(mapsRoot, sourcePath),
      updatedAt,
    },
    revision,
    updatedAt,
    sourcePath,
  }
}

const slugFromFilePath = (path) => validateSlug(basename(path, extname(path)), `sheet file ${path} slug`)

const normalizeSheetFile = (kind, root, sourcePath) => {
  const sheet = assertObjectDocument(parseJsonFile(sourcePath, `${kind} sheet ${sourcePath}`), `${kind} sheet ${sourcePath}`)
  const slug = validateSlug(typeof sheet.slug === 'string' && sheet.slug.trim() ? sheet.slug : slugFromFilePath(sourcePath), `${kind} sheet ${sourcePath} slug`)
  const revision = normalizeRevision(sheet.revision)
  const updatedAt = normalizeTimestamp(sheet.updatedAt, timestampFromFile(sourcePath))

  return {
    kind,
    slug,
    folder: folderFromRoot(root, sourcePath),
    document: {
      ...sheet,
      slug,
      folder: folderFromRoot(root, sourcePath),
      revision,
      updatedAt,
    },
    revision,
    updatedAt,
    sourcePath,
  }
}

const groupInventoryRowsFromUnknown = (value) => {
  if (Array.isArray(value)) return value.filter((entry) => isRecord(entry) || typeof entry === 'string')
  if (!isRecord(value)) return []
  if (Object.hasOwn(value, 'name') || Object.hasOwn(value, 'id')) return [value]
  return Object.values(value).filter((entry) => isRecord(entry) || typeof entry === 'string')
}

const sectionUsesQuantity = (section) => section !== 'equipment'

const uniqueGroupInventoryRowId = (rawId, section, index, usedIds) => {
  const preferred = trimString(rawId)
  if (preferred && !usedIds.has(preferred)) {
    usedIds.add(preferred)
    return preferred
  }

  for (let counter = index + 1; counter < Number.MAX_SAFE_INTEGER; counter += 1) {
    const candidate = `${groupInventoryRowIdPrefix}-${section}-${counter.toString(36)}`
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate)
      return candidate
    }
  }

  throw new Error('Could not allocate a unique group inventory row id')
}

const normalizeGroupInventoryEntry = (rawEntry, section, index, usedIds) => {
  const source = typeof rawEntry === 'string' ? { name: rawEntry } : rawEntry
  const entry = {
    id: uniqueGroupInventoryRowId(source.id, section, index, usedIds),
    name: trimString(source.name),
  }

  if (sectionUsesQuantity(section) && Object.hasOwn(source, 'qty')) {
    entry.qty = coerceSafeNonNegativeInteger(source.qty)
  }

  for (const field of ['cost', 'description', 'mod', 'slot']) {
    if (!Object.hasOwn(source, field)) continue
    if (field === 'cost' && typeof source[field] === 'number' && Number.isFinite(source[field])) {
      entry[field] = source[field]
      continue
    }
    const normalized = normalizeOptionalString(source[field])
    if (normalized !== undefined) entry[field] = normalized
  }

  return entry
}

const normalizeGroupInventorySections = (inventory) => {
  const source = isRecord(inventory) ? inventory : {}
  const usedIds = new Set()
  return Object.fromEntries(groupInventorySectionKeys.map((section) => [
    section,
    groupInventoryRowsFromUnknown(source[section]).map((entry, index) => (
      normalizeGroupInventoryEntry(entry, section, index, usedIds)
    )),
  ]))
}

const normalizeGroupInventoryDocument = (document, { slug, revision, updatedAt }) => {
  const source = assertObjectDocument(document, `Group inventory ${slug}`)
  const normalized = {
    slug,
    revision,
    updatedAt,
    money: coerceSafeNonNegativeInteger(source.money),
    inventory: normalizeGroupInventorySections(source.inventory),
  }
  const notes = normalizeOptionalString(source.notes)
  if (notes !== undefined) normalized.notes = notes
  return normalized
}

const normalizeGroupInventoryFile = (sourcePath) => {
  const groupInventory = assertObjectDocument(
    parseJsonFile(sourcePath, `Group inventory ${sourcePath}`),
    `Group inventory ${sourcePath}`,
  )
  const slug = validateSlug(
    typeof groupInventory.slug === 'string' && groupInventory.slug.trim()
      ? groupInventory.slug
      : slugFromFilePath(sourcePath),
    `Group inventory ${sourcePath} slug`,
  )
  const revision = normalizeRevision(groupInventory.revision)
  const updatedAt = normalizeTimestamp(groupInventory.updatedAt, timestampFromFile(sourcePath))

  return {
    slug,
    document: normalizeGroupInventoryDocument(groupInventory, { slug, revision, updatedAt }),
    revision,
    updatedAt,
    sourcePath,
  }
}

const validatePlayerProfileFile = (profilesRoot, sourcePath) => {
  const profile = assertObjectDocument(parseJsonFile(sourcePath, `Player profile ${sourcePath}`), `Player profile ${sourcePath}`)
  const expectedId = basename(sourcePath, extname(sourcePath))
  if (!playerProfileIdRe.test(String(profile.id ?? ''))) throw new Error(`Player profile ${sourcePath} id must match /^profile_[A-Za-z0-9_-]{8,64}$/`)
  if (profile.id !== expectedId) throw new Error(`Player profile ${sourcePath} id must match the file name`)
  if (profile.schemaVersion !== 1) throw new Error(`Player profile ${sourcePath} schemaVersion must be 1`)
  if (typeof profile.displayName !== 'string' || profile.displayName.length < 1 || Array.from(profile.displayName).length > playerProfileDisplayNameMaxLength) {
    throw new Error(`Player profile ${sourcePath} displayName must be 1-${playerProfileDisplayNameMaxLength} characters`)
  }
  if (!Array.isArray(profile.linkedCharacters)) throw new Error(`Player profile ${sourcePath} linkedCharacters must be an array`)
  for (const [index, ref] of profile.linkedCharacters.entries()) {
    if (!isRecord(ref)) throw new Error(`Player profile ${sourcePath} linkedCharacters[${index}] must be an object`)
    if (!sheetKinds.includes(ref.sheetKind)) throw new Error(`Player profile ${sourcePath} linkedCharacters[${index}].sheetKind must be pokemon or trainer`)
    validateSlug(ref.sheetSlug, `Player profile ${sourcePath} linkedCharacters[${index}].sheetSlug`)
  }
  return {
    id: profile.id,
    sourcePath,
    folder: folderFromRoot(profilesRoot, sourcePath),
  }
}

const collectWithErrors = (files, normalize) => {
  const records = []
  const errors = []
  for (const file of files) {
    try {
      records.push(normalize(file))
    } catch (error) {
      errors.push(`${file}: ${messageFromError(error)}`)
    }
  }
  return { records, errors }
}

export const createMigrationPlan = (campaignRoot) => {
  const mapsRoot = resolve(campaignRoot, 'data/maps')
  const pokemonSheetsRoot = resolve(campaignRoot, 'data/sheets')
  const trainerSheetsRoot = resolve(campaignRoot, 'data/trainers')
  const groupInventoriesRoot = resolve(campaignRoot, groupInventoryRootRelativePath)
  const profilesRoot = resolve(campaignRoot, 'data/player-profiles')

  const mapPlan = collectWithErrors(walkJsonFiles(mapsRoot), (path) => normalizeMapFile(mapsRoot, path))
  const sheetPlan = { records: [], errors: [] }
  for (const [kind, root] of [['pokemon', pokemonSheetsRoot], ['trainer', trainerSheetsRoot]]) {
    const plan = collectWithErrors(walkJsonFiles(root), (path) => normalizeSheetFile(kind, root, path))
    sheetPlan.records.push(...plan.records)
    sheetPlan.errors.push(...plan.errors)
  }
  const groupInventoryPlan = collectWithErrors(
    walkJsonFiles(groupInventoriesRoot),
    (path) => normalizeGroupInventoryFile(path),
  )
  const profilePlan = collectWithErrors(walkJsonFiles(profilesRoot), (path) => validatePlayerProfileFile(profilesRoot, path))
  const mapFolders = walkFolders(mapsRoot)
  const sheetFolders = [
    ...walkFolders(pokemonSheetsRoot).map((path) => ({ kind: 'pokemon', path })),
    ...walkFolders(trainerSheetsRoot).map((path) => ({ kind: 'trainer', path })),
  ]

  return {
    roots: {
      maps: mapsRoot,
      pokemonSheets: pokemonSheetsRoot,
      trainerSheets: trainerSheetsRoot,
      groupInventories: groupInventoriesRoot,
      playerProfiles: profilesRoot,
    },
    maps: mapPlan.records,
    sheets: sheetPlan.records,
    groupInventories: groupInventoryPlan.records,
    mapFolders,
    sheetFolders,
    playerProfiles: profilePlan.records,
    errors: [...mapPlan.errors, ...sheetPlan.errors, ...groupInventoryPlan.errors, ...profilePlan.errors],
  }
}

const readUserVersion = (connection) => {
  const row = connection.prepare('PRAGMA user_version').get()
  const version = row?.user_version
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('SQLite user_version must be a safe non-negative integer')
  return version
}

const setUserVersion = (connection, version) => {
  connection.exec(`PRAGMA user_version = ${version}`)
}

const applyStorageMigrations = (connection) => {
  const fromVersion = readUserVersion(connection)
  if (fromVersion > STORAGE_SCHEMA_VERSION) {
    throw new Error(`SQLite schema version ${fromVersion} is newer than this migration supports (${STORAGE_SCHEMA_VERSION})`)
  }

  const foreignKeysBefore = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
  const suspendForeignKeyActions = fromVersion < 28 && foreignKeysBefore === 1
  if (suspendForeignKeyActions) connection.exec('PRAGMA foreign_keys = OFF')
  connection.exec('BEGIN IMMEDIATE')
  try {
    if (fromVersion < 1) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS maps (
          slug TEXT PRIMARY KEY,
          document_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sheets (
          kind TEXT NOT NULL,
          slug TEXT NOT NULL,
          document_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (kind, slug)
        );

        CREATE TABLE IF NOT EXISTS live_play_ops (
          op_id TEXT PRIMARY KEY,
          map_slug TEXT NOT NULL,
          command_hash TEXT NOT NULL,
          command_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          result_revision INTEGER,
          created_at INTEGER NOT NULL
        );
      `)
      setUserVersion(connection, 1)
    }
    if (fromVersion < 2) {
      connection.exec(`
        CREATE INDEX IF NOT EXISTS live_play_ops_map_revision_idx
          ON live_play_ops (map_slug, result_revision);
      `)
      setUserVersion(connection, 2)
    }
    if (fromVersion < 3) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS map_interaction_modes (
          slug TEXT PRIMARY KEY,
          interaction_mode TEXT NOT NULL CHECK (interaction_mode IN ('setup-edit', 'live-play')),
          updated_at INTEGER NOT NULL
        );
      `)
      setUserVersion(connection, 3)
    }
    if (fromVersion < 4) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS map_folders (
          path TEXT PRIMARY KEY,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sheet_folders (
          kind TEXT NOT NULL,
          path TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (kind, path)
        );
      `)
      setUserVersion(connection, 4)
    }
    if (fromVersion < 5) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS realtime_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          dedupe_key TEXT UNIQUE,
          material_hash TEXT NOT NULL,
          channel TEXT NOT NULL,
          event_type TEXT NOT NULL,
          access_json TEXT NOT NULL,
          event_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS realtime_events_channel_sequence_idx
          ON realtime_events (channel, sequence);

        CREATE INDEX IF NOT EXISTS realtime_events_created_at_idx
          ON realtime_events (created_at, sequence);

        CREATE TABLE IF NOT EXISTS realtime_event_log_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          latest_sequence INTEGER NOT NULL,
          earliest_available_sequence INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO realtime_event_log_state (
          singleton,
          latest_sequence,
          earliest_available_sequence
        ) VALUES (1, 0, 1);
      `)
      setUserVersion(connection, 5)
    }
    if (fromVersion < 6) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS group_inventories (
          slug TEXT PRIMARY KEY,
          document_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      setUserVersion(connection, 6)
    }
    if (fromVersion < 7) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS shop_tables (
          slug TEXT PRIMARY KEY,
          document_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      setUserVersion(connection, 7)
    }
    if (fromVersion < 8) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS shop_checkout_ops (
          op_id TEXT PRIMARY KEY,
          shop_slug TEXT NOT NULL,
          command_hash TEXT NOT NULL,
          command_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          result_revision INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS shop_checkout_ops_shop_revision_idx
          ON shop_checkout_ops (shop_slug, result_revision);
      `)
      setUserVersion(connection, 8)
    }
    if (fromVersion < 9) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS pending_move_resolutions (
          resolution_id TEXT PRIMARY KEY,
          map_slug TEXT NOT NULL,
          origin_op_id TEXT NOT NULL,
          resolution_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN (
              'pending',
              'resuming',
              'committed',
              'cancelled',
              'expired',
              'conflicted',
              'abandoned'
            )
          ),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
          terminal_op_id TEXT UNIQUE,
          UNIQUE (map_slug, origin_op_id),
          FOREIGN KEY (terminal_op_id) REFERENCES live_play_ops (op_id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS pending_move_resolutions_map_status_idx
          ON pending_move_resolutions (map_slug, status, updated_at, resolution_id);
      `)
      setUserVersion(connection, 9)
    }
    if (fromVersion < 10) {
      connection.exec(`
        ALTER TABLE pending_move_resolutions
        ADD COLUMN declaration_plan_json TEXT;
      `)
      setUserVersion(connection, 10)
    }
    if (fromVersion < 11) {
      connection.exec(`
        ALTER TABLE live_play_ops
        ADD COLUMN move_compensation_json TEXT;
      `)
      setUserVersion(connection, 11)
    }
    if (fromVersion < 12) {
      connection.exec(`
        ALTER TABLE live_play_ops
        ADD COLUMN correction_origin_op_id TEXT
          REFERENCES live_play_ops (op_id) ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS live_play_ops_correction_origin_idx
          ON live_play_ops (map_slug, correction_origin_op_id, created_at);
      `)
      setUserVersion(connection, 12)
    }
    if (fromVersion < 13) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS ability_declaration_offers (
          offer_id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          request_sha256 TEXT NOT NULL,
          map_slug TEXT NOT NULL,
          map_revision INTEGER NOT NULL CHECK (map_revision >= 0),
          actor_placement_id TEXT NOT NULL,
          offer_json TEXT NOT NULL,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
          consumed_intent_sha256 TEXT,
          consumed_at INTEGER,
          CHECK ((consumed_intent_sha256 IS NULL) = (consumed_at IS NULL))
        );

        CREATE INDEX IF NOT EXISTS ability_declaration_offers_map_expiry_idx
          ON ability_declaration_offers (map_slug, expires_at, offer_id);
      `)
      setUserVersion(connection, 13)
    }
    if (fromVersion < 14) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS ability_resolution_ops (
          intent_id TEXT PRIMARY KEY,
          intent_sha256 TEXT NOT NULL,
          map_slug TEXT NOT NULL,
          intent_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          audit_json TEXT NOT NULL,
          result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
          created_at INTEGER NOT NULL CHECK (created_at >= 0)
        );

        CREATE INDEX IF NOT EXISTS ability_resolution_ops_map_revision_idx
          ON ability_resolution_ops (map_slug, result_revision, intent_id);
      `)
      setUserVersion(connection, 14)
    }
    if (fromVersion < 15) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS capability_resolution_ops (
          operation_id TEXT PRIMARY KEY,
          command_sha256 TEXT NOT NULL,
          map_slug TEXT NOT NULL,
          command_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          audit_json TEXT NOT NULL,
          result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
          created_at INTEGER NOT NULL CHECK (created_at >= 0)
        );

        CREATE INDEX IF NOT EXISTS capability_resolution_ops_map_revision_idx
          ON capability_resolution_ops (map_slug, result_revision, operation_id);
      `)
      setUserVersion(connection, 15)
    }
    if (fromVersion < 16) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS capability_adjudications (
          request_id TEXT PRIMARY KEY,
          command_sha256 TEXT NOT NULL,
          map_slug TEXT NOT NULL,
          actor_placement_id TEXT NOT NULL,
          canonical_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          command_json TEXT NOT NULL,
          definition_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
          requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
          expires_at INTEGER NOT NULL CHECK (expires_at > requested_at),
          resolved_at INTEGER NULL CHECK (resolved_at IS NULL OR resolved_at >= requested_at),
          resolution_operation_id TEXT NULL
        );

        CREATE INDEX IF NOT EXISTS capability_adjudications_map_status_idx
          ON capability_adjudications (map_slug, status, expires_at, request_id);
      `)
      setUserVersion(connection, 16)
    }
    if (fromVersion < 17) {
      connection.exec('ALTER TABLE capability_adjudications ADD COLUMN resolution_command_sha256 TEXT NULL')
      setUserVersion(connection, 17)
    }
    if (fromVersion < 18) {
      connection.exec('ALTER TABLE capability_adjudications ADD COLUMN resolution_map_revision INTEGER NULL')
      setUserVersion(connection, 18)
    }
    if (fromVersion < 19) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS encounter_documents (
          encounter_id TEXT PRIMARY KEY,
          linked_map_slug TEXT NOT NULL,
          document_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
        );

        CREATE INDEX IF NOT EXISTS encounter_documents_map_updated_idx
          ON encounter_documents (linked_map_slug, updated_at DESC, encounter_id);

        CREATE TABLE IF NOT EXISTS encounter_director_ops (
          command_id TEXT PRIMARY KEY,
          encounter_id TEXT NOT NULL,
          command_sha256 TEXT NOT NULL,
          command_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          FOREIGN KEY (encounter_id) REFERENCES encounter_documents (encounter_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS encounter_director_ops_encounter_revision_idx
          ON encounter_director_ops (encounter_id, result_revision, command_id);
      `)
      setUserVersion(connection, 19)
    }
    if (fromVersion < 20) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS encounter_launch_ops (
          launch_id TEXT PRIMARY KEY,
          encounter_id TEXT NOT NULL,
          request_sha256 TEXT NOT NULL,
          request_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          FOREIGN KEY (encounter_id) REFERENCES encounter_documents (encounter_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS encounter_launch_ops_encounter_idx
          ON encounter_launch_ops (encounter_id, created_at, launch_id);
      `)
      setUserVersion(connection, 20)
    }
    if (fromVersion < 21) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS encounter_ux_metric_aggregates (
          event TEXT NOT NULL,
          role_kind TEXT NOT NULL,
          viewport_class TEXT NOT NULL,
          input_kind TEXT NOT NULL,
          motion_preference TEXT NOT NULL,
          fixture_id TEXT NOT NULL,
          spatiality_level TEXT NOT NULL,
          terminal_status TEXT NOT NULL,
          sample_count INTEGER NOT NULL CHECK (sample_count > 0),
          value_sum REAL NOT NULL CHECK (value_sum >= 0),
          value_min REAL NOT NULL CHECK (value_min >= 0),
          value_max REAL NOT NULL CHECK (value_max >= value_min),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          PRIMARY KEY (
            event, role_kind, viewport_class, input_kind, motion_preference,
            fixture_id, spatiality_level, terminal_status
          )
        );
      `)
      setUserVersion(connection, 21)
    }
    if (fromVersion < 22) {
      connection.exec(`
    CREATE TABLE IF NOT EXISTS breeding_operations (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'preview-breeding', 'create-breeding-project', 'grant-breeding-consent',
        'revoke-breeding-consent', 'advance-breeding-project-time', 'resolve-breeding-check',
        'produce-egg', 'cancel-breeding-project', 'create-source-egg', 'transfer-egg',
        'advance-egg-incubation', 'set-egg-incubation-pause', 'mark-egg-ready', 'begin-hatch',
        'resolve-hatch-special', 'complete-hatch', 'cancel-egg', 'advance-campaign-clock',
        'record-inheritance-learning', 'recover-breeding-operation'
      )),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 32768),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      result_definition_sha256 TEXT CHECK (result_definition_sha256 IS NULL OR length(result_definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (status = 'pending' AND result_json IS NULL AND result_definition_sha256 IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (status IN ('accepted', 'rejected') AND result_json IS NOT NULL AND result_definition_sha256 IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS breeding_operations_status_created_idx
      ON breeding_operations (status, created_at_campaign_minute, operation_id);

    CREATE TABLE IF NOT EXISTS breeding_operation_scopes (
      operation_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK (scope_kind IN (
        'campaign-clock', 'breeding-project', 'pokemon-egg', 'parent-consent', 'trainer-sheet',
        'pokemon-sheet', 'pokemon-sheet-allocation', 'species-acquisition', 'breeding-operation'
      )),
      scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
      PRIMARY KEY (operation_id, scope_key),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS breeding_operation_scopes_conflict_idx
      ON breeding_operation_scopes (scope_kind, scope_key, operation_id);

    CREATE TABLE IF NOT EXISTS breeding_projects (
      project_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      status TEXT NOT NULL CHECK (status IN (
        'draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'check-ready',
        'additional-time-in-progress', 'ready-to-produce', 'egg-produced', 'check-failed',
        'cancelled', 'expired', 'abandoned', 'conflicted'
      )),
      owner_trainer_slug TEXT NOT NULL,
      breeder_trainer_slug TEXT NOT NULL,
      parent_a_slug TEXT NOT NULL,
      parent_b_slug TEXT NOT NULL CHECK (parent_b_slug <> parent_a_slug),
      produced_egg_id TEXT UNIQUE,
      last_operation_id TEXT NOT NULL,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      updated_at_campaign_minute INTEGER NOT NULL CHECK (updated_at_campaign_minute >= created_at_campaign_minute),
      FOREIGN KEY (last_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (produced_egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_projects_owner_status_idx
      ON breeding_projects (owner_trainer_slug, status, updated_at_campaign_minute DESC, project_id);
    CREATE INDEX IF NOT EXISTS breeding_projects_parent_a_status_idx
      ON breeding_projects (parent_a_slug, status, project_id);
    CREATE INDEX IF NOT EXISTS breeding_projects_parent_b_status_idx
      ON breeding_projects (parent_b_slug, status, project_id);

    CREATE TABLE IF NOT EXISTS pokemon_eggs (
      egg_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      status TEXT NOT NULL CHECK (status IN (
        'incubating', 'ready', 'awaiting-special-adjudication', 'hatching', 'hatched', 'cancelled', 'invalidated-by-gm'
      )),
      owner_trainer_slug TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('breeding', 'fossil', 'gm', 'feature-artificial')),
      source_project_id TEXT,
      child_sheet_slug TEXT UNIQUE,
      last_operation_id TEXT NOT NULL,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      updated_at_campaign_minute INTEGER NOT NULL CHECK (updated_at_campaign_minute >= created_at_campaign_minute),
      CHECK ((source_kind = 'breeding') = (source_project_id IS NOT NULL)),
      CHECK ((status = 'hatched') = (child_sheet_slug IS NOT NULL)),
      FOREIGN KEY (source_project_id) REFERENCES breeding_projects (project_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (last_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS pokemon_eggs_owner_status_idx
      ON pokemon_eggs (owner_trainer_slug, status, updated_at_campaign_minute DESC, egg_id);
    CREATE INDEX IF NOT EXISTS pokemon_eggs_source_project_idx
      ON pokemon_eggs (source_project_id, egg_id);

    CREATE TABLE IF NOT EXISTS breeding_consents (
      consent_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired', 'superseded')),
      project_id TEXT NOT NULL,
      parent_sheet_slug TEXT NOT NULL,
      parent_sheet_revision INTEGER NOT NULL CHECK (parent_sheet_revision >= 0),
      owner_trainer_slug TEXT NOT NULL,
      consenting_profile_id TEXT NOT NULL,
      expires_at_campaign_minute INTEGER CHECK (expires_at_campaign_minute IS NULL OR expires_at_campaign_minute >= 0),
      grant_operation_id TEXT NOT NULL,
      settlement_operation_id TEXT,
      granted_at_campaign_minute INTEGER NOT NULL CHECK (granted_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= granted_at_campaign_minute),
      CHECK (
        (revision = 0 AND status = 'active' AND settlement_operation_id IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (revision = 1 AND status <> 'active' AND settlement_operation_id IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      ),
      FOREIGN KEY (project_id) REFERENCES breeding_projects (project_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (grant_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE UNIQUE INDEX IF NOT EXISTS breeding_consents_active_parent_idx
      ON breeding_consents (project_id, parent_sheet_slug) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS breeding_consents_profile_status_expiry_idx
      ON breeding_consents (consenting_profile_id, status, expires_at_campaign_minute, consent_id);

    CREATE TABLE IF NOT EXISTS breeding_rolls (
      roll_record_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      operation_roll_ordinal INTEGER NOT NULL CHECK (operation_roll_ordinal BETWEEN 0 AND 31),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      purpose TEXT NOT NULL CHECK (purpose IN (
        'breeder-check-d20', 'offspring-family-d20', 'nature-ordered-2d6', 'ability-uniform-index',
        'gender-d100', 'hatch-duration-percentage', 'hatch-special-d100', 'provider-bounded'
      )),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      generated_at_campaign_minute INTEGER NOT NULL CHECK (generated_at_campaign_minute >= 0),
      UNIQUE (operation_id, operation_roll_ordinal),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_checks (
      check_record_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      operation_id TEXT NOT NULL,
      roll_record_id TEXT NOT NULL UNIQUE,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      resolved_at_campaign_minute INTEGER NOT NULL CHECK (resolved_at_campaign_minute >= 0),
      FOREIGN KEY (project_id) REFERENCES breeding_projects (project_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (roll_record_id) REFERENCES breeding_rolls (roll_record_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_option_offers (
      offer_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'revoked')),
      choice_kind TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('breeding-project', 'pokemon-egg', 'pokemon-sheet', 'trainer-sheet')),
      target_id TEXT NOT NULL,
      chooser_profile_id TEXT NOT NULL,
      issued_operation_id TEXT NOT NULL,
      settlement_operation_id TEXT,
      issued_at_campaign_minute INTEGER NOT NULL CHECK (issued_at_campaign_minute >= 0),
      expires_at_campaign_minute INTEGER CHECK (expires_at_campaign_minute IS NULL OR expires_at_campaign_minute > issued_at_campaign_minute),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= issued_at_campaign_minute),
      CHECK (
        (revision = 0 AND status = 'active' AND settlement_operation_id IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (revision = 1 AND status <> 'active' AND settlement_operation_id IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      ),
      FOREIGN KEY (issued_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_option_offers_chooser_status_idx
      ON breeding_option_offers (chooser_profile_id, status, expires_at_campaign_minute, offer_id);
    CREATE INDEX IF NOT EXISTS breeding_option_offers_target_idx
      ON breeding_option_offers (target_kind, target_id, status, offer_id);

    CREATE TABLE IF NOT EXISTS breeding_gm_adjudications (
      adjudication_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'cancelled')),
      adjudication_kind TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('breeding-project', 'pokemon-egg', 'pokemon-sheet', 'trainer-sheet')),
      target_id TEXT NOT NULL,
      offer_id TEXT,
      created_operation_id TEXT NOT NULL,
      settlement_operation_id TEXT,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (revision = 0 AND status = 'pending' AND settlement_operation_id IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (revision = 1 AND status <> 'pending' AND settlement_operation_id IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      ),
      FOREIGN KEY (offer_id) REFERENCES breeding_option_offers (offer_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (created_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_gm_adjudications_status_target_idx
      ON breeding_gm_adjudications (status, target_kind, target_id, adjudication_id);

    CREATE TABLE IF NOT EXISTS breeding_read_sets (
      read_set_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      captured_at_campaign_minute INTEGER NOT NULL CHECK (captured_at_campaign_minute >= 0),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_authorization_receipts (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      read_set_definition_sha256 TEXT NOT NULL CHECK (length(read_set_definition_sha256) = 64),
      authorized INTEGER NOT NULL CHECK (authorized IN (0, 1)),
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      evaluated_at_campaign_minute INTEGER NOT NULL CHECK (evaluated_at_campaign_minute >= 0),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_gm_overrides (
      override_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      override_kind TEXT NOT NULL,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_gm_overrides_operation_idx
      ON breeding_gm_overrides (operation_id, override_id);

    CREATE TABLE IF NOT EXISTS pokemon_breeding_origins (
      origin_id TEXT PRIMARY KEY,
      egg_id TEXT NOT NULL UNIQUE,
      child_sheet_slug TEXT NOT NULL UNIQUE,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      lineage_definition_sha256 TEXT NOT NULL CHECK (length(lineage_definition_sha256) = 64),
      hatch_operation_id TEXT NOT NULL,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (hatch_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_inheritance_learning_records (
      learning_record_id TEXT PRIMARY KEY,
      origin_id TEXT NOT NULL,
      egg_id TEXT NOT NULL,
      child_sheet_slug TEXT NOT NULL,
      checkpoint_level INTEGER NOT NULL CHECK (checkpoint_level IN (20, 30, 40, 50, 60, 70, 80, 90, 100)),
      operation_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      UNIQUE (origin_id, checkpoint_level),
      FOREIGN KEY (origin_id) REFERENCES pokemon_breeding_origins (origin_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_inheritance_learning_child_idx
      ON breeding_inheritance_learning_records (child_sheet_slug, checkpoint_level);

    CREATE TABLE IF NOT EXISTS trainer_species_acquisitions (
      trainer_sheet_slug TEXT NOT NULL,
      species_id TEXT NOT NULL,
      first_acquired_at_campaign_minute INTEGER NOT NULL CHECK (first_acquired_at_campaign_minute >= 0),
      source_egg_id TEXT,
      operation_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      PRIMARY KEY (trainer_sheet_slug, species_id),
      FOREIGN KEY (source_egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS trainer_species_acquisitions_species_idx
      ON trainer_species_acquisitions (species_id, first_acquired_at_campaign_minute, trainer_sheet_slug);

    CREATE TABLE IF NOT EXISTS campaign_clock (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      campaign_minute INTEGER NOT NULL CHECK (campaign_minute >= 0),
      last_operation_id TEXT,
      CHECK ((revision = 0) = (last_operation_id IS NULL)),
      FOREIGN KEY (last_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    INSERT OR IGNORE INTO campaign_clock (singleton, revision, campaign_minute, last_operation_id)
    VALUES (1, 0, 0, NULL);
  `)
      setUserVersion(connection, 22)
    }
    if (fromVersion < 23) {
      connection.exec(`
    CREATE TABLE IF NOT EXISTS breeding_archives (
      archive_id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL CHECK (purpose IN ('campaign-backup', 'gm-audit', 'owner-portable')),
      campaign_identity_sha256 TEXT NOT NULL CHECK (length(campaign_identity_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      archive_json TEXT NOT NULL CHECK (
        json_valid(archive_json)
        AND length(CAST(archive_json AS BLOB)) <= 67108864
      ),
      archive_definition_sha256 TEXT NOT NULL CHECK (length(archive_definition_sha256) = 64)
    );

    CREATE INDEX IF NOT EXISTS breeding_archives_campaign_created_idx
      ON breeding_archives (campaign_identity_sha256, created_at_campaign_minute DESC, archive_id);

    CREATE TABLE IF NOT EXISTS breeding_archive_import_requests (
      request_id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('replace-campaign', 'restore-new-campaign', 'validate-only')),
      target_campaign_identity_sha256 TEXT NOT NULL CHECK (length(target_campaign_identity_sha256) = 64),
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      requested_at_campaign_minute INTEGER NOT NULL CHECK (requested_at_campaign_minute >= 0),
      FOREIGN KEY (archive_id) REFERENCES breeding_archives (archive_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_archive_requests_target_time_idx
      ON breeding_archive_import_requests (
        target_campaign_identity_sha256, requested_at_campaign_minute, request_id
      );

    CREATE TABLE IF NOT EXISTS breeding_archive_restore_receipts (
      request_id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      reason_id TEXT NOT NULL CHECK (reason_id IN (
        'breeding.archive.accepted', 'breeding.archive.digest-mismatch',
        'breeding.archive.incompatible-reference', 'breeding.archive.invalid-record',
        'breeding.archive.not-restorable', 'breeding.archive.stale-target'
      )),
      receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      committed_at_campaign_minute INTEGER CHECK (
        committed_at_campaign_minute IS NULL OR committed_at_campaign_minute >= 0
      ),
      CHECK ((accepted = 1) = (committed_at_campaign_minute IS NOT NULL)),
      FOREIGN KEY (request_id) REFERENCES breeding_archive_import_requests (request_id),
      FOREIGN KEY (archive_id) REFERENCES breeding_archives (archive_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_archive_receipts_archive_idx
      ON breeding_archive_restore_receipts (archive_id, request_id);
  `)
      setUserVersion(connection, 23)
    }
    if (fromVersion < 24) {
      connection.exec(`
    CREATE TABLE IF NOT EXISTS breeding_incubation_segments (
      operation_id TEXT PRIMARY KEY,
      egg_id TEXT NOT NULL,
      egg_revision_before INTEGER NOT NULL CHECK (egg_revision_before >= 0),
      egg_revision_after INTEGER NOT NULL CHECK (egg_revision_after = egg_revision_before + 1),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'advance-egg-incubation', 'set-egg-incubation-pause'
      )),
      through_clock_revision INTEGER NOT NULL CHECK (through_clock_revision >= 0),
      through_campaign_minute INTEGER NOT NULL CHECK (through_campaign_minute >= 0),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      UNIQUE (egg_id, egg_revision_after),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id)
        DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_incubation_segments_egg_revision_idx
      ON breeding_incubation_segments (egg_id, egg_revision_after, operation_id);
  `)
      setUserVersion(connection, 24)
    }
    if (fromVersion < 25) {
      const row = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operations'
  `).get()
      const sql = row?.sql
      const before = "'advance-egg-incubation', 'set-egg-incubation-pause', 'mark-egg-ready'"
      if (typeof sql !== 'string' || !sql.includes(before) || sql.includes('apply-egg-warmer-capability')) {
        throw new Error('Storage migration v25 requires the exact row-preserving v24 breeding_operations definition')
      }
      const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
      if (foreignKeys !== 0) throw new Error('Storage migration v25 requires the migration runner to suspend foreign-key actions during the parent-table rebuild')
      connection.exec(`
    CREATE TABLE breeding_operations_v25 (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'preview-breeding', 'create-breeding-project', 'grant-breeding-consent',
        'revoke-breeding-consent', 'advance-breeding-project-time', 'resolve-breeding-check',
        'produce-egg', 'cancel-breeding-project', 'create-source-egg', 'transfer-egg',
        'advance-egg-incubation', 'set-egg-incubation-pause', 'apply-egg-warmer-capability',
        'mark-egg-ready', 'begin-hatch', 'resolve-hatch-special', 'complete-hatch', 'cancel-egg',
        'advance-campaign-clock', 'record-inheritance-learning', 'recover-breeding-operation'
      )),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 32768),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      result_definition_sha256 TEXT CHECK (result_definition_sha256 IS NULL OR length(result_definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (status = 'pending' AND result_json IS NULL AND result_definition_sha256 IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (status IN ('accepted', 'rejected') AND result_json IS NOT NULL AND result_definition_sha256 IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      )
    );
    INSERT INTO breeding_operations_v25 (
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) SELECT
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    FROM breeding_operations;
    DROP TABLE breeding_operations;
    ALTER TABLE breeding_operations_v25 RENAME TO breeding_operations;
    CREATE INDEX breeding_operations_status_created_idx
      ON breeding_operations (status, created_at_campaign_minute, operation_id);
  `)
      setUserVersion(connection, 25)
    }
    if (fromVersion < 26) {
      const scopeRow = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operation_scopes'
  `).get()
      const scopeSql = scopeRow?.sql
      if (typeof scopeSql !== 'string' || !scopeSql.includes("'species-acquisition', 'breeding-operation'")
        || scopeSql.includes('egg-transfer-consent')) {
        throw new Error('Storage migration v26 requires the exact row-preserving v25 breeding_operation_scopes definition')
      }
      const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
      if (foreignKeys !== 0) throw new Error('Storage migration v26 requires the migration runner to suspend foreign-key actions during the scope-table rebuild')
      connection.exec(`
    CREATE TABLE breeding_operation_scopes_v26 (
      operation_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK (scope_kind IN (
        'campaign-clock', 'breeding-project', 'pokemon-egg', 'parent-consent', 'trainer-sheet',
        'pokemon-sheet', 'pokemon-sheet-allocation', 'species-acquisition', 'breeding-operation',
        'egg-transfer-consent'
      )),
      scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
      PRIMARY KEY (operation_id, scope_key),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE
    );
    INSERT INTO breeding_operation_scopes_v26 (operation_id, scope_key, scope_kind, scope_json)
    SELECT operation_id, scope_key, scope_kind, scope_json FROM breeding_operation_scopes;
    DROP TABLE breeding_operation_scopes;
    ALTER TABLE breeding_operation_scopes_v26 RENAME TO breeding_operation_scopes;
    CREATE INDEX breeding_operation_scopes_conflict_idx
      ON breeding_operation_scopes (scope_kind, scope_key, operation_id);

    CREATE TABLE pokemon_egg_transfer_consents (
      consent_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
      role TEXT NOT NULL CHECK (role IN ('source-gift', 'recipient-acceptance')),
      egg_id TEXT NOT NULL,
      egg_revision INTEGER NOT NULL CHECK (egg_revision >= 0),
      source_trainer_slug TEXT NOT NULL,
      destination_trainer_slug TEXT NOT NULL CHECK (destination_trainer_slug <> source_trainer_slug),
      consenting_profile_id TEXT NOT NULL,
      expires_at_campaign_minute INTEGER NOT NULL CHECK (expires_at_campaign_minute >= 0),
      settlement_operation_id TEXT,
      CHECK (
        (revision = 0 AND status = 'active' AND settlement_operation_id IS NULL)
        OR
        (revision = 1 AND status <> 'active' AND settlement_operation_id IS NOT NULL)
      ),
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE UNIQUE INDEX pokemon_egg_transfer_consents_active_role_idx
      ON pokemon_egg_transfer_consents (egg_id, egg_revision, role) WHERE status = 'active';
    CREATE INDEX pokemon_egg_transfer_consents_participants_idx
      ON pokemon_egg_transfer_consents (
        status, source_trainer_slug, destination_trainer_slug, expires_at_campaign_minute, consent_id
      );
  `)
      setUserVersion(connection, 26)
    }
    if (fromVersion < 27) {
      const acquisitionRow = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'trainer_species_acquisitions'
  `).get()
      const acquisitionSql = acquisitionRow?.sql
      if (typeof acquisitionSql !== 'string' || !acquisitionSql.includes('REFERENCES breeding_operations (operation_id)')) {
        throw new Error('Storage migration v27 requires the exact row-preserving v26 Species acquisition definition')
      }
      const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
      if (foreignKeys !== 0) throw new Error('Storage migration v27 requires the migration runner to suspend foreign-key actions during the acquisition-table rebuild')
      connection.exec(`
    CREATE TABLE trainer_species_acquisitions_v27 (
      trainer_sheet_slug TEXT NOT NULL,
      species_id TEXT NOT NULL,
      first_acquired_at_campaign_minute INTEGER NOT NULL CHECK (first_acquired_at_campaign_minute >= 0),
      source_egg_id TEXT,
      operation_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      PRIMARY KEY (trainer_sheet_slug, species_id),
      FOREIGN KEY (source_egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED
    );
    INSERT INTO trainer_species_acquisitions_v27 (
      trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
      operation_id, record_json, definition_sha256
    ) SELECT
      trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
      operation_id, record_json, definition_sha256
    FROM trainer_species_acquisitions;
    DROP TABLE trainer_species_acquisitions;
    ALTER TABLE trainer_species_acquisitions_v27 RENAME TO trainer_species_acquisitions;
    CREATE INDEX trainer_species_acquisitions_species_idx
      ON trainer_species_acquisitions (species_id, first_acquired_at_campaign_minute, trainer_sheet_slug);

    CREATE TABLE trainer_species_acquisition_source_operations (
      operation_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('capture', 'evolution', 'trade', 'migration', 'gm-reviewed')),
      source_event_id TEXT NOT NULL,
      trainer_sheet_slug TEXT NOT NULL,
      species_id TEXT NOT NULL,
      settled_at_campaign_minute INTEGER NOT NULL CHECK (settled_at_campaign_minute >= 0),
      outcome TEXT NOT NULL CHECK (outcome IN ('first-acquisition-rewarded', 'already-acquired')),
      applied_reward_amount INTEGER NOT NULL CHECK (applied_reward_amount IN (0, 1)),
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(CAST(record_json AS BLOB)) <= 32768),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      UNIQUE (source_kind, source_event_id),
      CHECK ((outcome = 'first-acquisition-rewarded') = (applied_reward_amount = 1)),
      FOREIGN KEY (trainer_sheet_slug, species_id)
        REFERENCES trainer_species_acquisitions (trainer_sheet_slug, species_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX trainer_species_acquisition_source_operations_trainer_idx
      ON trainer_species_acquisition_source_operations (
        trainer_sheet_slug, settled_at_campaign_minute, operation_id
      );
  `)
      setUserVersion(connection, 27)
    }
    if (fromVersion < 28) {
      const operationRow = connection.prepare(`
        SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operations'
      `).get()
      const operationSql = operationRow?.sql
      if (typeof operationSql !== 'string') {
        throw new Error('Storage migration v28 requires the authoritative breeding_operations table')
      }
      if (!operationSql.includes('settle-egg-transfer-consent')) {
        const before = "'create-source-egg', 'transfer-egg',\n        'advance-egg-incubation'"
        if (!operationSql.includes(before) || !operationSql.includes('apply-egg-warmer-capability')) {
          throw new Error('Storage migration v28 requires the exact row-preserving v27 breeding_operations definition')
        }
        const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
        if (foreignKeys !== 0) throw new Error('Storage migration v28 requires the migration runner to suspend foreign-key actions during the operation-table rebuild')
        connection.exec(`
    CREATE TABLE breeding_operations_v28 (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'preview-breeding', 'create-breeding-project', 'grant-breeding-consent',
        'revoke-breeding-consent', 'advance-breeding-project-time', 'resolve-breeding-check',
        'produce-egg', 'cancel-breeding-project', 'create-source-egg', 'transfer-egg',
        'settle-egg-transfer-consent', 'advance-egg-incubation', 'set-egg-incubation-pause',
        'apply-egg-warmer-capability', 'mark-egg-ready', 'begin-hatch', 'resolve-hatch-special',
        'complete-hatch', 'cancel-egg', 'advance-campaign-clock', 'record-inheritance-learning',
        'recover-breeding-operation'
      )),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 32768),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      result_definition_sha256 TEXT CHECK (result_definition_sha256 IS NULL OR length(result_definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (status = 'pending' AND result_json IS NULL AND result_definition_sha256 IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (status IN ('accepted', 'rejected') AND result_json IS NOT NULL AND result_definition_sha256 IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      )
    );
    INSERT INTO breeding_operations_v28 (
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) SELECT
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    FROM breeding_operations;
    DROP TABLE breeding_operations;
    ALTER TABLE breeding_operations_v28 RENAME TO breeding_operations;
    CREATE INDEX breeding_operations_status_created_idx
      ON breeding_operations (status, created_at_campaign_minute, operation_id);
  `)
      }
      setUserVersion(connection, 28)
    }
    connection.exec('COMMIT')
    if (suspendForeignKeyActions) {
      connection.exec('PRAGMA foreign_keys = ON')
      if (connection.prepare('PRAGMA foreign_key_check').all().length !== 0) {
        throw new Error('Storage migration v25/v26/v27/v28 produced foreign-key violations')
      }
    }
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK')
    if (suspendForeignKeyActions) connection.exec('PRAGMA foreign_keys = ON')
    throw error
  }
}

const openMigrationDatabase = (databasePath) => {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o750 })
  const connection = new DatabaseSync(databasePath)
  try {
    connection.exec('PRAGMA foreign_keys = ON')
    connection.exec('PRAGMA busy_timeout = 5000')
    connection.exec('PRAGMA journal_mode = WAL')
    const existingVersion = readUserVersion(connection)
    // This standalone JSON importer intentionally owns only schema 28. A
    // production runtime may have advanced the same database afterward; its
    // common maps/sheets/inventory tables remain import-compatible, but the
    // importer must neither downgrade nor reinterpret newer schema objects.
    if (existingVersion <= STORAGE_SCHEMA_VERSION) applyStorageMigrations(connection)
    return connection
  }
  catch (error) {
    connection.close()
    throw error
  }
}

const stringifyDocument = (document) => {
  const json = JSON.stringify(document)
  if (json === undefined) throw new Error('document must be JSON-serializable')
  return json
}

const storedDocumentUnchanged = (row, documentJson, revision, updatedAt) => (
  row
  && row.document_json === documentJson
  && Number(row.revision) === revision
  && Number(row.updated_at) === updatedAt
)

const upsertMapRecord = (connection, record) => {
  const documentJson = stringifyDocument(record.document)
  const existing = connection.prepare(`
    SELECT document_json, revision, updated_at
    FROM maps
    WHERE slug = ?
  `).get(record.slug)
  if (storedDocumentUnchanged(existing, documentJson, record.revision, record.updatedAt)) return false

  connection.prepare(`
    INSERT INTO maps (slug, document_json, revision, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      document_json = excluded.document_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `).run(record.slug, documentJson, record.revision, record.updatedAt)
  return true
}

const runtimeEquipmentDocumentSupersedesLegacySource = (existing, record) => {
  if (!existing || Object.hasOwn(record.document, 'equipmentState')) return false
  if (Number(existing.revision) <= record.revision || Number(existing.updated_at) <= record.updatedAt) return false
  let document
  try { document = JSON.parse(existing.document_json) }
  catch { return false }
  return isRecord(document)
    && isRecord(document.equipmentState)
    && document.equipmentState.schemaVersion === 1
    && isRecord(document.equipmentState.owner)
    && document.equipmentState.owner.kind === record.kind
    && document.equipmentState.owner.slug === record.slug
    && document.revision === Number(existing.revision)
    && document.updatedAt === Number(existing.updated_at)
}

const upsertSheetRecord = (connection, record) => {
  const documentJson = stringifyDocument(record.document)
  const existing = connection.prepare(`
    SELECT document_json, revision, updated_at
    FROM sheets
    WHERE kind = ? AND slug = ?
  `).get(record.kind, record.slug)
  if (storedDocumentUnchanged(existing, documentJson, record.revision, record.updatedAt)
    || runtimeEquipmentDocumentSupersedesLegacySource(existing, record)) return false

  connection.prepare(`
    INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, slug) DO UPDATE SET
      document_json = excluded.document_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `).run(record.kind, record.slug, documentJson, record.revision, record.updatedAt)
  return true
}

const upsertGroupInventoryRecord = (connection, record) => {
  const documentJson = stringifyDocument(record.document)
  const existing = connection.prepare(`
    SELECT document_json, revision, updated_at
    FROM group_inventories
    WHERE slug = ?
  `).get(record.slug)
  if (storedDocumentUnchanged(existing, documentJson, record.revision, record.updatedAt)) return false

  connection.prepare(`
    INSERT INTO group_inventories (slug, document_json, revision, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      document_json = excluded.document_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `).run(record.slug, documentJson, record.revision, record.updatedAt)
  return true
}

const upsertMapFolder = (connection, path, updatedAt) => {
  connection.prepare(`
    INSERT INTO map_folders (path, updated_at)
    VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at
  `).run(path, updatedAt)
}

const upsertSheetFolder = (connection, kind, path, updatedAt) => {
  connection.prepare(`
    INSERT INTO sheet_folders (kind, path, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(kind, path) DO UPDATE SET updated_at = excluded.updated_at
  `).run(kind, path, updatedAt)
}

const applyImportPlan = (connection, plan) => {
  const counts = {
    mapsImported: 0,
    sheetsImported: 0,
    groupInventoriesImported: 0,
    foldersImported: 0,
    skippedUnchanged: 0,
  }

  connection.exec('BEGIN IMMEDIATE')
  try {
    const folderTimestamp = Date.now()
    for (const folder of plan.mapFolders) {
      upsertMapFolder(connection, folder, folderTimestamp)
      counts.foldersImported += 1
    }
    for (const folder of plan.sheetFolders) {
      upsertSheetFolder(connection, folder.kind, folder.path, folderTimestamp)
      counts.foldersImported += 1
    }
    for (const map of plan.maps) {
      if (map.folder) upsertMapFolder(connection, map.folder, map.updatedAt)
      if (upsertMapRecord(connection, map)) counts.mapsImported += 1
      else counts.skippedUnchanged += 1
    }
    for (const sheet of plan.sheets) {
      if (sheet.folder) upsertSheetFolder(connection, sheet.kind, sheet.folder, sheet.updatedAt)
      if (upsertSheetRecord(connection, sheet)) counts.sheetsImported += 1
      else counts.skippedUnchanged += 1
    }
    for (const groupInventory of plan.groupInventories) {
      if (upsertGroupInventoryRecord(connection, groupInventory)) counts.groupInventoriesImported += 1
      else counts.skippedUnchanged += 1
    }
    connection.exec('COMMIT')
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }

  return counts
}

const parseStoredJson = (json, label) => {
  try {
    return JSON.parse(json)
  } catch (error) {
    throw new Error(`${label} document_json could not be parsed: ${messageFromError(error)}`)
  }
}

const validateMapRow = (row, record) => {
  if (!row) throw new Error(`Imported map ${record.slug} is missing from SQLite`)
  if (Number(row.revision) !== record.revision) throw new Error(`Imported map ${record.slug} revision mismatch`)
  const document = parseStoredJson(row.document_json, `map ${record.slug}`)
  assertLoadableMapDocument(document, `Imported map ${record.slug}`)
  if (document.slug !== record.slug) throw new Error(`Imported map ${record.slug} document slug mismatch`)
}

const validateSheetRow = (row, record) => {
  if (!row) throw new Error(`Imported ${record.kind} sheet ${record.slug} is missing from SQLite`)
  if (Number(row.revision) !== record.revision && !runtimeEquipmentDocumentSupersedesLegacySource(row, record)) {
    throw new Error(`Imported ${record.kind} sheet ${record.slug} revision mismatch`)
  }
  const document = parseStoredJson(row.document_json, `${record.kind} sheet ${record.slug}`)
  if (!isRecord(document)) throw new Error(`Imported ${record.kind} sheet ${record.slug} document must be an object`)
  if (document.slug !== record.slug) throw new Error(`Imported ${record.kind} sheet ${record.slug} document slug mismatch`)
}

const validateGroupInventoryRow = (row, record) => {
  if (!row) throw new Error(`Imported group inventory ${record.slug} is missing from SQLite`)
  if (Number(row.revision) !== record.revision) throw new Error(`Imported group inventory ${record.slug} revision mismatch`)
  if (Number(row.updated_at) !== record.updatedAt) throw new Error(`Imported group inventory ${record.slug} updatedAt mismatch`)
  const document = parseStoredJson(row.document_json, `group inventory ${record.slug}`)
  if (!isRecord(document)) throw new Error(`Imported group inventory ${record.slug} document must be an object`)
  if (document.slug !== record.slug) throw new Error(`Imported group inventory ${record.slug} document slug mismatch`)
  if (document.revision !== record.revision) throw new Error(`Imported group inventory ${record.slug} document revision mismatch`)
  if (document.updatedAt !== record.updatedAt) throw new Error(`Imported group inventory ${record.slug} document updatedAt mismatch`)
}

const validateMigratedDatabase = (connection, plan) => {
  let mapsLoaded = 0
  let sheetsLoaded = 0
  let groupInventoriesLoaded = 0

  for (const map of plan.maps) {
    const row = connection.prepare(`
      SELECT document_json, revision, updated_at
      FROM maps
      WHERE slug = ?
    `).get(map.slug)
    validateMapRow(row, map)
    mapsLoaded += 1
  }

  for (const sheet of plan.sheets) {
    const row = connection.prepare(`
      SELECT document_json, revision, updated_at
      FROM sheets
      WHERE kind = ? AND slug = ?
    `).get(sheet.kind, sheet.slug)
    validateSheetRow(row, sheet)
    sheetsLoaded += 1
  }

  for (const groupInventory of plan.groupInventories) {
    const row = connection.prepare(`
      SELECT document_json, revision, updated_at
      FROM group_inventories
      WHERE slug = ?
    `).get(groupInventory.slug)
    validateGroupInventoryRow(row, groupInventory)
    groupInventoriesLoaded += 1
  }

  return {
    mapsLoaded,
    sheetsLoaded,
    groupInventoriesLoaded,
  }
}

export const runCampaignSqliteMigration = ({ argv = [], env = process.env, now = new Date() } = {}) => {
  const options = parseMigrationCliArgs(argv)
  if (options.help) {
    return {
      help: true,
      text: HELP_TEXT,
      exitCode: 0,
    }
  }

  const campaignRoot = resolveCampaignRoot(env)
  const databasePath = resolveDatabasePath(env, campaignRoot)
  const backupRoot = resolveBackupRoot(options.backupRoot, campaignRoot)
  const backup = createMigrationBackup({ campaignRoot, backupRoot, databasePath, now })
  const plan = createMigrationPlan(campaignRoot)
  const errors = [...plan.errors]
  let counts = {
    mapsImported: 0,
    sheetsImported: 0,
    groupInventoriesImported: 0,
    foldersImported: 0,
    skippedUnchanged: 0,
  }
  let validation = {
    mapsLoaded: 0,
    sheetsLoaded: 0,
    groupInventoriesLoaded: 0,
  }

  if (errors.length === 0) {
    let connection
    try {
      connection = openMigrationDatabase(databasePath)
      counts = applyImportPlan(connection, plan)
      validation = validateMigratedDatabase(connection, plan)
    } catch (error) {
      errors.push(messageFromError(error))
    } finally {
      connection?.close()
    }
  }

  return {
    help: false,
    exitCode: errors.length === 0 ? 0 : 1,
    campaignRoot,
    databasePath,
    backup,
    plan,
    counts,
    validation,
    errors,
  }
}

export const formatMigrationResult = (result) => {
  if (result.help) return result.text

  const lines = [
    'Rotom Table SQLite campaign migration',
    `Campaign root: ${result.campaignRoot}`,
    `Database path: ${result.databasePath}`,
    `Backup created: ${result.backup.path}`,
    `Backup entries copied: ${result.backup.copiedCount}`,
    `Maps imported: ${result.counts.mapsImported}`,
    `Sheets imported: ${result.counts.sheetsImported}`,
    `Group inventories imported: ${result.counts.groupInventoriesImported}`,
    `Folders imported: ${result.counts.foldersImported ?? 0}`,
    `Skipped unchanged: ${result.counts.skippedUnchanged}`,
    `Player profiles validated: ${result.plan.playerProfiles.length} (current profile storage remains JSON-backed)`,
    `Validation: loaded ${result.validation.mapsLoaded} maps, ${result.validation.sheetsLoaded} sheets, and ${result.validation.groupInventoriesLoaded} group inventories from SQLite`,
    `Errors: ${result.errors.length}`,
  ]

  for (const error of result.errors) lines.push(`- ${error}`)
  return `${lines.join('\n')}\n`
}

export const runMigrationCli = (argv = process.argv.slice(2), env = process.env) => {
  let result
  try {
    result = runCampaignSqliteMigration({ argv, env })
  } catch (error) {
    process.stderr.write(`${messageFromError(error)}\n\n${HELP_TEXT}`)
    return error instanceof CampaignSqliteMigrationError ? 2 : 1
  }

  const output = formatMigrationResult(result)
  if (result.exitCode === 0 || result.help) process.stdout.write(output)
  else process.stderr.write(output)
  return result.exitCode
}

if (scriptPath === resolve(process.argv[1] ?? '')) {
  process.exitCode = runMigrationCli()
}
