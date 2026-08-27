#!/usr/bin/env -S npx vite-node
import process from 'node:process'
import { resolve } from 'node:path'
import { restoreReleaseBackup } from '../../server/storage/releaseBackup'

const HELP = `Rotom Table 1.0 private campaign restore

Usage:
  npm run restore:campaign -- --archive <path> --target-root <empty-path> [--sha256 <digest>] [--json]

Restore only to a fresh empty root while the service is stopped. The command rejects unsafe entries, verifies every manifest hash, and audits SQLite before reporting success.
`
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const value = (flag: string): string | null => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}
const required = (flag: string): string => {
  const result = value(flag)?.trim()
  if (!result) throw new Error(`Missing required ${flag}. Run with --help.`)
  return result
}
try {
  const result = restoreReleaseBackup({
    archivePath: resolve(required('--archive')),
    targetRoot: resolve(required('--target-root')),
    expectedArchiveSha256: value('--sha256')?.trim() || undefined,
  })
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      status: 'restored',
      storageSchemaVersion: result.manifest.storageSchemaVersion,
      method: result.manifest.method,
      archiveSha256: result.archiveSha256,
      databasePath: result.databasePath,
      settingsInventory: result.manifest.settingsInventory,
    })}\n`)
  } else {
    process.stdout.write([
      'Rotom Table release backup restored and audited.',
      `Method: ${result.manifest.method}`,
      `Storage schema: v${result.manifest.storageSchemaVersion}`,
      `Database: ${result.databasePath}`,
      `SHA-256: ${result.archiveSha256}`,
      '',
    ].join('\n'))
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
