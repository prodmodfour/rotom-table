#!/usr/bin/env node
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROTOM_CAMPAIGN_ROOT_ENV = 'ROTOM_CAMPAIGN_ROOT'
const ROTOM_DB_PATH_ENV = 'ROTOM_DB_PATH'
const DEFAULT_ROTOM_DB_FILENAME = 'rotom-table.sqlite'

const ROTOM_REALTIME_EVENT_RETENTION_DAYS_ENV = 'ROTOM_REALTIME_EVENT_RETENTION_DAYS'
const ROTOM_REALTIME_EVENT_MAX_ROWS_ENV = 'ROTOM_REALTIME_EVENT_MAX_ROWS'
const ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS_ENV = 'ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS'
const ROTOM_REALTIME_EVENT_RETENTION_ENABLED_ENV = 'ROTOM_REALTIME_EVENT_RETENTION_ENABLED'

const DEFAULT_REALTIME_EVENT_RETENTION_DAYS = 30
const DEFAULT_REALTIME_EVENT_MAX_ROWS = 250_000
const DEFAULT_REALTIME_EVENT_PRUNE_INTERVAL_MS = 15 * 60 * 1000
const DEFAULT_REALTIME_EVENT_RETENTION_ENABLED = true
const MIN_REALTIME_EVENT_RETENTION_DAYS = 1
const MAX_REALTIME_EVENT_RETENTION_DAYS = 3_650
const MIN_REALTIME_EVENT_MAX_ROWS = 1
const MAX_REALTIME_EVENT_MAX_ROWS = 10_000_000
const MIN_REALTIME_EVENT_PRUNE_INTERVAL_MS = 10_000
const MAX_REALTIME_EVENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
const REALTIME_EVENT_RETENTION_DAY_MS = 24 * 60 * 60 * 1000

const HELP_TEXT = `Rotom Table realtime retention operator CLI

Usage:
  npm run realtime:status
  npm run realtime:prune -- --dry-run
  npm run realtime:prune -- --apply

Options:
  --dry-run   Plan pruning without changing the database.
  --apply     Apply the active retention policy. Required for changes.
  --help, -h  Show this help.
`

const scriptPath = fileURLToPath(import.meta.url)
const appRoot = resolve(dirname(scriptPath), '..')

class RetentionCliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'RetentionCliError'
    this.exitCode = exitCode
  }
}

const messageFromError = (error) => error instanceof Error ? error.message : String(error)
const expandHome = (value) => value === '~' || value.startsWith('~/') ? `${homedir()}${value.slice(1)}` : value
const resolvePath = (raw, base) => {
  const expanded = expandHome(String(raw ?? '').trim())
  if (!expanded) return ''
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded)
}

const campaignRoot = (env) => resolvePath(env[ROTOM_CAMPAIGN_ROOT_ENV] || process.cwd(), appRoot)

const databasePath = (env, root) => {
  const raw = env[ROTOM_DB_PATH_ENV]
  if (!raw || !raw.trim()) return resolve(root, DEFAULT_ROTOM_DB_FILENAME)
  if (raw.trim() === ':memory:') throw new RetentionCliError('ROTOM_DB_PATH=:memory: cannot be inspected by the operator CLI', 2)
  return resolvePath(raw, root)
}

const parseIntegerEnv = ({ env, name, defaultValue, min, max }) => {
  const rawValue = env[name]
  const trimmed = rawValue?.trim()
  const value = trimmed ? Number(trimmed) : defaultValue
  if (!Number.isSafeInteger(value)) {
    throw new RetentionCliError(`Invalid realtime event retention configuration: ${name} must be a safe integer`, 2)
  }
  if (value < min || value > max) {
    throw new RetentionCliError(
      `Invalid realtime event retention configuration: ${name} must be between ${min} and ${max}`,
      2,
    )
  }
  return value
}

const parseBooleanEnv = ({ env, name, defaultValue }) => {
  const rawValue = env[name]
  const trimmed = rawValue?.trim().toLowerCase()
  if (!trimmed) return defaultValue
  if (['1', 'true', 'yes', 'on'].includes(trimmed)) return true
  if (['0', 'false', 'no', 'off'].includes(trimmed)) return false
  throw new RetentionCliError(`Invalid realtime event retention configuration: ${name} must be true or false`, 2)
}

const loadPolicy = (env) => ({
  enabled: parseBooleanEnv({
    env,
    name: ROTOM_REALTIME_EVENT_RETENTION_ENABLED_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_RETENTION_ENABLED,
  }),
  retentionDays: parseIntegerEnv({
    env,
    name: ROTOM_REALTIME_EVENT_RETENTION_DAYS_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_RETENTION_DAYS,
    min: MIN_REALTIME_EVENT_RETENTION_DAYS,
    max: MAX_REALTIME_EVENT_RETENTION_DAYS,
  }),
  maxRows: parseIntegerEnv({
    env,
    name: ROTOM_REALTIME_EVENT_MAX_ROWS_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_MAX_ROWS,
    min: MIN_REALTIME_EVENT_MAX_ROWS,
    max: MAX_REALTIME_EVENT_MAX_ROWS,
  }),
  pruneIntervalMs: parseIntegerEnv({
    env,
    name: ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_PRUNE_INTERVAL_MS,
    min: MIN_REALTIME_EVENT_PRUNE_INTERVAL_MS,
    max: MAX_REALTIME_EVENT_PRUNE_INTERVAL_MS,
  }),
})

const parseArgs = (argv) => {
  const command = argv[0]
  const rest = command === 'status' || command === 'prune' ? argv.slice(1) : argv
  const options = { command: command === 'status' || command === 'prune' ? command : '', dryRun: false, apply: false, help: false }
  if (!options.command && rest.length === 0) options.command = 'status'

  for (const arg of rest) {
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--apply') options.apply = true
    else throw new RetentionCliError(`Unknown option: ${arg}`, 2)
  }
  if (!options.command) throw new RetentionCliError('A command is required: status or prune', 2)
  if (options.command === 'status' && (options.dryRun || options.apply)) {
    throw new RetentionCliError('status does not accept --dry-run or --apply', 2)
  }
  if (options.command === 'prune' && options.dryRun === options.apply && !options.help) {
    throw new RetentionCliError('prune requires exactly one of --dry-run or --apply', 2)
  }
  return options
}

const sqliteIntegerToNumber = (value, label) => {
  const numberValue = typeof value === 'bigint' ? Number(value) : value
  if (typeof numberValue !== 'number' || !Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${label} must be a safe non-negative integer`)
  }
  return numberValue
}

const nullableSqliteIntegerToNumber = (value, label) => {
  if (value === null || value === undefined) return null
  return sqliteIntegerToNumber(value, label)
}

const assertRealtimeSchema = (connection) => {
  const required = ['realtime_events', 'realtime_event_log_state']
  for (const table of required) {
    const row = connection.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?').get(table)
    if (!row) throw new RetentionCliError(`Database is missing required table: ${table}`)
  }
}

const readJournalMode = (connection) => {
  const row = connection.prepare('PRAGMA journal_mode').get()
  return typeof row?.journal_mode === 'string' ? row.journal_mode : 'unknown'
}

const readCursorState = (connection) => {
  const row = connection.prepare(`
    SELECT latest_sequence, earliest_available_sequence
    FROM realtime_event_log_state
    WHERE singleton = 1
  `).get()
  if (!row) throw new Error('realtime_event_log_state singleton row is missing')
  return {
    latestSequence: sqliteIntegerToNumber(row.latest_sequence, 'realtime_event_log_state.latest_sequence'),
    earliestAvailableSequence: sqliteIntegerToNumber(
      row.earliest_available_sequence,
      'realtime_event_log_state.earliest_available_sequence',
    ),
  }
}

const readAggregate = (connection) => {
  const row = connection.prepare(`
    SELECT
      COUNT(*) AS row_count,
      MIN(created_at) AS oldest_timestamp,
      MAX(created_at) AS newest_timestamp
    FROM realtime_events
  `).get()
  return {
    rowCount: sqliteIntegerToNumber(row?.row_count ?? 0, 'retained realtime event row count'),
    oldestTimestamp: nullableSqliteIntegerToNumber(row?.oldest_timestamp, 'oldest retained realtime event timestamp'),
    newestTimestamp: nullableSqliteIntegerToNumber(row?.newest_timestamp, 'newest retained realtime event timestamp'),
  }
}

const countRowsThroughSequence = (connection, sequence) => {
  if (sequence <= 0) return 0
  const row = connection.prepare('SELECT COUNT(*) AS row_count FROM realtime_events WHERE sequence <= ?').get(sequence)
  return sqliteIntegerToNumber(row?.row_count ?? 0, 'retained realtime event delete count')
}

const readAgeCutoffSequence = (connection, ageCutoffTimestamp, latestSequence) => {
  const expiredRow = connection.prepare(`
    SELECT sequence
    FROM realtime_events
    WHERE created_at < ?
    ORDER BY sequence ASC
    LIMIT 1
  `).get(ageCutoffTimestamp)
  if (!expiredRow) return 0

  const firstRetainedByAge = connection.prepare(`
    SELECT sequence
    FROM realtime_events
    WHERE created_at >= ?
    ORDER BY sequence ASC
    LIMIT 1
  `).get(ageCutoffTimestamp)
  if (!firstRetainedByAge) return latestSequence
  return Math.max(0, sqliteIntegerToNumber(firstRetainedByAge.sequence, 'first retained realtime event sequence by age') - 1)
}

const readRowCountCutoffSequence = (connection, rowCount, maxRows) => {
  if (rowCount <= maxRows) return 0
  const row = connection.prepare(`
    SELECT sequence
    FROM realtime_events
    ORDER BY sequence DESC
    LIMIT 1 OFFSET ?
  `).get(maxRows)
  if (!row) throw new Error('realtime event row-count cutoff could not be computed')
  return sqliteIntegerToNumber(row.sequence, 'row-count realtime event retention cutoff sequence')
}

const cutoffReason = ({ policy, cutoffSequence, ageCutoffSequence, rowCountCutoffSequence }) => {
  if (!policy.enabled) return 'disabled'
  if (cutoffSequence <= 0) return 'none'
  const ageSelected = ageCutoffSequence === cutoffSequence
  const countSelected = rowCountCutoffSequence === cutoffSequence
  if (ageSelected && countSelected) return 'age-and-row-count'
  return ageSelected ? 'age' : 'row-count'
}

const planRetention = (connection, policy, now = Date.now()) => {
  const cursorState = readCursorState(connection)
  const aggregate = readAggregate(connection)
  const ageCutoffTimestamp = now - (policy.retentionDays * REALTIME_EVENT_RETENTION_DAY_MS)
  const ageCutoffSequence = policy.enabled
    ? readAgeCutoffSequence(connection, ageCutoffTimestamp, cursorState.latestSequence)
    : 0
  const rowCountCutoffSequence = policy.enabled
    ? readRowCountCutoffSequence(connection, aggregate.rowCount, policy.maxRows)
    : 0
  const cutoffSequence = policy.enabled ? Math.max(ageCutoffSequence, rowCountCutoffSequence) : 0
  const eligibleByAge = countRowsThroughSequence(connection, ageCutoffSequence)
  const eligibleByCount = Math.max(aggregate.rowCount - policy.maxRows, 0)
  const estimatedDeleteCount = countRowsThroughSequence(connection, cutoffSequence)

  return {
    policy,
    now,
    ageCutoffTimestamp,
    rowCount: aggregate.rowCount,
    cursorState,
    oldestTimestamp: aggregate.oldestTimestamp,
    newestTimestamp: aggregate.newestTimestamp,
    ageCutoffSequence,
    rowCountCutoffSequence,
    cutoffSequence,
    eligibleByAge,
    eligibleByCount,
    estimatedDeleteCount,
    cutoffReason: cutoffReason({ policy, cutoffSequence, ageCutoffSequence, rowCountCutoffSequence }),
  }
}

const pruneRetention = (connection, policy) => {
  connection.exec('BEGIN IMMEDIATE')
  try {
    const plan = planRetention(connection, policy)
    const previousCursorState = readCursorState(connection)
    const deleted = connection.prepare('DELETE FROM realtime_events WHERE sequence <= ?').run(plan.cutoffSequence)
    const retained = connection.prepare('SELECT MIN(sequence) AS sequence FROM realtime_events').get()
    const retainedEarliest = nullableSqliteIntegerToNumber(retained?.sequence, 'minimum retained realtime event sequence')
    const earliestAvailableSequence = retainedEarliest ?? previousCursorState.latestSequence + 1
    connection.prepare(`
      UPDATE realtime_event_log_state
      SET earliest_available_sequence = ?
      WHERE singleton = 1
    `).run(earliestAvailableSequence)
    const currentCursorState = readCursorState(connection)
    connection.exec('COMMIT')
    return {
      ...plan,
      deletedCount: sqliteIntegerToNumber(deleted.changes, 'deleted realtime event count'),
      deletedThroughSequence: plan.cutoffSequence,
      previousCursorState,
      currentCursorState,
    }
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}

const formatTimestamp = (value) => value === null ? 'none' : String(value)

const planLines = (plan, dbPath, journalMode) => [
  `Database path: ${dbPath}`,
  `Journal mode: ${journalMode}`,
  `Cursor state: latest=${plan.cursorState.latestSequence} earliest=${plan.cursorState.earliestAvailableSequence}`,
  `Retained row count: ${plan.rowCount}`,
  `Oldest timestamp: ${formatTimestamp(plan.oldestTimestamp)}`,
  `Newest timestamp: ${formatTimestamp(plan.newestTimestamp)}`,
  `Retention enabled: ${plan.policy.enabled}`,
  `Retention days: ${plan.policy.retentionDays}`,
  `Maximum rows: ${plan.policy.maxRows}`,
  `Prune interval ms: ${plan.policy.pruneIntervalMs}`,
  `Age cutoff timestamp: ${plan.ageCutoffTimestamp}`,
  `Age cutoff sequence: ${plan.ageCutoffSequence}`,
  `Row-count cutoff sequence: ${plan.rowCountCutoffSequence}`,
  `Planned cutoff sequence: ${plan.cutoffSequence}`,
  `Eligible by age: ${plan.eligibleByAge}`,
  `Eligible by row count: ${plan.eligibleByCount}`,
  `Estimated deletions: ${plan.estimatedDeleteCount}`,
  `Cutoff reason: ${plan.cutoffReason}`,
]

const openDatabase = (dbPath, readOnly) => {
  const connection = readOnly ? new DatabaseSync(dbPath, { readOnly: true }) : new DatabaseSync(dbPath)
  connection.exec('PRAGMA busy_timeout = 5000')
  connection.exec('PRAGMA foreign_keys = ON')
  return connection
}

const runWithDatabase = ({ env, readOnly, work }) => {
  const root = campaignRoot(env)
  const dbPath = databasePath(env, root)
  const policy = loadPolicy(env)
  const connection = openDatabase(dbPath, readOnly)
  try {
    assertRealtimeSchema(connection)
    const journalMode = readJournalMode(connection)
    return work({ connection, dbPath, journalMode, policy })
  } finally {
    connection.close()
  }
}

const runStatus = (env) => runWithDatabase({
  env,
  readOnly: true,
  work: ({ connection, dbPath, journalMode, policy }) => {
    const plan = planRetention(connection, policy)
    process.stdout.write(['Rotom Table realtime retention status', ...planLines(plan, dbPath, journalMode)].join('\n') + '\n')
    return 0
  },
})

const runPrune = (env, apply) => runWithDatabase({
  env,
  readOnly: !apply,
  work: ({ connection, dbPath, journalMode, policy }) => {
    if (!apply) {
      const plan = planRetention(connection, policy)
      process.stdout.write([
        'Rotom Table realtime retention prune dry run',
        ...planLines(plan, dbPath, journalMode),
        'Dry run: no changes applied',
      ].join('\n') + '\n')
      return 0
    }

    const result = pruneRetention(connection, policy)
    process.stdout.write([
      'Rotom Table realtime retention prune applied',
      ...planLines(result, dbPath, journalMode),
      `Deleted rows: ${result.deletedCount}`,
      `Deleted through sequence: ${result.deletedThroughSequence}`,
      `Previous earliest sequence: ${result.previousCursorState.earliestAvailableSequence}`,
      `Current earliest sequence: ${result.currentCursorState.earliestAvailableSequence}`,
      `Latest sequence: ${result.currentCursorState.latestSequence}`,
    ].join('\n') + '\n')
    return 0
  },
})

export const runRealtimeRetentionCli = (argv = process.argv.slice(2), env = process.env) => {
  try {
    const options = parseArgs(argv)
    if (options.help) {
      process.stdout.write(HELP_TEXT)
      return 0
    }
    return options.command === 'status'
      ? runStatus(env)
      : runPrune(env, options.apply)
  } catch (error) {
    process.stderr.write(`${messageFromError(error)}\n\n${HELP_TEXT}`)
    return error instanceof RetentionCliError ? error.exitCode : 1
  }
}

if (scriptPath === resolve(process.argv[1] ?? '')) {
  process.exitCode = runRealtimeRetentionCli()
}
