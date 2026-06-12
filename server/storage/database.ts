import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CAMPAIGN_ROOT } from '../utils/campaignPaths'
import { applyStorageMigrations } from './migrations'

export const ROTOM_DB_PATH_ENV = 'ROTOM_DB_PATH'
export const DEFAULT_ROTOM_DB_FILENAME = 'rotom-table.sqlite'

export interface ResolveRotomDatabasePathOptions {
  readonly rawPath?: string
  readonly campaignRoot?: string
}

export interface OpenRotomDatabaseOptions extends ResolveRotomDatabasePathOptions {
  readonly path?: string
  readonly enableWal?: boolean
}

export interface RotomDatabase {
  readonly path: string
  readonly connection: DatabaseSync
  readonly journalMode: string | null
  withTransaction<T>(work: () => T): T
  close(): void
}

const IN_MEMORY_SQLITE_PATH = ':memory:'

export const resolveConfiguredDatabasePath = (
  options: ResolveRotomDatabasePathOptions = {},
): string => {
  const campaignRoot = options.campaignRoot ?? CAMPAIGN_ROOT
  const rawPath = options.rawPath ?? process.env[ROTOM_DB_PATH_ENV]
  const trimmed = rawPath?.trim()

  if (!trimmed) return resolve(campaignRoot, DEFAULT_ROTOM_DB_FILENAME)
  if (trimmed === IN_MEMORY_SQLITE_PATH) return IN_MEMORY_SQLITE_PATH

  const expanded = trimmed === '~' || trimmed.startsWith('~/')
    ? `${homedir()}${trimmed.slice(1)}`
    : trimmed

  return isAbsolute(expanded) ? resolve(expanded) : resolve(campaignRoot, expanded)
}

const shouldCreateParentDirectory = (path: string): boolean => path !== IN_MEMORY_SQLITE_PATH

const createParentDirectory = (path: string): void => {
  if (shouldCreateParentDirectory(path)) mkdirSync(dirname(path), { recursive: true })
}

const configureConnection = (
  connection: DatabaseSync,
  path: string,
  enableWal: boolean,
): string | null => {
  connection.exec('PRAGMA foreign_keys = ON')
  connection.exec('PRAGMA busy_timeout = 5000')

  if (!enableWal || path === IN_MEMORY_SQLITE_PATH) return null

  const row = connection.prepare('PRAGMA journal_mode = WAL').get()
  const journalMode = row?.journal_mode
  return typeof journalMode === 'string' ? journalMode : null
}

export const openRotomDatabase = (options: OpenRotomDatabaseOptions = {}): RotomDatabase => {
  const path = options.path ?? resolveConfiguredDatabasePath(options)
  createParentDirectory(path)

  const connection = new DatabaseSync(path)
  const journalMode = configureConnection(connection, path, options.enableWal ?? true)
  applyStorageMigrations(connection)

  let transactionDepth = 0
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new Error('Rotom database connection is closed')
  }

  return {
    path,
    connection,
    journalMode,
    withTransaction: <T>(work: () => T): T => {
      assertOpen()
      if (transactionDepth > 0) return work()

      transactionDepth += 1
      connection.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        connection.exec('COMMIT')
        return result
      } catch (error) {
        connection.exec('ROLLBACK')
        throw error
      } finally {
        transactionDepth -= 1
      }
    },
    close: () => {
      if (closed) return
      connection.close()
      closed = true
    },
  }
}

let defaultDatabase: RotomDatabase | null = null

export const getRotomDatabase = (): RotomDatabase => {
  if (!defaultDatabase) defaultDatabase = openRotomDatabase()
  return defaultDatabase
}

export const closeRotomDatabase = (): void => {
  defaultDatabase?.close()
  defaultDatabase = null
}
