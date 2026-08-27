#!/usr/bin/env -S npx vite-node
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import process from 'node:process'
import { runCampaignSqliteMigration } from '../migrate-campaign-to-sqlite.mjs'
import { migrateLegacyEquipmentDocuments } from '../../server/domain/itemAutomation/equipmentMigration'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  applyStorageMigrations,
  getStorageSchemaVersion,
  type StorageMigrationHooks,
} from '../../server/storage/migrations'

interface AtomicJsonMigrationOptions {
  readonly argv?: string[]
  readonly env?: NodeJS.ProcessEnv
  readonly now?: Date
  readonly hooks?: StorageMigrationHooks
}

const expanded = (value: string): string => value === '~' || value.startsWith('~/')
  ? `${homedir()}${value.slice(1)}`
  : value

const configuredPaths = (env: NodeJS.ProcessEnv): { campaignRoot: string; databasePath: string } => {
  const rawRoot = env.ROTOM_CAMPAIGN_ROOT?.trim()
  if (!rawRoot) throw new Error('ROTOM_CAMPAIGN_ROOT is required for the documented JSON-era import')
  const campaignRoot = resolve(expanded(rawRoot))
  const rawDatabase = env.ROTOM_DB_PATH?.trim()
  const databasePath = rawDatabase
    ? isAbsolute(expanded(rawDatabase)) ? resolve(expanded(rawDatabase)) : resolve(campaignRoot, expanded(rawDatabase))
    : resolve(campaignRoot, 'rotom-table.sqlite')
  return { campaignRoot, databasePath }
}

const removeStaging = (path: string): void => {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

export const runAtomicJsonCampaignMigration = (
  options: AtomicJsonMigrationOptions = {},
): ReturnType<typeof runCampaignSqliteMigration> & { finalSchemaVersion?: number; finalDatabasePath?: string } => {
  const argv = options.argv ?? []
  const env = options.env ?? process.env
  if (argv.includes('--help') || argv.includes('-h')) return runCampaignSqliteMigration({ argv, env, now: options.now })
  const { databasePath } = configuredPaths(env)
  const targetExists = existsSync(databasePath)
  if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`)) {
    throw new Error(`JSON-era import refuses SQLite WAL/SHM sidecars at ${databasePath}; stop the service and checkpoint/close the database before retrying.`)
  }
  if (targetExists) {
    const current = new DatabaseSync(databasePath, { readOnly: true, timeout: 0 })
    try {
      const version = Number(current.prepare('PRAGMA user_version').get()?.user_version)
      if (!Number.isSafeInteger(version) || version < 1 || version > LATEST_STORAGE_SCHEMA_VERSION) {
        throw new Error(`Existing SQLite authority has unsupported schema v${version}; use the operator upgrade/recovery guide.`)
      }
      if (current.prepare('PRAGMA integrity_check').all()[0]?.integrity_check !== 'ok') {
        throw new Error('Existing SQLite authority failed integrity_check before JSON import')
      }
    } finally {
      current.close()
    }
  }
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o750 })
  const stagingPath = resolve(dirname(databasePath), `.${basename(databasePath)}.json-import-${process.pid}-${options.now?.getTime() ?? Date.now()}.tmp`)
  removeStaging(stagingPath)
  if (targetExists) copyFileSync(databasePath, stagingPath)
  const stagedEnv = { ...env, ROTOM_DB_PATH: stagingPath }
  let result
  try {
    result = runCampaignSqliteMigration({ argv, env: stagedEnv, now: options.now })
    if (targetExists && result.backup?.path) {
      const backedUpDatabase = resolve(result.backup.path, 'campaign', basename(databasePath))
      mkdirSync(dirname(backedUpDatabase), { recursive: true, mode: 0o750 })
      copyFileSync(databasePath, backedUpDatabase)
      chmodSync(backedUpDatabase, 0o600)
    }
    if (result.exitCode !== 0 || result.help) {
      removeStaging(stagingPath)
      return result
    }
    const connection = new DatabaseSync(stagingPath, { timeout: 0 })
    try {
      connection.exec('PRAGMA foreign_keys = ON')
      applyStorageMigrations(connection, options.hooks)
      migrateLegacyEquipmentDocuments(connection)
      const version = getStorageSchemaVersion(connection)
      if (version !== LATEST_STORAGE_SCHEMA_VERSION) throw new Error(`JSON-era import stopped at unexpected schema v${version}`)
      const integrity = connection.prepare('PRAGMA integrity_check').all()
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error(`Imported database integrity failure: ${JSON.stringify(integrity)}`)
      const foreignKeys = connection.prepare('PRAGMA foreign_key_check').all()
      if (foreignKeys.length !== 0) throw new Error(`Imported database has ${foreignKeys.length} foreign-key violation(s)`)
      connection.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all()
    } finally {
      connection.close()
    }
    chmodSync(stagingPath, 0o600)
    const descriptor = openSync(stagingPath, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
    renameSync(stagingPath, databasePath)
    return { ...result, databasePath, finalDatabasePath: databasePath, finalSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION }
  } catch (error) {
    removeStaging(stagingPath)
    throw error
  }
}

