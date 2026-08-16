import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CAMPAIGN_ROOT } from '../utils/campaignPaths'
import { applyStorageMigrations } from './migrations'
import { migrateLegacyEquipmentDocuments } from '../domain/itemAutomation/equipmentMigration'

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

type PromiseLikeValue = PromiseLike<unknown>
export type SynchronousTransactionResult<T> = T extends PromiseLikeValue ? never : T
export type SynchronousTransactionWork<T> = () => SynchronousTransactionResult<T>

export interface RotomDatabase {
  readonly path: string
  readonly connection: DatabaseSync
  readonly journalMode: string | null
  withTransaction<T>(work: SynchronousTransactionWork<T>): SynchronousTransactionResult<T>
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
  try {
    applyStorageMigrations(connection)
    migrateLegacyEquipmentDocuments(connection)
  }
  catch (error) {
    connection.close()
    throw error
  }

  let transactionDepth = 0
  let transactionRollbackOnlyError: Error | null = null
  let closed = false

  const assertOpen = (): void => {
    if (closed) throw new Error('Rotom database connection is closed')
  }

  const beginTransaction = (): boolean => {
    assertOpen()
    if (transactionDepth > 0) return false

    connection.exec('BEGIN IMMEDIATE')
    transactionDepth = 1
    transactionRollbackOnlyError = null
    return true
  }

  const finishTransaction = (started: boolean): void => {
    if (!started) return
    transactionDepth = 0
    transactionRollbackOnlyError = null
  }

  const isPromiseLike = (value: unknown): value is PromiseLikeValue => (
    (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && typeof (value as { readonly then?: unknown }).then === 'function'
  )

  const transactionCallbackReturnedPromiseError = (): Error => new Error(
    'Rotom database withTransaction callbacks must be synchronous; move asynchronous work before or after the transaction',
  )

  return {
    path,
    connection,
    journalMode,
    withTransaction: <T>(work: SynchronousTransactionWork<T>): SynchronousTransactionResult<T> => {
      const started = beginTransaction()
      let transactionClosed = false
      try {
        const result = work()
        if (isPromiseLike(result)) {
          const error = transactionCallbackReturnedPromiseError()
          if (started) {
            connection.exec('ROLLBACK')
            transactionClosed = true
          } else {
            transactionRollbackOnlyError ??= error
          }
          throw error
        }
        if (started) {
          if (transactionRollbackOnlyError) {
            const error = transactionRollbackOnlyError
            connection.exec('ROLLBACK')
            transactionClosed = true
            throw error
          }
          connection.exec('COMMIT')
          transactionClosed = true
        }
        return result
      } catch (error) {
        if (started && !transactionClosed) connection.exec('ROLLBACK')
        throw error
      } finally {
        finishTransaction(started)
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
