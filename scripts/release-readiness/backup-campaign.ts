#!/usr/bin/env -S npx vite-node
import process from 'node:process'
import { resolve } from 'node:path'
import {
  createReleaseBackup,
  type ReleaseBackupMethod,
  type ReleaseBackupSetting,
} from '../../server/storage/releaseBackup'

const HELP = `Rotom Table 1.0 private campaign backup

Usage:
  npm run backup:campaign -- --method online-sqlite-backup-api|stopped-service-copy --campaign-root <path> --database <path> --archive <path> [--setting label=/private/file] [--json]

The archive must be outside the campaign root. Online mode uses SQLite's backup API; stopped mode requires an unlocked, stopped-service database. Private settings are opt-in inventory files and are archived under their labels.
`
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const one = (flag: string): string | null => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}
const repeated = (flag: string): string[] => args.flatMap((arg, index) => arg === flag && args[index + 1] ? [args[index + 1]!] : [])
const required = (flag: string): string => {
  const result = one(flag)?.trim()
  if (!result) throw new Error(`Missing required ${flag}. Run with --help.`)
  return result
}
const parseSettings = (): ReleaseBackupSetting[] => repeated('--setting').map(value => {
  const separator = value.indexOf('=')
  if (separator < 1 || separator === value.length - 1) throw new Error('--setting must use label=/private/file syntax')
  return { label: value.slice(0, separator), path: value.slice(separator + 1) }
})

try {
  const method = required('--method') as ReleaseBackupMethod
  const result = await createReleaseBackup({
    method,
    campaignRoot: resolve(required('--campaign-root')),
    databasePath: resolve(required('--database')),
    archivePath: resolve(required('--archive')),
    settings: parseSettings(),
  })
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      status: 'created',
      method: result.manifest.method,
      storageSchemaVersion: result.manifest.storageSchemaVersion,
      archivePath: result.archivePath,
      archiveSha256: result.archiveSha256,
      entryCount: result.manifest.entries.length,
      settingsInventory: result.manifest.settingsInventory,
    })}\n`)
  } else {
    process.stdout.write([
      'Rotom Table release backup created.',
      `Method: ${result.manifest.method}`,
      `Storage schema: v${result.manifest.storageSchemaVersion}`,
      `Archive: ${result.archivePath}`,
      `SHA-256: ${result.archiveSha256}`,
      `Entries: ${result.manifest.entries.length}`,
      '',
    ].join('\n'))
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
