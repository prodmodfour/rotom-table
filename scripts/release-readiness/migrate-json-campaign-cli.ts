#!/usr/bin/env -S npx vite-node
import process from 'node:process'
import { formatMigrationResult } from '../migrate-campaign-to-sqlite.mjs'
import { runAtomicJsonCampaignMigration } from './migrate-json-campaign'

try {
  const result = runAtomicJsonCampaignMigration({ argv: process.argv.slice(2), env: process.env })
  const output = formatMigrationResult(result)
  if (result.exitCode === 0 || result.help) {
    process.stdout.write(output)
    if (!result.help) process.stdout.write(`Final atomic database: ${result.finalDatabasePath}\nFinal storage schema: v${result.finalSchemaVersion}\n`)
  } else {
    process.stderr.write(output)
  }
  process.exitCode = result.exitCode
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
