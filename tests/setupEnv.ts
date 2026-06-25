import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// Keep local developer campaign configuration from changing test fixture roots.
delete process.env.ROTOM_CAMPAIGN_ROOT

// Keep production-like default SQLite access out of the repository checkout when
// a route/use-case test intentionally exercises a default repository path.
const previousRotomDbPath = process.env.ROTOM_DB_PATH
const defaultDatabaseRoot = mkdtempSync(join(tmpdir(), `rotom-test-db-${process.pid}-`))
process.env.ROTOM_DB_PATH = join(defaultDatabaseRoot, 'rotom-table.sqlite')

afterAll(() => {
  if (previousRotomDbPath === undefined) delete process.env.ROTOM_DB_PATH
  else process.env.ROTOM_DB_PATH = previousRotomDbPath
  rmSync(defaultDatabaseRoot, { recursive: true, force: true })
})
