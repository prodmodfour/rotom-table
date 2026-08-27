import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import { auditReleaseCampaignDatabase } from '../../server/storage/releaseIntegrityAudit'

const roots: string[] = []
const makePath = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-release-audit-'))
  roots.push(root)
  return join(root, 'campaign.sqlite')
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

describe('Plan 13 release-boundary integrity audit', () => {
  it('audits every current storage family without projecting private authority values', () => {
    const path = makePath()
    const database = openRotomDatabase({ path, enableWal: false })
    database.connection.prepare('INSERT INTO maps (slug, document_json, revision, updated_at) VALUES (?, ?, 1, 1)')
      .run('private-audit-map', JSON.stringify({ slug: 'private-audit-map', gmNotes: 'never emit this hidden plan' }))
    database.close()

    const report = auditReleaseCampaignDatabase(path)
    expect(report.status).toBe('passed')
    expect(Object.keys(report.counts.families).sort()).toEqual([
      'ability-automation',
      'breeding-and-campaign-time',
      'campaign-core',
      'capability-automation',
      'contests',
      'deferred-mechanics',
      'encounter-and-realtime',
      'gm-campaign-toolkit',
      'onboarding',
    ])
    expect(report.counts.tables).toBeGreaterThan(70)
    expect(report.counts.jsonColumns).toBeGreaterThan(40)
    expect(JSON.stringify(report)).not.toContain('hidden plan')

    const command = spawnSync('npx', [
      'vite-node', '--config', 'vitest.config.ts',
      'scripts/release-readiness/audit-campaign.ts', '--database', path, '--json',
    ], { cwd: resolve('.'), encoding: 'utf8' })
    expect(command.status, command.stderr).toBe(0)
    const aggregate = JSON.parse(command.stdout) as { status: string; domainAudits: { gmCampaignToolkit: { status: string } } }
    expect(aggregate.status).toBe('passed')
    expect(aggregate.domainAudits.gmCampaignToolkit.status).toBe('passed')
    expect(command.stdout).not.toContain('hidden plan')
  }, 20_000)

  it('fails on injected JSON corruption and exact-schema damage', () => {
    const corruptPath = makePath()
    const corrupt = openRotomDatabase({ path: corruptPath, enableWal: false })
    corrupt.connection.prepare('INSERT INTO maps (slug, document_json, revision, updated_at) VALUES (?, ?, 1, 1)')
      .run('corrupt-map', '{not-json')
    corrupt.close()
    const corruptReport = auditReleaseCampaignDatabase(corruptPath)
    expect(corruptReport.status).toBe('failed')
    expect(corruptReport.checks['json-authority']).toBe('failed')
    expect(corruptReport.counts.invalidJsonRows).toBe(1)

    const partialPath = makePath()
    const partial = openRotomDatabase({ path: partialPath, enableWal: false })
    partial.connection.exec('DROP TABLE ability_declaration_offers')
    partial.close()
    const partialReport = auditReleaseCampaignDatabase(partialPath)
    expect(partialReport.status).toBe('failed')
    expect(partialReport.checks['exact-app-schema']).toBe('failed')
  })
})
