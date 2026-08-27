#!/usr/bin/env -S npx vite-node
import process from 'node:process'
import { upgradeCampaignDatabase, ReleaseUpgradeError } from '../../server/storage/releaseUpgrade'

const value = (name: string): string | null => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`Rotom Table 1.0 atomic campaign database upgrade\n\nUsage:\n  npm run upgrade:campaign -- --database /private/campaign/rotom-table.sqlite [--backup /private/backups/pre-upgrade.sqlite] [--json]\n\nThe service must be stopped. Inputs must be app-produced SQLite schema v1-v56 with no WAL/SHM sidecars. The command validates before writing, creates a byte-exact backup, upgrades a staging copy, audits it, and atomically replaces the original. Downgrade is not supported; restore the backup instead.\n`)
  process.exit(0)
}

if (process.argv.includes('--target') || process.argv.includes('--downgrade')) {
  process.stderr.write('Database downgrade is unsupported. Restore the exact pre-upgrade backup according to docs/release/upgrade.md.\n')
  process.exit(2)
}
const cliArgs = process.argv.slice(2)
for (let index = 0; index < cliArgs.length; index += 1) {
  const arg = cliArgs[index]!
  if (arg === '--database' || arg === '--backup') { index += 1; continue }
  if (arg === '--json') continue
  if (arg.startsWith('--')) {
    process.stderr.write(`Unknown option: ${arg}. Run with --help.\n`)
    process.exit(2)
  }
}

const databasePath = value('--database')
if (!databasePath) {
  process.stderr.write('Missing --database. Run with --help for the supported procedure.\n')
  process.exit(2)
}

try {
  const result = upgradeCampaignDatabase({
    databasePath,
    backupPath: value('--backup') ?? undefined,
  })
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else {
    process.stdout.write([
      `Rotom Table campaign database ${result.status}.`,
      `Database: ${result.databasePath}`,
      `Schema: v${result.fromVersion} → v${result.toVersion}`,
      `Applied: ${result.appliedVersions.join(', ') || 'none'}`,
      `Backup: ${result.backupPath ?? 'not required (already current)'}`,
      `Integrity: ${result.integrity}; foreign-key violations: ${result.foreignKeyViolations}`,
      `Before SHA-256: ${result.beforeSha256}`,
      `After SHA-256: ${result.afterSha256}`,
    ].join('\n') + '\n')
  }
} catch (error) {
  if (error instanceof ReleaseUpgradeError) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
    process.exit(1)
  }
  throw error
}
