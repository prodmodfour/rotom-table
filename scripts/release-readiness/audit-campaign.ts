#!/usr/bin/env -S npx vite-node
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { resolve } from 'node:path'
import { auditReleaseCampaignDatabase } from '../../server/storage/releaseIntegrityAudit'

const HELP = `Rotom Table 1.0 release-boundary campaign integrity audit

Usage:
  npm run audit:campaign -- --database /private/campaign/rotom-table.sqlite [--json]

The command is read-only. It checks release schema identity, exact app schema, SQLite integrity, foreign keys, every storage family/table, every *_json authority column, signing-secret shape, and the existing GM Toolkit lineage audit. No authority values are emitted.
`
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const databaseIndex = args.indexOf('--database')
const database = databaseIndex >= 0 ? args[databaseIndex + 1]?.trim() : null
if (!database) {
  process.stderr.write('Missing required --database. Run with --help.\n')
  process.exit(2)
}
const path = resolve(database)
const base = auditReleaseCampaignDatabase(path)
let toolkit: { status: 'passed' | 'failed'; errors: string[]; counts: Record<string, number> }
if (base.status === 'passed') {
  const command = spawnSync('python3', [
    resolve('scripts/audit_gm_campaign_toolkit_storage.py'), '--database', path, '--json',
  ], { encoding: 'utf8' })
  try {
    const parsed = JSON.parse(command.stdout) as { status?: string; errors?: unknown[]; counts?: Record<string, number> }
    toolkit = {
      status: command.status === 0 && parsed.status === 'accepted' ? 'passed' : 'failed',
      errors: (parsed.errors ?? []).map(String),
      counts: parsed.counts ?? {},
    }
  } catch {
    toolkit = { status: 'failed', errors: [command.stderr.trim() || 'GM Toolkit audit returned invalid output'], counts: {} }
  }
} else {
  toolkit = { status: 'failed', errors: ['Skipped because the general release integrity audit failed.'], counts: {} }
}
const report = {
  artifact: 'rotom-table-release-campaign-audit',
  schemaVersion: 1,
  status: base.status === 'passed' && toolkit.status === 'passed' ? 'passed' : 'failed',
  databaseName: base.databaseName,
  storageSchemaVersion: base.storageSchemaVersion,
  general: base,
  domainAudits: { gmCampaignToolkit: toolkit },
}
if (args.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`)
else {
  process.stdout.write(`Rotom Table campaign integrity audit: ${report.status}\n`)
  process.stdout.write(`Storage schema: v${report.storageSchemaVersion ?? 'unknown'}; tables: ${base.counts.tables}; rows scanned: ${base.counts.rows}; JSON columns: ${base.counts.jsonColumns}\n`)
  for (const error of [...base.errors, ...toolkit.errors]) process.stderr.write(`ERROR: ${error}\n`)
}
process.exitCode = report.status === 'passed' ? 0 : 1
