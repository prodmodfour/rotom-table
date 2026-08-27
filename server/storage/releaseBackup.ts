import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { LATEST_STORAGE_SCHEMA_VERSION } from './migrations'

export type ReleaseBackupMethod = 'online-sqlite-backup-api' | 'stopped-service-copy'

export interface ReleaseBackupSetting {
  readonly label: string
  readonly path: string
}

export interface CreateReleaseBackupOptions {
  readonly campaignRoot: string
  readonly databasePath: string
  readonly archivePath: string
  readonly method: ReleaseBackupMethod
  readonly settings?: readonly ReleaseBackupSetting[]
  readonly createdAt?: string
}

export interface ReleaseBackupEntry {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly mode: number
  readonly classification: 'sqlite-authority' | 'residual-campaign' | 'private-setting'
}

export interface ReleaseBackupManifest {
  readonly artifact: 'rotom-table-release-backup'
  readonly schemaVersion: 1
  readonly storageSchemaVersion: number
  readonly method: ReleaseBackupMethod
  readonly createdAt: string
  readonly databaseArchivePath: string
  readonly settingsInventory: readonly string[]
  readonly entries: readonly ReleaseBackupEntry[]
}

export interface ReleaseBackupResult {
  readonly archivePath: string
  readonly archiveSha256: string
  readonly manifest: ReleaseBackupManifest
}

export interface RestoreReleaseBackupOptions {
  readonly archivePath: string
  readonly targetRoot: string
  readonly expectedArchiveSha256?: string
}

export interface RestoreReleaseBackupResult {
  readonly targetRoot: string
  readonly databasePath: string
  readonly manifest: ReleaseBackupManifest
  readonly archiveSha256: string
}

const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const sha256File = (path: string): string => sha256Bytes(readFileSync(path))
const isWithin = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
const portable = (path: string): string => path.split(sep).join('/')
const assertPrivateOutput = (campaignRoot: string, archivePath: string): void => {
  if (isWithin(campaignRoot, archivePath)) throw new Error('Release backup archive must be outside ROTOM_CAMPAIGN_ROOT')
  if (existsSync(archivePath)) throw new Error(`Refusing to overwrite release backup archive: ${archivePath}`)
}
const assertRegularFile = (path: string, label: string): void => {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${path}`)
}

const copyCampaignTree = (
  sourceRoot: string,
  destinationRoot: string,
  databasePath: string,
): void => {
  const excluded = new Set([resolve(databasePath), resolve(`${databasePath}-wal`), resolve(`${databasePath}-shm`)])
  const visit = (source: string, rel: string): void => {
    if (excluded.has(resolve(source))) return
    const stat = lstatSync(source)
    if (stat.isSymbolicLink()) throw new Error(`Campaign backup refuses symlinks: ${source}`)
    const destination = join(destinationRoot, rel)
    if (stat.isDirectory()) {
      mkdirSync(destination, { recursive: true, mode: 0o750 })
      for (const name of readdirSync(source).sort()) visit(join(source, name), join(rel, name))
      return
    }
    if (!stat.isFile()) throw new Error(`Campaign backup refuses non-regular entry: ${source}`)
    mkdirSync(dirname(destination), { recursive: true, mode: 0o750 })
    copyFileSync(source, destination)
    chmodSync(destination, stat.mode & 0o777)
  }
  for (const name of readdirSync(sourceRoot).sort()) visit(join(sourceRoot, name), name)
}

const inspectReleaseDatabase = (path: string): number => {
  const connection = new DatabaseSync(path, { readOnly: true, timeout: 0 })
  try {
    const version = Number(connection.prepare('PRAGMA user_version').get()?.user_version)
    if (version < 1 || version > LATEST_STORAGE_SCHEMA_VERSION) throw new Error(`Unsupported backup storage schema v${version}`)
    const integrity = connection.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error(`Backup snapshot failed integrity_check: ${JSON.stringify(integrity)}`)
    const foreignKeys = connection.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeys.length !== 0) throw new Error(`Backup snapshot has ${foreignKeys.length} foreign-key violation(s)`)
    return version
  } finally {
    connection.close()
  }
}

const stoppedServiceCopy = (sourcePath: string, destinationPath: string): void => {
  const source = new DatabaseSync(sourcePath, { timeout: 0 })
  try {
    source.exec('BEGIN EXCLUSIVE')
    const integrity = source.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error('Source database failed integrity_check')
    copyFileSync(sourcePath, destinationPath)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${sourcePath}${suffix}`
      if (existsSync(sidecar)) copyFileSync(sidecar, `${destinationPath}${suffix}`)
    }
    source.exec('ROLLBACK')
  } catch (error) {
    if (source.isTransaction) source.exec('ROLLBACK')
    throw new Error('Stopped-service backup requires an unlocked database after the service is stopped', { cause: error })
  } finally {
    source.close()
  }
}

const collectEntries = (
  root: string,
  databaseArchivePath: string,
  settingPaths: ReadonlySet<string>,
): ReleaseBackupEntry[] => {
  const entries: ReleaseBackupEntry[] = []
  const visit = (path: string, rel: string): void => {
    const stat = lstatSync(path)
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name), rel ? join(rel, name) : name)
      return
    }
    assertRegularFile(path, 'Backup entry')
    const archivePath = portable(rel)
    const sqlite = archivePath === databaseArchivePath || archivePath === `${databaseArchivePath}-wal` || archivePath === `${databaseArchivePath}-shm`
    entries.push({
      path: archivePath,
      sha256: sha256File(path),
      bytes: stat.size,
      mode: stat.mode & 0o777,
      classification: sqlite ? 'sqlite-authority' : settingPaths.has(archivePath) ? 'private-setting' : 'residual-campaign',
    })
  }
  visit(root, '')
  return entries
}

const validateSettingLabel = (label: string): string => {
  const trimmed = label.trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(trimmed)) throw new Error(`Invalid settings inventory label: ${label}`)
  return trimmed
}

export const createReleaseBackup = async (options: CreateReleaseBackupOptions): Promise<ReleaseBackupResult> => {
  const campaignRoot = resolve(options.campaignRoot)
  const databasePath = resolve(options.databasePath)
  const archivePath = resolve(options.archivePath)
  if (!existsSync(campaignRoot) || !statSync(campaignRoot).isDirectory()) throw new Error(`Campaign root does not exist: ${campaignRoot}`)
  assertRegularFile(databasePath, 'Campaign database')
  assertPrivateOutput(campaignRoot, archivePath)
  mkdirSync(dirname(archivePath), { recursive: true, mode: 0o750 })
  const stagingRoot = mkdtempSync(join(dirname(archivePath), '.rotom-release-backup-'))
  const payloadRoot = join(stagingRoot, 'payload')
  const stagedArchive = join(stagingRoot, 'archive.tar.gz')
  mkdirSync(join(payloadRoot, 'campaign'), { recursive: true, mode: 0o750 })
  try {
    copyCampaignTree(campaignRoot, join(payloadRoot, 'campaign'), databasePath)
    const databaseRelative = isWithin(campaignRoot, databasePath)
      ? portable(relative(campaignRoot, databasePath))
      : basename(databasePath)
    const databaseArchivePath = isWithin(campaignRoot, databasePath)
      ? portable(join('campaign', databaseRelative))
      : portable(join('external-database', databaseRelative))
    const snapshotPath = join(payloadRoot, ...databaseArchivePath.split('/'))
    mkdirSync(dirname(snapshotPath), { recursive: true, mode: 0o750 })
    if (options.method === 'online-sqlite-backup-api') {
      const source = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 })
      try { await backup(source, snapshotPath) } finally { source.close() }
    } else if (options.method === 'stopped-service-copy') {
      stoppedServiceCopy(databasePath, snapshotPath)
    } else {
      throw new Error(`Unsupported release backup method: ${String(options.method)}`)
    }
    chmodSync(snapshotPath, 0o600)
    const storageSchemaVersion = inspectReleaseDatabase(snapshotPath)
    if (options.method === 'online-sqlite-backup-api') {
      // backup() produced a complete main database. Read-only inspection of a
      // WAL-mode snapshot may create empty local sidecars; they are not backup
      // authority and must not complicate a fresh-host restore.
      rmSync(`${snapshotPath}-wal`, { force: true })
      rmSync(`${snapshotPath}-shm`, { force: true })
    }

    const settingPaths = new Set<string>()
    const labels = new Set<string>()
    for (const setting of options.settings ?? []) {
      const label = validateSettingLabel(setting.label)
      if (labels.has(label)) throw new Error(`Duplicate settings inventory label: ${label}`)
      labels.add(label)
      const source = resolve(setting.path)
      assertRegularFile(source, `Private setting ${label}`)
      const archiveSettingPath = portable(join('settings', label))
      const destination = join(payloadRoot, 'settings', label)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o750 })
      copyFileSync(source, destination)
      chmodSync(destination, 0o600)
      settingPaths.add(archiveSettingPath)
    }

    const entries = collectEntries(payloadRoot, databaseArchivePath, settingPaths)
    const manifest: ReleaseBackupManifest = {
      artifact: 'rotom-table-release-backup',
      schemaVersion: 1,
      storageSchemaVersion,
      method: options.method,
      createdAt: options.createdAt ?? new Date().toISOString(),
      databaseArchivePath,
      settingsInventory: [...labels].sort(),
      entries,
    }
    writeFileSync(join(payloadRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    execFileSync('tar', [
      '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
      '-czf', stagedArchive, '-C', payloadRoot, '.',
    ])
    chmodSync(stagedArchive, 0o600)
    renameSync(stagedArchive, archivePath)
    const archiveSha256 = sha256File(archivePath)
    writeFileSync(`${archivePath}.sha256`, `${archiveSha256}  ${basename(archivePath)}\n`, { mode: 0o600 })
    return { archivePath, archiveSha256, manifest }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

const safeArchiveEntry = (entry: string): boolean => {
  const normalized = entry.replace(/^\.\//u, '')
  return normalized === '' || (!isAbsolute(normalized) && normalized.split('/').every(segment => segment !== '..'))
}

export const restoreReleaseBackup = (options: RestoreReleaseBackupOptions): RestoreReleaseBackupResult => {
  const archivePath = resolve(options.archivePath)
  const targetRoot = resolve(options.targetRoot)
  assertRegularFile(archivePath, 'Release backup archive')
  const archiveSha256 = sha256File(archivePath)
  if (options.expectedArchiveSha256 && archiveSha256 !== options.expectedArchiveSha256) throw new Error('Release backup archive SHA-256 mismatch')
  if (existsSync(targetRoot) && readdirSync(targetRoot).length > 0) throw new Error(`Restore target must be empty: ${targetRoot}`)
  mkdirSync(targetRoot, { recursive: true, mode: 0o750 })
  const listing = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).split('\n').filter(Boolean)
  if (!listing.every(safeArchiveEntry)) throw new Error('Release backup archive contains an unsafe path')
  const verboseListing = execFileSync('tar', ['-tvzf', archivePath], { encoding: 'utf8' }).split('\n').filter(Boolean)
  if (verboseListing.some(line => !['-', 'd'].includes(line[0] ?? ''))) throw new Error('Release backup archive contains a link or special file')
  execFileSync('tar', ['-xzf', archivePath, '-C', targetRoot, '--no-same-owner', '--no-same-permissions'])
  const manifestPath = join(targetRoot, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseBackupManifest
  if (manifest.artifact !== 'rotom-table-release-backup' || manifest.schemaVersion !== 1) throw new Error('Unsupported release backup manifest')
  const expected = new Map(manifest.entries.map(entry => [entry.path, entry]))
  const actual = collectEntries(targetRoot, manifest.databaseArchivePath, new Set(manifest.entries.filter(entry => entry.classification === 'private-setting').map(entry => entry.path)))
    .filter(entry => entry.path !== 'manifest.json')
  if (actual.length !== expected.size) throw new Error('Release backup archive content count disagrees with its manifest')
  for (const entry of actual) {
    const recorded = expected.get(entry.path)
    if (!recorded || recorded.sha256 !== entry.sha256 || recorded.bytes !== entry.bytes) throw new Error(`Release backup entry failed manifest verification: ${entry.path}`)
  }
  const databasePath = join(targetRoot, ...manifest.databaseArchivePath.split('/'))
  const version = inspectReleaseDatabase(databasePath)
  if (version !== manifest.storageSchemaVersion) throw new Error('Restored database schema disagrees with backup manifest')
  return { targetRoot, databasePath, manifest, archiveSha256 }
}
